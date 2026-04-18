// GET /api/tiktok?keyword=JEE+coaching
// TikTok trending India — two provider options
// Option A: TikAPI  $10/month  https://tikapi.io      → TIKAPI_KEY
// Option B: Apify   pay-per-use https://apify.com     → APIFY_TOKEN
// Both fall back to mock data if no key is set

const { handleOptions, ok, err } = require('./lib/helpers');

const TIKAPI_KEY  = process.env.TIKAPI_KEY;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const keyword = req.query.keyword || '';

  // ── Option A: TikAPI ─────────────────────────────────────────
  if (TIKAPI_KEY) {
    try {
      // Search hashtags related to keyword
      const searchUrl = new URL('https://api.tikapi.io/public/search/hashtag');
      searchUrl.searchParams.set('query', keyword);
      searchUrl.searchParams.set('count', '20');

      const r = await fetch(searchUrl.toString(), {
        headers: {
          'X-API-KEY': TIKAPI_KEY,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!r.ok) throw new Error(`TikAPI ${r.status}`);
      const data = await r.json();

      // Also fetch India trending
      const trendUrl = new URL('https://api.tikapi.io/public/explore');
      trendUrl.searchParams.set('country', 'IN');  // India
      trendUrl.searchParams.set('count', '20');

      const tr = await fetch(trendUrl.toString(), {
        headers: { 'X-API-KEY': TIKAPI_KEY, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      let trendingHashtags = [];
      if (tr.ok) {
        const tdata = await tr.json();
        const videos = tdata.itemList || [];
        const freq = {};
        videos
          .flatMap(v => v.challengeInfoList?.map(c => c.challengeName) || [])
          .filter(Boolean)
          .forEach(tag => { freq[tag] = (freq[tag] || 0) + 1; });
        trendingHashtags = Object.entries(freq)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(([tag, count]) => ({ tag, count }));
      }

      // Extract hashtag views from search
      const hashtagData = (data.hashtags || data.list || []).slice(0, 5).map(h => ({
        name: h.hashtag?.title || h.challengeName || '',
        viewCount: h.hashtag?.viewCount || h.stats?.viewCount || 0,
      }));

      return ok(res, {
        source: 'tikapi',
        region: 'IN',
        keyword,
        hashtagData,
        trendingHashtags,
        mock: false,
      });
    } catch (e) {
      console.error('TikAPI error:', e.message);
      // fall through to Apify
    }
  }

  // ── Option B: Apify ──────────────────────────────────────────
  if (APIFY_TOKEN) {
    try {
      // Use Apify's TikTok Hashtag Scraper actor
      const r = await fetch(
        `https://api.apify.com/v2/acts/clockworks~tiktok-hashtag-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hashtags: [keyword.replace(/\s+/g, '')],
            resultsPerPage: 10,
          }),
          signal: AbortSignal.timeout(35000),
        }
      );

      if (!r.ok) throw new Error(`Apify ${r.status}`);
      const items = await r.json();

      return ok(res, {
        source: 'apify_tiktok',
        region: 'IN',
        keyword,
        videoCount: items.length,
        items: items.slice(0, 10),
        mock: false,
      });
    } catch (e) {
      console.error('Apify TikTok error:', e.message);
    }
  }

  // ── No key — mock response ───────────────────────────────────
  return ok(res, {
    mock: true,
    region: 'IN',
    keyword,
    setup: {
      optionA: {
        name: 'TikAPI',
        price: '$10/month',
        url: 'https://tikapi.io',
        envVar: 'TIKAPI_KEY',
        note: 'Best option — stable, India region supported',
      },
      optionB: {
        name: 'Apify',
        price: 'Pay-per-use ~$0.001/result',
        url: 'https://apify.com',
        envVar: 'APIFY_TOKEN',
        note: 'Good for low volume — no monthly commitment',
      },
    },
    data: {
      trendingHashtags: [
        { tag: 'sidehustle', count: 12 },
        { tag: 'freelanceindia', count: 9 },
        { tag: 'workfromhome', count: 8 },
        { tag: 'earnmoney', count: 7 },
        { tag: 'digitalmarketing', count: 6 },
      ],
    },
  });
};
