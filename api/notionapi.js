const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// 블록 인덱스를 시간 문자열로 변환 (06:00 ~ 25:00)
function blockIndexToStartTime(idx) {
  const h = Math.floor(idx / 6) + 6;
  const m = (idx % 6) * 10;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function blockIndexToEndTime(idx) {
  const totalMins = (idx + 1) * 10;
  const h = Math.floor(totalMins / 60) + 6;
  const m = totalMins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// 노션 페이지 본문에 생성될 블록 구조 생성 함수
function buildPageChildren(schedules) {
  const jsonContent = JSON.stringify(schedules || []);
  const children = [
    {
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [{ type: 'text', text: { content: '📅 일정 요약' } }]
      }
    }
  ];

  if (schedules && schedules.length > 0) {
    schedules.forEach(s => {
      const startT = blockIndexToStartTime(Number(s.startIdx));
      const endT = blockIndexToEndTime(Number(s.endIdx));
      children.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [
            { type: 'text', text: { content: `${s.name} ` }, annotations: { bold: true } },
            { type: 'text', text: { content: `(${startT} ~ ${endT})` } }
          ]
        }
      });
    });
  } else {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: '기록된 일정이 없습니다.' } }]
      }
    });
  }

  // 데이터 보관용 코드 블록 추가
  children.push(
    {
      object: 'block',
      type: 'divider',
      divider: {}
    },
    {
      object: 'block',
      type: 'code',
      code: {
        caption: [{ type: 'text', text: { content: '위젯 동기화용 데이터 (수정 금지)' } }],
        rich_text: [{ type: 'text', text: { content: jsonContent } }],
        language: 'json'
      }
    }
  );

  return children;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const { date } = req.query;
      if (!date) return res.status(400).json({ error: 'Date is required' });

      const response = await notion.databases.query({
        database_id: DATABASE_ID,
        filter: {
          property: 'Date',
          date: { equals: date }
        }
      });

      if (response.results.length === 0) {
        return res.status(200).json([]);
      }

      const pageId = response.results[0].id;
      const blocks = await notion.blocks.children.list({ block_id: pageId });
      const codeBlock = blocks.results.find(b => b.type === 'code');

      if (codeBlock && codeBlock.code.rich_text.length > 0) {
        const jsonText = codeBlock.code.rich_text[0].plain_text;
        return res.status(200).json(JSON.parse(jsonText));
      }

      return res.status(200).json([]);
    }

    if (req.method === 'POST') {
      const { date, summary, schedules } = req.body;
      if (!date) return res.status(400).json({ error: 'Date is required' });

      const existingPages = await notion.databases.query({
        database_id: DATABASE_ID,
        filter: {
          property: 'Date',
          date: { equals: date }
        }
      });

      const childrenBlocks = buildPageChildren(schedules);
      const titleText = summary && summary !== '기록 없음' ? summary : `${date} 일정`;

      if (existingPages.results.length > 0) {
        const pageId = existingPages.results[0].id;

        // 1. 표의 제목 속성(Summary) 및 날짜 속성(Date) 업데이트
        await notion.pages.update({
          page_id: pageId,
          properties: {
            Summary: {
              title: [{ text: { content: titleText } }]
            },
            Date: {
              date: { start: date }
            }
          }
        });

        // 2. 페이지 내부 기존 본문 블록 비우기
        const blocks = await notion.blocks.children.list({ block_id: pageId });
        for (const block of blocks.results) {
          await notion.blocks.delete({ block_id: block.id });
        }

        // 3. 페이지 내부에 요약 블록 및 코드 블록 생성
        await notion.blocks.children.append({
          block_id: pageId,
          children: childrenBlocks
        });

        return res.status(200).json({ success: true, message: 'Updated' });
      } else {
        // 새 페이지 생성
        await notion.pages.create({
          parent: { database_id: DATABASE_ID },
          properties: {
            Summary: {
              title: [{ text: { content: titleText } }]
            },
            Date: {
              date: { start: date }
            }
          },
          children: childrenBlocks
        });

        return res.status(200).json({ success: true, message: 'Created' });
      }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    console.error('Notion API Error:', error);
    return res.status(500).json({ error: error.message });
  }
};