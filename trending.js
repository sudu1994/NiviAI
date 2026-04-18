// POST /api/validate
// Body: { idea: "online JEE tutoring", market: "india" }
// Calls all 6 data sources in parallel, returns unified strategy

const { handleOptions, ok, err } = require('./lib/helpers');

// ── Environment variables ─────────────────────────────────────
const SERPAPI_KEY      = process.env.SERPAPI_KEY;
const YOUTUBE_API_KEY  = process.env.YOUTUBE_API_KEY;
const CLAUDE_KEY       = process.env.ANTHROPIC_API_KEY;
const TIKAPI_KEY       = process.env.TIKAPI_KEY;
const APIFY_TOKEN      = process.env.APIFY_TOKEN;
const TWITTER_BEARER   = process.env.TWITTER_BEARER_TOKEN;

// ── Simple in-memory rate limiter ─────────────────────────────
// 10 requests per IP per hour — protects API costs
const rateMap = new Map();
function checkRate(ip) {
  const now = Date.now();
  const window = 60 * 60 * 1000; // 1 hour
  const limit = 10;
  const entry = rateMap.get(ip) || { count: 0, reset: now + window };
  if (now > entry.reset) {
    rateMap.set(ip, { count: 1, reset: now + window });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  rateMap.set(ip, entry);
  // Clean old entries every 500 requests
  if (rateMap.size > 500) {
    for (const [k, v] of rateMap) { if (now > v.reset) rateMap.delete(k); }
  }
  return true;
}

// ── 1. Google Trends India ────────────────────────────────────
async function fetchGoogleTrends(keyword) {
  if (!SERPAPI_KEY) return null;
  try {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google_trends');
    url.searchParams.set('q', keyword);
    url.searchParams.set('geo', 'IN');
    url.searchParams.set('date', 'today 12-m');
    url.searchParams.set('api_key', SERPAPI_KEY);

    const [trendsRes, relRes] = await Promise.allSettled([
      fetch(url.toString(), { signal: AbortSignal.timeout(10000) }),
      fetch((() => {
        const u = new URL('https://serpapi.com/search.json');
        u.searchParams.set('engine', 'google_trends');
        u.searchParams.set('q', keyword);
        u.searchParams.set('geo', 'IN');
        u.searchParams.set('data_type', 'RELATED_QUERIES');
        u.searchParams.set('api_key', SERPAPI_KEY);
        return u.toString();
      })(), { signal: AbortSignal.timeout(8000) }),
    ]);

    let avgInterest = 0, recentTrend = 'stable', peakValue = 0, risingQueries = [];

    if (trendsRes.status === 'fulfilled' && trendsRes.value.ok) {
      const d = await trendsRes.value.json();
      const timeline = d.interest_over_time?.timeline_data || [];
      const values = timeline.map(t => t.values?.[0]?.extracted_value || 0);
      if (values.length) {
        avgInterest = Math.round(values.reduce((s, v) => s + v, 0) / values.length);
        peakValue = Math.max(...values);
        const recentAvg = values.slice(-4).reduce((s, v) => s + v, 0) / 4;
        recentTrend = recentAvg > avgInterest * 1.1 ? 'rising'
          : recentAvg < avgInterest * 0.85 ? 'falling' : 'stable';
      }
    }

    if (relRes.status === 'fulfilled' && relRes.value.ok) {
      const rd = await relRes.value.json();
      risingQueries = (rd.related_queries?.rising || []).slice(0, 5).map(q => q.query);
    }

    return { avgInterest, recentTrend, peakValue, risingQueries };
  } catch { return null; }
}

// ── 2. Amazon India ───────────────────────────────────────────
async function fetchAmazonIndia(keyword) {
  if (!SERPAPI_KEY) return null;
  try {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'amazon');
    url.searchParams.set('q', keyword);
    url.searchParams.set('amazon_domain', 'amazon.in');
    url.searchParams.set('api_key', SERPAPI_KEY);

    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const data = await r.json();

    const results = data.organic_results || data.search_results || [];
    const prices = results
      .map(i => parseFloat((i.price?.raw || i.extracted_price || '').toString().replace(/[^0-9.]/g, '')))
      .filter(p => !isNaN(p) && p > 0);
    const avgPrice = prices.length ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length) : 0;
    const reviewCounts = results.map(i => i.reviews?.total || 0).filter(n => n > 0);
    const totalReviews = reviewCounts.reduce((s, n) => s + n, 0);

    return {
      resultCount: results.length,
      avgPrice,
      totalReviews,
      demandLevel: results.length > 50 ? 'high' : results.length > 20 ? 'medium' : 'low',
    };
  } catch { return null; }
}

// ── 3. YouTube India ──────────────────────────────────────────
async function fetchYouTubeIndia(keyword) {
  if (!YOUTUBE_API_KEY) return null;
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('q', keyword);
    url.searchParams.set('type', 'video');
    url.searchParams.set('regionCode', 'IN');
    url.searchParams.set('relevanceLanguage', 'en');
    url.searchParams.set('order', 'viewCount');
    url.searchParams.set('maxResults', '10');
    url.searchParams.set('publishedAfter', sixMonthsAgo.toISOString());
    url.searchParams.set('key', YOUTUBE_API_KEY);

    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json();

    return {
      totalResults: data.pageInfo?.totalResults || 0,
      resultsReturned: data.items?.length || 0,
    };
  } catch { return null; }
}

// ── 4. TikTok India ───────────────────────────────────────────
async function fetchTikTokIndia(keyword) {
  if (!TIKAPI_KEY && !APIFY_TOKEN) return null;
  try {
    if (TIKAPI_KEY) {
      const url = new URL('https://api.tikapi.io/public/explore');
      url.searchParams.set('country', 'IN'); // India
      url.searchParams.set('count', '20');
      const r = await fetch(url.toString(), {
        headers: { 'X-API-KEY': TIKAPI_KEY },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(`TikAPI ${r.status}`);
      const data = await r.json();
      const videos = data.itemList || [];
      const freq = {};
      videos.flatMap(v => v.challengeInfoList?.map(c => c.challengeName) || [])
        .filter(Boolean)
        .forEach(tag => { freq[tag] = (freq[tag] || 0) + 1; });
      return {
        source: 'tikapi',
        videoCount: videos.length,
        trendingTags: Object.entries(freq).sort(([,a],[,b])=>b-a).slice(0,5).map(([tag])=>tag),
      };
    }
    if (APIFY_TOKEN) {
      // Lighter Apify call — just get trending IN data
      const r = await fetch(
        `https://api.apify.com/v2/acts/novi~tiktok-trend-api/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ country: 'IN', maxItems: 10 }),
          signal: AbortSignal.timeout(30000),
        }
      );
      if (!r.ok) return null;
      const items = await r.json();
      return { source: 'apify', videoCount: items.length };
    }
  } catch { return null; }
  return null;
}

// ── 5. Twitter / X India ──────────────────────────────────────
async function fetchTwitterIndia(keyword) {
  if (!TWITTER_BEARER) return null;
  try {
    const query = encodeURIComponent(
      `${keyword} (india OR भारत) lang:en -is:retweet -is:reply`
    );
    const r = await fetch(
      `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=100&tweet.fields=public_metrics`,
      {
        headers: { Authorization: `Bearer ${TWITTER_BEARER}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!r.ok) return null;
    const data = await r.json();
    const tweets = data.data || [];
    const engagement = tweets.reduce((s, t) => {
      const m = t.public_metrics || {};
      return s + (m.like_count||0) + (m.retweet_count||0) + (m.reply_count||0);
    }, 0);
    return {
      resultCount: data.meta?.result_count || tweets.length,
      engagement,
    };
  } catch { return null; }
}

// ── 6. Claude AI ──────────────────────────────────────────────
async function fetchClaudeAI(keyword, scores) {
  if (!CLAUDE_KEY) return null;
  try {
    const prompt = `You are an India market business advisor specialising in side-hustles and freelancing.

Business idea: "${keyword}"
Scores (0-100) — demand:${scores.demand.score}, competition:${scores.competition.score}, monetisation:${scores.monetization.score}, social:${scores.socialBuzz.score}, overall:${scores.overall}
Google Trends India trend: ${scores._trendDir || 'unknown'}

Return ONLY valid JSON — no markdown, no extra text, no code fences:
{
  "summary": "2-3 sentences on the market opportunity specifically in India in 2026",
  "nicheAdvice": "1-2 sentences on a low-competition niche for India — mention Tier-2 cities, regional angle, or underserved segment",
  "pricingAdvice": "Recommended ₹ pricing with brief reasoning based on Indian purchasing power and market rates",
  "firstStep": "One concrete action to take today using India channels (WhatsApp groups, Fiverr, Urban Company, Instagram Reels, etc.)",
  "warning": "One key risk or challenge specific to the India market",
  "kaizen": {
    "v1": "the idea as entered",
    "v2": "niche-refined version — more specific India segment or city tier",
    "v3": "monetisation-optimised version — subscription or productised service model"
  },
  "roadmap": [
    {"day":1,"task":"India-specific action"},
    {"day":2,"task":"India-specific action"},
    {"day":3,"task":"India-specific action"},
    {"day":4,"task":"India-specific action"},
    {"day":5,"task":"India-specific action"},
    {"day":6,"task":"India-specific action"},
    {"day":7,"task":"India-specific action"}
  ],
  "monetizationPaths": [
    {"platform":"platform name","priceRange":"₹ range"},
    {"platform":"platform name","priceRange":"₹ range"},
    {"platform":"platform name","priceRange":"₹ range"}
  ]
}`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // Use Haiku for free tier — 3x cheaper
        max_tokens: 1400,
        system: 'You are an India market business advisor. Respond ONLY in valid JSON — no markdown, no extra text, no code fences.',
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!r.ok) {
      console.error('Claude API error:', r.status);
      return null;
    }
    const data = await r.json();
    const text = (data.content?.[0]?.text || '')
      .replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    return JSON.parse(text);
  } catch (e) {
    console.error('Claude error:', e.message);
    return null;
  }
}

// ── Scoring engine ────────────────────────────────────────────
function calculateScores(trends, amazon, youtube, tiktok, twitter) {
  let demand = 50, competition = 50, monetization = 50, socialBuzz = 50;
  let trendDir = 'unknown';

  // Google Trends India signals
  if (trends) {
    trendDir = trends.recentTrend;
    if (trends.recentTrend === 'rising')  demand = Math.min(95, demand + 20);
    if (trends.recentTrend === 'falling') demand = Math.max(10, demand - 18);
    if (trends.avgInterest > 70)  demand = Math.min(95, demand + 15);
    if (trends.avgInterest > 40)  demand = Math.min(90, demand + 7);
    if (trends.avgInterest < 20)  demand = Math.max(10, demand - 15);
    if (trends.risingQueries?.length > 3) competition = Math.min(85, competition + 18);
  }

  // Amazon India signals
  if (amazon) {
    if (amazon.demandLevel === 'high')   { demand = Math.min(95, demand+12); competition = Math.min(88, competition+18); }
    if (amazon.demandLevel === 'medium') { demand = Math.min(85, demand+6); }
    if (amazon.avgPrice > 2000) monetization = Math.min(88, monetization + 22);
    else if (amazon.avgPrice > 500) monetization = Math.min(78, monetization + 12);
    if (amazon.totalReviews > 5000) competition = Math.min(90, competition + 10);
  }

  // YouTube India signals
  if (youtube?.totalResults) {
    if (youtube.totalResults > 100000) { demand = Math.min(95, demand+12); competition = Math.min(88, competition+15); }
    else if (youtube.totalResults > 20000) demand = Math.min(88, demand+7);
    socialBuzz = Math.min(88, 30 + Math.round(Math.log10(youtube.totalResults + 1) * 15));
  }

  // TikTok India signals (bonus boost if available)
  if (tiktok?.videoCount > 10) {
    socialBuzz = Math.min(92, socialBuzz + 8);
    demand = Math.min(92, demand + 5);
  }

  // Twitter India signals
  if (twitter?.resultCount > 50) {
    socialBuzz = Math.min(90, socialBuzz + 6);
    if (twitter.engagement > 500) demand = Math.min(92, demand + 4);
  }

  const overall = Math.min(98, Math.max(5, Math.round(
    demand * 0.35 +
    (100 - competition) * 0.20 +
    monetization * 0.30 +
    socialBuzz * 0.15
  )));

  return { demand, competition, monetization, socialBuzz, overall, _trendDir: trendDir };
}

function scoreLabel(score) {
  if (score >= 80) return 'Very high';
  if (score >= 60) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
}

function oppLabel(score) {
  if (score >= 80) return 'Very High Opportunity';
  if (score >= 65) return 'High Opportunity';
  if (score >= 50) return 'Medium Opportunity';
  if (score >= 35) return 'Limited Opportunity';
  return 'Difficult Market';
}

// ── Main handler ──────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return err(res, 405, 'POST only');

  // Rate limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  if (!checkRate(ip)) {
    return err(res, 429, 'Too many requests — please wait before validating again.');
  }

  const { idea } = req.body || {};
  if (!idea || typeof idea !== 'string' || idea.trim().length < 2) {
    return err(res, 400, 'idea is required (minimum 2 characters)');
  }
  // Sanitise input — strip HTML, limit length
  const keyword = idea.trim().replace(/<[^>]*>/g, '').slice(0, 200);

  // ── Fire all sources in parallel (15s max total) ──────────────
  const [trends, amazon, youtube, tiktok, twitter] = await Promise.all([
    fetchGoogleTrends(keyword),
    fetchAmazonIndia(keyword),
    fetchYouTubeIndia(keyword),
    fetchTikTokIndia(keyword),
    fetchTwitterIndia(keyword),
  ]);

  const raw = calculateScores(trends, amazon, youtube, tiktok, twitter);
  const scores = {
    demand:       { score: Math.round(raw.demand),       label: scoreLabel(raw.demand) },
    competition:  { score: Math.round(raw.competition),  label: scoreLabel(raw.competition) },
    monetization: { score: Math.round(raw.monetization), label: scoreLabel(raw.monetization) },
    socialBuzz:   { score: Math.round(raw.socialBuzz),   label: scoreLabel(raw.socialBuzz) },
    overall: raw.overall,
    _trendDir: raw._trendDir,
  };

  // Claude AI (runs after scoring so it gets scores as context)
  const ai = await fetchClaudeAI(keyword, scores);

  // ── Fallbacks ─────────────────────────────────────────────────
  const fallbackRoadmap = [
    { day:1, task:`Research 5 competitors in "${keyword.slice(0,30)}" and find your unique angle` },
    { day:2, task:'Create a Fiverr gig or Urban Company profile today' },
    { day:3, task:'Post in 5 WhatsApp groups and 3 local Facebook groups' },
    { day:4, task:'Send 20 personalised LinkedIn connection requests to target clients' },
    { day:5, task:'Offer 3 free or ₹99 intro sessions — collect honest testimonials' },
    { day:6, task:'Post a how-to reel on Instagram and a thread on X' },
    { day:7, task:'Review results, collect first payment, plan week 2 scaling' },
  ];
  const fallbackMoney = [
    { platform:'Fiverr / Upwork',         priceRange:'₹3,000–₹30,000/project' },
    { platform:'Urban Company / Sulekha', priceRange:'₹500–₹2,500/session' },
    { platform:'Instamojo / Razorpay',    priceRange:'₹299–₹4,999/product' },
    { platform:'Meesho / Flipkart',       priceRange:'15–40% margin' },
  ];
  const fallbackKaizen = {
    v1: { idea: keyword },
    v2: { idea: `${keyword} — Tier-2 city focus` },
    v3: { idea: `${keyword} — monthly subscription model` },
  };

  return ok(res, {
    idea: keyword,
    market: 'india',
    timestamp: new Date().toISOString(),
    aiPowered: !!ai,
    scores,
    opportunityScore: raw.overall,
    opportunityLabel: oppLabel(raw.overall),
    summary:       ai?.summary       || null,
    nicheAdvice:   ai?.nicheAdvice   || null,
    pricingAdvice: ai?.pricingAdvice || null,
    firstStep:     ai?.firstStep     || null,
    warning:       ai?.warning       || null,
    sources: {
      googleTrends: { status: trends  ? 'ok' : 'failed', mock: !trends },
      amazonIndia:  { status: amazon  ? 'ok' : 'failed', mock: !amazon },
      youtube:      { status: youtube ? 'ok' : 'failed', mock: !youtube },
      claudeAI:     { status: ai      ? 'ok' : 'failed', mock: !ai },
      tiktok:       { status: tiktok  ? 'ok' : 'skipped', mock: !tiktok, optional: true },
      twitter:      { status: twitter ? 'ok' : 'skipped', mock: !twitter, optional: true },
    },
    kaizen:            ai?.kaizen            || fallbackKaizen,
    monetizationPaths: ai?.monetizationPaths || fallbackMoney,
    roadmap:           ai?.roadmap           || fallbackRoadmap,
    sideJobCompatibility: {
      hoursRequired:  raw.demand > 70 ? '10–20 hrs/week' : '5–10 hrs/week',
      startupCost:    '₹0–₹2,000',
      jobConflictRisk: raw.competition > 75 ? 'Medium' : 'Low',
      verdict: raw.overall >= 65
        ? 'Good side-hustle potential. Realistic alongside a full-time job.'
        : 'Market exists but strong differentiation required.',
    },
  });
};
