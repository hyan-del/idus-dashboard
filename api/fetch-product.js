export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body;
  if (!url || !url.includes('idus.com')) {
    return res.status(400).json({ error: '올바른 아이디어스 URL을 입력해주세요.' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      }
    });

    const html = await response.text();

    const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/)?.[1]
                 || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:title"/)?.[1];
    const ogDesc  = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/)?.[1]
                 || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:description"/)?.[1];
    const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/)?.[1]
                 || html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:image"/)?.[1];

    const productName = ogTitle?.replace(/ - 아이디어스| \| 아이디어스/g, '').trim() || '';

    return res.json({ productName, description: ogDesc || '', image: ogImage || '' });

  } catch (err) {
    return res.status(500).json({ error: '작품 정보를 가져오지 못했습니다.' });
  }
}
