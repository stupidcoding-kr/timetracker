const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

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

// 페이지 본문에 들어갈 깔끔한 일정 요약 블록 생성
function buildPageBody(schedules) {
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

  return children;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.NOTION_API_KEY || !DATABASE_ID) {
    return res.status(500).json({ error: 'Vercel 환경변수가 설정되지 않았습니다.' });
  }

  try {
    if (req.method === 'GET') {
      const { date } = req.query;
      if (!date) return res.status(400).json({ error: 'Date is required' });

      // Summary(제목 속성)가 날짜와 일치하는 항목 검색
      const response = await notion.databases.query({
        database_id: DATABASE_ID,
        filter: {
          property: 'Summary',
          title: { equals: date }
        }
      });

      if (!response.results || response.results.length === 0) {
        return res.status(200).json([]);
      }

      const page = response.results[0];
      const dataProperty = page.properties.Data;

      if (dataProperty && dataProperty.rich_text && dataProperty.rich_text.length > 0) {
        try {
          const jsonText = dataProperty.rich_text[0].plain_text;
          return res.status(200).json(JSON.parse(jsonText));
        } catch (e) {
          return res.status(200).json([]);
        }
      }

      return res.status(200).json([]);
    }

    if (req.method === 'POST') {
      const { date, schedules } = req.body;
      if (!date) return res.status(400).json({ error: 'Date is required' });

      // 기존 해당 날짜 페이지 조회
      const existingPages = await notion.databases.query({
        database_id: DATABASE_ID,
        filter: {
          property: 'Summary',
          title: { equals: date }
        }
      });

      const jsonContent = JSON.stringify(schedules || []);
      const pageBodyBlocks = buildPageBody(schedules);

      if (existingPages.results && existingPages.results.length > 0) {
        const pageId = existingPages.results[0].id;

        // 1. 표의 속성 업데이트 (Summary에는 날짜, Data에는 JSON 데이터)
        await notion.pages.update({
          page_id: pageId,
          properties: {
            Summary: {
              title: [{ text: { content: date } }]
            },
            Data: {
              rich_text: [{ text: { content: jsonContent } }]
            }
          }
        });

        // 2. 페이지 내부 기존 본문 블록 비우기
        const blocks = await notion.blocks.children.list({ block_id: pageId });
        for (const block of blocks.results) {
          try {
            await notion.blocks.delete({ block_id: block.id });
          } catch (delErr) {}
        }

        // 3. 페이지 내부에 일정 요약 추가
        await notion.blocks.children.append({
          block_id: pageId,
          children: pageBodyBlocks
        });

        return res.status(200).json({ success: true, message: 'Updated' });
      } else {
        // 새 페이지 생성
        await notion.pages.create({
          parent: { database_id: DATABASE_ID },
          properties: {
            Summary: {
              title: [{ text: { content: date } }]
            },
            Data: {
              rich_text: [{ text: { content: jsonContent } }]
            }
          },
          children: pageBodyBlocks
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
