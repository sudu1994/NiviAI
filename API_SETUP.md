// GET /api/trending
// Returns top trending searches in India right now from Google Trends
// Cached at Vercel edge for 30 minutes — uses SerpAPI's free cache tier

const { handleOptions, ok, err } = require('./lib/helpers');

const SERPAPI_KEY = process.env.SERPAPI_KEY;

// Curated India side-hustle relevant fallbacks
// Used when SerpAPI is not configured or returns nothing useful
const FALLBACK = [
  'JEE coaching online',
  'freelance graphic design India',
  'earn from home India',
  'dropshipping business India',
  'social media manager',
  'content creator income India',
  'Meesho reselling tips',
  'Upwork profile tips',
  'online tutoring setup',
  'Instagram monetisation India',
  'digital marketing freelance',
  'YouTube channel ideas India',
  'Fiverr gig ranking tips',
  'Urban Company partner',
  'side income for engineers',
];

module.exports = async function handler(req, res) {
  // CORS
  if (handleOptions(req, res)) return;

  // Cache at edge for 30 minutes
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=300');

  if (!SERPAPI_KEY) {
    return ok(res, { trends: FALLBACK, source: 'fallback', reason: 'SERPAPI_KEY not configured' });
  }

  try {
    // Use google_trends_trending_now with realtime frequency, geo=IN
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google_trends_trending_now');
    url.searchParams.set('frequency', 'realtime');
    url.searchParams.set('geo', 'IN');
    url.searchParams.set('hl', 'en');
    url.searchParams.set('cat', 'all');
    url.searchParams.set('api_key', SERPAPI_KEY);

    const r = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`SerpAPI status ${r.status}`);

    const data = await r.json();

    // Extract queries from realtime_searches
    const trends = [];
    const searches = data.realtime_searches || [];
    for (const item of searches) {
      if (!item.queries) continue;
      for (const q of item.queries) {
        const clean = q.trim();
        if (clean.length > 2 && clean.length < 60 && !trends.includes(clean)) {
          trends.push(clean);
        }
        if (trends.length >= 20) break;
      }
      if (trends.length >= 20) break;
    }

    if (trends.length < 5) {
      // Also try daily trends as backup
      const url2 = new URL('https://serpapi.com/search.json');
      url2.searchParams.set('engine', 'google_trends_trending_now');
      url2.searchParams.set('frequency', 'daily');
      url2.searchParams.set('geo', 'IN');
      url2.searchParams.set('hl', 'en');
      url2.searchParams.set('api_key', SERPAPI_KEY);
      const r2 = await fetch(url2.toString(), { signal: AbortSignal.timeout(8000) });
      if (r2.ok) {
        const d2 = await r2.json();
        const daily = d2.daily_searches || [];
        for (const day of daily) {
          for (const s of (day.searches || [])) {
            const q = (s.query || '').trim();
            if (q.length > 2 && q.length < 60 && !trends.includes(q)) {
              trends.push(q);
            }
            if (trends.length >= 20) break;
          }
          if (trends.length >= 20) break;
        }
      }
    }

    return ok(res, {
      trends: trends.length >= 3 ? trends : FALLBACK,
      source: trends.length >= 3 ? 'live' : 'fallback',
      count: trends.length,
      geo: 'IN',
      timestamp: new Date().toISOString(),
    });

  } catch (e) {
    console.error('Trending fetch error:', e.message);
    return ok(res, {
      trends: FALLBACK,
      source: 'fallback',
      reason: e.message,
    });
  }
};
