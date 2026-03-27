require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app     = express();
const PORT    = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

if (!API_KEY) {
  console.error('ANTHROPIC_API_KEY 가 .env에 설정되지 않았습니다.');
  process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── 아이디어스 작품 크롤링 엔드포인트 ────────────────────────
app.post('/api/fetch-product', async (req, res) => {
  const { url } = req.body;
  if (!url || !url.includes('idus.com')) {
    return res.status(400).json({ error: '올바른 아이디어스 URL을 입력해주세요.' });
  }

  try {
    // 브라우저처럼 요청
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://www.idus.com',
      }
    });

    const html = await response.text();

    // 제목 추출 (og:title, title 태그 등)
    const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/)?.[1]
                 || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:title"/)?.[1];
    const title   = html.match(/<title[^>]*>([^<]+)<\/title>/)?.[1];
    const ogDesc  = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/)?.[1]
                 || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:description"/)?.[1];
    const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/)?.[1]
                 || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/)?.[1];

    // 카테고리 추출 시도 (breadcrumb, JSON-LD 등)
    const jsonLd = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g);
    let category = '';
    let price = '';
    if (jsonLd) {
      for (const block of jsonLd) {
        try {
          const data = JSON.parse(block.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''));
          if (data['@type'] === 'Product') {
            category = data.category || '';
            price = data.offers?.price || '';
          }
        } catch(e) {}
      }
    }

    const productName = ogTitle?.replace(' - 아이디어스', '').replace(' | 아이디어스', '').trim()
                     || title?.replace(' - 아이디어스', '').trim()
                     || '';

    console.log('크롤링 결과:', { productName, category, price });

    return res.json({
      productName,
      description: ogDesc || '',
      image: ogImage || '',
      category,
      price,
      rawTitle: title || '',
    });

  } catch (err) {
    console.error('크롤링 오류:', err.message);
    return res.status(500).json({ error: '작품 정보를 가져오지 못했습니다: ' + err.message });
  }
});

// ── Anthropic API 호출 헬퍼 ──────────────────────────────────
async function callAnthropic(payload, useWebSearch) {
  const headers = {
    'Content-Type':      'application/json',
    'x-api-key':         API_KEY,
    'anthropic-version': '2023-06-01',
  };
  if (useWebSearch) headers['anthropic-beta'] = 'web-search-2025-03-05';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers,
    body:    JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

// ── Claude API 프록시 (web_search 멀티턴 루프 포함) ──────────
app.post('/api/claude', async (req, res) => {
  try {
    const { messages, tools, model, max_tokens } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages 배열이 필요합니다.' });
    }

    const useWebSearch = (tools || []).some(t => t.type === 'web_search_20250305');

    let payload = {
      model:      model      || 'claude-sonnet-4-20250514',
      max_tokens: max_tokens || 2000,
      messages:   [...messages],
      ...(tools && tools.length ? { tools } : {}),
    };

    let finalResponse = null;
    for (let i = 0; i < 6; i++) {
      const { status, body } = await callAnthropic(payload, useWebSearch);

      if (status !== 200) {
        console.error('Anthropic 오류:', body);
        return res.status(status).json({ error: body?.error?.message || '업스트림 오류' });
      }

      if (body.stop_reason !== 'tool_use') {
        finalResponse = body;
        break;
      }

      const toolUseBlocks = body.content.filter(b => b.type === 'tool_use');
      if (!toolUseBlocks.length) { finalResponse = body; break; }

      payload.messages.push({ role: 'assistant', content: body.content });

      const toolResults = toolUseBlocks.map(block => ({
        type:        'tool_result',
        tool_use_id: block.id,
        content:     block.type === 'web_search_tool_result'
                       ? block.content
                       : (block.output || '검색 결과 없음'),
      }));

      payload.messages.push({ role: 'user', content: toolResults });
    }

    if (!finalResponse) {
      return res.status(500).json({ error: '응답을 받지 못했습니다. 다시 시도해주세요.' });
    }

    return res.json(finalResponse);

  } catch (err) {
    console.error('서버 오류:', err);
    return res.status(500).json({ error: '서버 내부 오류: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log('서버 실행 중 → http://localhost:' + PORT);
  console.log('API 키: ' + API_KEY.slice(0, 16) + '...****');
});
