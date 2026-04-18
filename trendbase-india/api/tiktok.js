// GET /api/tiktok?keyword=副業
// TikTok trending Japan — requires paid third-party API
// Option A: TikAPI  $10/month  https://tikapi.io  → TIKAPI_KEY
// Option B: Apify   $0.001/100 https://apify.com  → APIFY_TOKEN
const axios = require('axios');
const { handleOptions, ok, err } = require('./lib/helpers');

const TIKAPI_KEY  = process.env.TIKAPI_KEY;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  // Option A: TikAPI
  if (TIKAPI_KEY) {
    try {
      const r = await axios.get('https://api.tikapi.io/public/explore', {
        headers: { 'X-API-KEY': TIKAPI_KEY },
        params: { country: 'JP', count: 20 },
        timeout: 10000,
      });

      const videos = (r.data.itemList || []);
      const freq = {};
      videos
        .flatMap(v => v.challengeInfoList?.map(c => c.challengeName) || [])
        .forEach(tag => { freq[tag] = (freq[tag] || 0) + 1; });

      const hashtags = Object.entries(freq)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count }));

      return ok(res, {
        source: 'tikapi',
        region: 'JP',
        trendingHashtags: hashtags,
        videoCount: videos.length,
      });
    } catch (e) {
      console.error('TikAPI error:', e.message);
      // fall through to Apify
    }
  }

  // Option B: Apify
  if (APIFY_TOKEN) {
    try {
      const r = await axios.post(
        'https://api.apify.com/v2/acts/novi~tiktok-trend-api/run-sync-get-dataset-items',
        { country: 'JP', maxItems: 20 },
        {
          params: { token: APIFY_TOKEN },
          timeout: 30000,
        }
      );
      return ok(res, {
        source: 'apify_tiktok',
        region: 'JP',
        items: r.data || [],
      });
    } catch (e) {
      console.error('Apify error:', e.message);
    }
  }

  // No key — return mock + clear setup instructions
  return ok(res, {
    mock: true,
    setup: {
      optionA: { name: 'TikAPI', price: '$10/month', url: 'https://tikapi.io', envVar: 'TIKAPI_KEY' },
      optionB: { name: 'Apify', price: '$0.001/100 results', url: 'https://apify.com', envVar: 'APIFY_TOKEN' },
    },
    data: {
      note: 'Mock data — add TIKAPI_KEY or APIFY_TOKEN to Vercel env vars',
      trendingHashtags: [
        { tag: '副業', count: 8 }, { tag: '在宅ワーク', count: 6 },
        { tag: 'AI活用', count: 5 }, { tag: '日本生活', count: 4 },
      ],
    },
  });
};
