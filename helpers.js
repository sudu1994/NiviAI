// GET /api/health
const { handleOptions, ok } = require('./lib/helpers');

module.exports = function handler(req, res) {
  if (handleOptions(req, res)) return;

  ok(res, {
    status: 'ok',
    timestamp: new Date().toISOString(),
    sources: {
      rakuten:     !!process.env.RAKUTEN_APP_ID,
      youtube:     !!process.env.YOUTUBE_API_KEY,
      serpapi:     !!process.env.SERPAPI_KEY,
      tiktok:      !!process.env.TIKAPI_KEY || !!process.env.APIFY_TOKEN,
      twitter:     !!process.env.TWITTER_BEARER_TOKEN,
    }
  });
};
