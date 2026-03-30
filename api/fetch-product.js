export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // body 파싱 방어
  let url = '';
  try {
    if (typeof req.body === 'string') {
      url = JSON.parse(req.body).url;
    } else {
      url = req.body?.url;
    }
  } catch(e) {
    return res.status(400).json({ error: 'body 파싱 오류: ' + e.message });
  }

  if (!url) return res.status(400).json({ error: 'URL이 없습니다.' });
  if (!url.includes('idus.com') && !url.includes('idus.kr')) {
    return res.status(400).json({ error: '올바른 아이디어스 URL을 입력해주세요.' });
  }

  try {
    // 여러 User-Agent 시도
    const userAgents = [
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Twitterbot/1.0',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    ];

    let productName = '';
    let description = '';
    let image = '';
    let finalUrl = url;

    for (const ua of userAgents) {
      try {
        const r = await fetch(url, {
          redirect: 'follow',
          headers: {
            'User-Agent': ua,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ko-KR,ko;q=0.9',
          }
        });

        finalUrl = r.url;
        const html = await r.text();

        // og:title 다양한 패턴으로 추출
        const title =
          html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)?.[1] ||
          html.match(/<meta\s+content="([^"]+)"\s+property="og:title"/i)?.[1] ||
          html.match(/<meta[^>]+og:title[^>]+content="([^"]+)"/i)?.[1] ||
          html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '';

        const desc =
          html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i)?.[1] ||
          html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1] || '';

        const img =
          html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1] || '';

        const cleaned = title.replace(/ [-|] 아이디어스.*/g, '').replace(/아이디어스 [-|] /g, '').trim();

        if (cleaned && cleaned !== '아이디어스' && cleaned.length > 1) {
          productName = cleaned;
          description = desc;
          image = img;
          break;
        }
      } catch(e) {
        console.error('UA 시도 실패:', ua, e.message);
      }
    }

    return res.json({ productName, description, image, finalUrl });

  } catch (err) {
    console.error('fetch-product error:', err);
    return res.status(500).json({ error: err.message });
  }
}
