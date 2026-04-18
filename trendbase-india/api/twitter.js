// GET /api/twitter?keyword=副業
// Twitter/X API v2 — Basic tier $100/month
// Skip for MVP — mark as optional
const axios = require('axios');
const { handleOptions, ok, err } = require('./lib/helpers');

const BEARER = process.env.TWITTER_BEARER_TOKEN;

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const keyword = req.query.keyword || '副業';

  if (!BEARER) {
    return ok(res, {
      mock: true,
      setup: 'X API Basic at https://developer.x.com ($100/month) — skip for MVP',
      data: {
        note: 'Mock',
        keyword,
        resultCount: 760,
        socialBuzzScore: 62,
      },
    });
  }

  try {
    const r = await axios.get(
      'https://api.twitter.com/2/tweets/search/recent',
      {
        headers: { Authorization: `Bearer ${BEARER}` },
        params: {
          query: `${keyword} lang:ja -is:retweet`,
          max_results: 100,
          'tweet.fields': 'public_metrics',
        },
        timeout: 8000,
      }
    );

    const tweets = r.data.data || [];
    const totalEng = tweets.reduce((s, t) => {
      const m = t.public_metrics || {};
      return s + (m.like_count || 0) + (m.retweet_count || 0) + (m.reply_count || 0);
    }, 0);

    return ok(res, {
      source: 'twitter_v2',
      keyword,
      resultCount: r.data.meta?.result_count || 0,
      socialBuzzScore: Math.min(100, Math.round(totalEng / 100)),
    });

  } catch (e) {
    return err(res, 500, e.message, { mock: true });
  }
};
