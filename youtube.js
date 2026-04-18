// GET /api/twitter?keyword=JEE+coaching
// Twitter/X API v2 — Basic tier $100/month https://developer.x.com
// Returns tweet volume and engagement for keyword in India
// Skip for MVP — mark as optional in the UI

const { handleOptions, ok, err } = require('./lib/helpers');

const BEARER = process.env.TWITTER_BEARER_TOKEN;

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const keyword = req.query.keyword || '';

  if (!BEARER) {
    return ok(res, {
      mock: true,
      setup: {
        name: 'Twitter / X API Basic',
        price: '$100/month',
        url: 'https://developer.x.com/en/portal/products/basic',
        envVar: 'TWITTER_BEARER_TOKEN',
        note: 'Skip for MVP — expensive. Add after reaching 50+ paying users.',
      },
      data: {
        keyword,
        resultCount: 0,
        socialBuzzScore: 0,
      },
    });
  }

  try {
    // Search recent tweets about keyword in India context
    // India: place_country:IN OR common India-related terms
    const query = encodeURIComponent(
      `${keyword} (india OR india OR भारत) lang:en -is:retweet -is:reply`
    );

    const r = await fetch(
      `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=100&tweet.fields=public_metrics,geo&expansions=geo.place_id&place.fields=country_code`,
      {
        headers: {
          Authorization: `Bearer ${BEARER}`,
          'User-Agent': 'TrendBaseAI/1.0',
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      throw new Error(`Twitter API ${r.status}: ${errData.detail || errData.title || 'unknown'}`);
    }

    const data = await r.json();
    const tweets = data.data || [];

    const totalEngagement = tweets.reduce((s, t) => {
      const m = t.public_metrics || {};
      return s + (m.like_count || 0) + (m.retweet_count || 0) + (m.reply_count || 0);
    }, 0);

    const resultCount = data.meta?.result_count || tweets.length;
    // Score: normalise engagement to 0-100
    const socialBuzzScore = Math.min(100, Math.round(
      (resultCount / 100) * 40 + Math.min(60, totalEngagement / 50)
    ));

    return ok(res, {
      source: 'twitter_v2',
      region: 'IN',
      keyword,
      resultCount,
      totalEngagement,
      socialBuzzScore,
      mock: false,
    });

  } catch (e) {
    console.error('Twitter error:', e.message);
    // Return a safe fallback rather than breaking the whole validation
    return ok(res, {
      mock: true,
      error: e.message,
      data: { keyword, resultCount: 0, socialBuzzScore: 0 },
    });
  }
};
