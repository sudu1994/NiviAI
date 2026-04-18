// POST /api/validate
// Body: { idea: "online JEE tutoring", lang: "en", market: "india" }
const { handleOptions, ok, err } = require('./lib/helpers');

const SERPAPI_KEY     = process.env.SERPAPI_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const AMAZON_KEY      = process.env.AMAZON_ACCESS_KEY;
const AMAZON_SECRET   = process.env.AMAZON_SECRET_KEY;
const AMAZON_TAG      = process.env.AMAZON_PARTNER_TAG;
const CLAUDE_KEY      = process.env.ANTHROPIC_API_KEY;

// ── Google Trends India ───────────────────────────────────────
async function fetchGoogleTrendsIndia(keyword) {
  if (!SERPAPI_KEY) return null;
  try {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google_trends');
    url.searchParams.set('q', keyword);
    url.searchParams.set('geo', 'IN');       // India
    url.searchParams.set('date', 'today 12-m');
    url.searchParams.set('api_key', SERPAPI_KEY);
    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const data = await r.json();
    const timeline = data.interest_over_time?.timeline_data || [];
    const values = timeline.map(d => d.values?.[0]?.extracted_value || 0);
    if (!values.length) return null;
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const recentAvg = values.slice(-4).reduce((s,v) => s+v, 0) / Math.max(1, values.slice(-4).length);
    const trend = recentAvg > avg * 1.1 ? 'rising' : recentAvg < avg * 0.85 ? 'falling' : 'stable';
    // Also fetch related queries
    let rising = [];
    try {
      const rUrl = new URL('https://serpapi.com/search.json');
      rUrl.searchParams.set('engine', 'google_trends');
      rUrl.searchParams.set('q', keyword);
      rUrl.searchParams.set('geo', 'IN');
      rUrl.searchParams.set('data_type', 'RELATED_QUERIES');
      rUrl.searchParams.set('api_key', SERPAPI_KEY);
      const rr = await fetch(rUrl.toString(), { signal: AbortSignal.timeout(8000) });
      if (rr.ok) {
        const rd = await rr.json();
        rising = (rd.related_queries?.rising || []).slice(0,5).map(q => q.query);
      }
    } catch {}
    return { avgInterest: Math.round(avg), recentTrend: trend, peakValue: Math.max(...values), risingQueries: rising };
  } catch { return null; }
}

// ── YouTube India ─────────────────────────────────────────────
async function fetchYouTubeIndia(keyword) {
  if (!YOUTUBE_API_KEY) return null;
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('q', keyword);
    url.searchParams.set('type', 'video');
    url.searchParams.set('regionCode', 'IN');        // India
    url.searchParams.set('relevanceLanguage', 'en'); // English results
    url.searchParams.set('order', 'viewCount');
    url.searchParams.set('maxResults', '10');
    url.searchParams.set('publishedAfter', sixMonthsAgo.toISOString());
    url.searchParams.set('key', YOUTUBE_API_KEY);
    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json();
    return { totalResults: data.pageInfo?.totalResults || 0 };
  } catch { return null; }
}

// ── Amazon India ──────────────────────────────────────────────
// Amazon PA API requires AWS Signature v4 — complex to set up.
// For MVP, we use a simpler proxy: check if keyword appears in
// Amazon India search via SerpAPI (uses same key, different engine).
async function fetchAmazonIndia(keyword) {
  if (!SERPAPI_KEY) return null;
  try {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'amazon');
    url.searchParams.set('q', keyword);
    url.searchParams.set('amazon_domain', 'amazon.in');  // India
    url.searchParams.set('api_key', SERPAPI_KEY);
    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const data = await r.json();
    const results = data.organic_results || data.search_results || [];
    const prices = results
      .map(i => parseFloat((i.price?.raw || '').replace(/[^0-9.]/g, '')))
      .filter(p => !isNaN(p) && p > 0);
    const avgPrice = prices.length ? Math.round(prices.reduce((s,p) => s+p, 0) / prices.length) : 0;
    return {
      resultCount: results.length,
      avgPrice,
      level: results.length > 50 ? '高い' : results.length > 20 ? '中程度' : '低い',
    };
  } catch { return null; }
}

// ── Claude AI — India focused ─────────────────────────────────
async function fetchClaudeIndia(keyword, scores) {
  if (!CLAUDE_KEY) return null;
  const prompt = `You are a India market business advisor specialising in side-hustles and freelancing.

Business idea: "${keyword}"
Scores — demand:${scores.demand.score}/100, competition:${scores.competition.score}/100, monetisation:${scores.monetization.score}/100, overall:${scores.overall}/100
Google Trends India: ${scores._trendDir || 'unknown'}

Return ONLY valid JSON — no markdown, no extra text:
{
  "summary": "2-3 sentences on the market opportunity in India",
  "nicheAdvice": "1-2 sentences on a low-competition niche angle specific to India (mention Tier-2 cities, regional angle, or underserved segment if relevant)",
  "pricingAdvice": "Recommended pricing in rupees (₹) with brief reasoning based on Indian purchasing power",
  "firstStep": "One concrete action to take today using India channels (WhatsApp, local Facebook groups, Fiverr, Urban Company, etc.)",
  "warning": "One key risk or challenge specific to the India market",
  "kaizen": {
    "v1": "current idea as-is",
    "v2": "niche-refined version for India (e.g. Tier-2 cities, specific regional segment)",
    "v3": "monetisation-optimised version (subscription or productised service)"
  },
  "roadmap": [
    {"day":1,"task":"specific India-focused action"},
    {"day":2,"task":"specific India-focused action"},
    {"day":3,"task":"specific India-focused action"},
    {"day":4,"task":"specific India-focused action"},
    {"day":5,"task":"specific India-focused action"},
    {"day":6,"task":"specific India-focused action"},
    {"day":7,"task":"specific India-focused action"}
  ],
  "monetizationPaths": [
    {"platform":"platform name","priceRange":"₹ price range"},
    {"platform":"platform name","priceRange":"₹ price range"},
    {"platform":"platform name","priceRange":"₹ price range"}
  ]
}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1200,
        system: 'You are an India market business advisor. Respond ONLY in valid JSON — no markdown, no extra text.',
        messages: [{ role:'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!r.ok) return null;
    const data = await r.json();
    const text = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
    return JSON.parse(text);
  } catch (e) {
    console.error('Claude error:', e.message);
    return null;
  }
}

// ── Scoring ───────────────────────────────────────────────────
function calculateScores(trends, youtube, amazon) {
  let demand = 50, competition = 50, monetization = 50, socialBuzz = 50;
  let trendDir = 'unknown';

  if (trends) {
    trendDir = trends.recentTrend;
    if (trends.recentTrend === 'rising')  demand = Math.min(95, demand + 20);
    if (trends.recentTrend === 'falling') demand = Math.max(10, demand - 20);
    if (trends.avgInterest > 70) demand = Math.min(95, demand + 15);
    if (trends.avgInterest < 20) demand = Math.max(10, demand - 15);
    // Rising queries = high competition signal
    if (trends.risingQueries?.length > 3) competition = Math.min(85, competition + 20);
  }
  if (youtube?.totalResults) {
    if (youtube.totalResults > 100000) { demand = Math.min(95, demand+15); competition = Math.min(90, competition+20); }
    else if (youtube.totalResults > 20000) demand = Math.min(85, demand+8);
    socialBuzz = Math.min(90, 30 + Math.round(Math.log10(youtube.totalResults+1)*15));
  }
  if (amazon) {
    if (amazon.resultCount > 50) { demand = Math.min(95, demand+10); competition = Math.min(90, competition+15); }
    if (amazon.avgPrice > 1000) monetization = Math.min(85, monetization+20);
    else if (amazon.avgPrice > 300) monetization = Math.min(75, monetization+10);
  }

  const overall = Math.min(98, Math.max(5, Math.round(
    demand*0.35 + (100-competition)*0.20 + monetization*0.30 + socialBuzz*0.15
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

  const { idea } = req.body || {};
  if (!idea || idea.trim().length < 2) return err(res, 400, 'idea is required');
  const keyword = idea.trim();

  // All data sources in parallel
  const [trends, youtube, amazon] = await Promise.all([
    fetchGoogleTrendsIndia(keyword),
    fetchYouTubeIndia(keyword),
    fetchAmazonIndia(keyword),
  ]);

  const raw = calculateScores(trends, youtube, amazon);
  const scores = {
    demand:       { score: Math.round(raw.demand),       label: scoreLabel(raw.demand) },
    competition:  { score: Math.round(raw.competition),  label: scoreLabel(raw.competition) },
    monetization: { score: Math.round(raw.monetization), label: scoreLabel(raw.monetization) },
    socialBuzz:   { score: Math.round(raw.socialBuzz),   label: scoreLabel(raw.socialBuzz) },
    overall: raw.overall,
    _trendDir: raw._trendDir,
  };

  const ai = await fetchClaudeIndia(keyword, scores);

  const fallbackRoadmap = [
    { day:1, task:`Research 5 competitors in "${keyword}" and identify your angle` },
    { day:2, task:'Create a Fiverr gig or Urban Company profile' },
    { day:3, task:'Post in 5 WhatsApp groups and 3 local Facebook groups' },
    { day:4, task:'Optimise LinkedIn and send 20 targeted connections' },
    { day:5, task:'Offer 3 free/discounted sessions → collect testimonials' },
    { day:6, task:'Post an Instagram reel and an X thread about your service' },
    { day:7, task:'Review results, collect first payment, plan week 2' },
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
      googleTrends: { status: trends  ? 'ok' : 'failed', mock: !trends  },
      amazonIndia:  { status: amazon  ? 'ok' : 'failed', mock: !amazon  },
      youtube:      { status: youtube ? 'ok' : 'failed', mock: !youtube },
      claudeAI:     { status: ai      ? 'ok' : 'failed', mock: !ai      },
    },
    kaizen:            ai?.kaizen            || fallbackKaizen,
    monetizationPaths: ai?.monetizationPaths || fallbackMoney,
    roadmap:           ai?.roadmap           || fallbackRoadmap,
    sideJobCompatibility: {
      hoursRequired: raw.demand > 70 ? '10–20 hrs/week' : '5–10 hrs/week',
      startupCost: '₹0–₹2,000',
      jobConflictRisk: raw.competition > 75 ? 'Medium' : 'Low',
      verdict: raw.overall >= 65
        ? 'Good side-hustle potential. Realistic alongside a full-time job.'
        : 'Market exists but strong differentiation is essential.',
    },
  });
};
