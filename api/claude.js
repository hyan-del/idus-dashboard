const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function callAnthropic(payload, useWebSearch) {
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  };
  if (useWebSearch) headers['anthropic-beta'] = 'web-search-2025-03-05';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다.' });

  try {
    const { messages, tools, model, max_tokens } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages 배열이 필요합니다.' });
    }

    const useWebSearch = (tools || []).some(t => t.type === 'web_search_20250305');
    let payload = {
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: max_tokens || 2000,
      messages: [...messages],
      ...(tools && tools.length ? { tools } : {}),
    };

    let finalResponse = null;
    for (let i = 0; i < 6; i++) {
      const { status, body } = await callAnthropic(payload, useWebSearch);
      if (status !== 200) return res.status(status).json({ error: body?.error?.message || '오류' });
      if (body.stop_reason !== 'tool_use') { finalResponse = body; break; }

      const toolUseBlocks = body.content.filter(b => b.type === 'tool_use');
      if (!toolUseBlocks.length) { finalResponse = body; break; }

      payload.messages.push({ role: 'assistant', content: body.content });
      payload.messages.push({
        role: 'user',
        content: toolUseBlocks.map(block => ({
          type: 'tool_result',
          tool_use_id: block.id,
          content: block.type === 'web_search_tool_result' ? block.content : (block.output || '검색 결과 없음'),
        }))
      });
    }

    if (!finalResponse) return res.status(500).json({ error: '응답을 받지 못했습니다.' });
    return res.json(finalResponse);

  } catch (err) {
    return res.status(500).json({ error: '서버 오류: ' + err.message });
  }
}
