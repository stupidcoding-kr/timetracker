// api/notionapi.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const NOTION_API_KEY = process.env.NOTION_API_KEY || "ntn_m470014999421AAz7iM3by5TrY1H2Wo0pqEIqvZeY8rayO";
  const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || "3de1182698ea800c8d92f3db0c9a29d2";

  const headers = {
    'Authorization': `Bearer ${NOTION_API_KEY}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  try {
    // 1. 데이터 불러오기 (GET)
    if (req.method === 'GET') {
      const { date } = req.query;
      if (!date) return res.status(400).json({ error: "date 파라미터가 필요합니다." });

      const queryRes = await fetch(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ filter: { property: "제목", title: { equals: date } } })
      });

      const queryData = await queryRes.json();
      if (!queryRes.ok) return res.status(queryRes.status).json({ error: "노션 조회 실패", details: queryData });

      if (queryData.results && queryData.results.length > 0) {
        const page = queryData.results[0];
        const jsonContent = page.properties["데이터"]?.rich_text?.[0]?.text?.content || "[]";
        return res.status(200).json(JSON.parse(jsonContent));
      }
      return res.status(200).json([]);
    }

    // 2. 데이터 저장/수정 (POST)
    if (req.method === 'POST') {
      const { date, schedules } = req.body;
      if (!date || !schedules) return res.status(400).json({ error: "데이터가 부족합니다." });

      const jsonPayload = JSON.stringify(schedules);

      const summaryText = schedules.map(s => {
        const h1 = String(Math.floor(s.startIdx / 6) + 6).padStart(2, '0');
        const m1 = String((s.startIdx % 6) * 10).padStart(2, '0');
        const h2 = String(Math.floor((s.endIdx + 1) / 6) + 6).padStart(2, '0');
        const m2 = String(((s.endIdx + 1) % 6) * 10).padStart(2, '0');
        return `• ${s.name} (${h1}:${m1} ~ ${h2}:${m2})`;
      }).join('\n') || "기록 없음";

      const queryRes = await fetch(`https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ filter: { property: "제목", title: { equals: date } } })
      });

      const queryData = await queryRes.json();
      if (!queryRes.ok) return res.status(queryRes.status).json({ error: "노션 기존 데이터 검색 실패", details: queryData });

      const existingPage = queryData.results && queryData.results[0];
      const propertiesPayload = {
        "제목": { title: [{ text: { content: date } }] },
        "날짜": { rich_text: [{ text: { content: date } }] },
        "요약": { rich_text: [{ text: { content: summaryText } }] },
        "데이터": { rich_text: [{ text: { content: jsonPayload } }] }
      };

      let saveRes;
      if (existingPage) {
        saveRes = await fetch(`https://api.notion.com/v1/pages/${existingPage.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ properties: propertiesPayload })
        });
      } else {
        saveRes = await fetch(`https://api.notion.com/v1/pages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            parent: { database_id: NOTION_DATABASE_ID },
            properties: propertiesPayload
          })
        });
      }

      const saveData = await saveRes.json();
      if (!saveRes.ok) return res.status(saveRes.status).json({ error: "노션 저장 실패", details: saveData });

      return res.status(200).json({ status: "success", date });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}