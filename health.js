// GET /api/google-trends?keyword=副業
// Google Trends Japan — via SerpAPI
// Free tier: 100 searches/month at https://serpapi.com
// NOTE: pytrends (Python) does NOT work on Vercel — SerpAPI is the only option here
const axios = require('axios');
const { handleOptions, ok, err } = require('./lib/helpers');

const SERPAPI_KEY = process.env.SERPAPI_KEY;

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const keyword = req.query.keyword || '副業';

  if (!SERPAPI_KEY) {
    return ok(res, {
      mock: true,
      setup: 'Sign up free at https://serpapi.com (100 searches/month) → add SERPAPI_KEY to Vercel env vars',
      data: mockTrends(keyword),
    });
  }

  try {
    const [interestRes, relatedRes] = await Promise.allSettled([
      axios.get('https://serpapi.com/search.json', {
        params: {
          engine: 'google_trends',
          q: keyword,
          geo: 'JP',
          date: 'today 12-m',
          api_key: SERPAPI_KEY,
        },
        timeout: 10000,
      }),
      axios.get('https://serpapi.com/search.json', {
        params: {
          engine: 'google_trends',
          q: keyword,
          geo: 'JP',
          data_type: 'RELATED_QUERIES',
          api_key: SERPAPI_KEY,
        },
        timeout: 10000,
      }),
    ]);

    const timeline = interestRes.status === 'fulfilled'
      ? (interestRes.value.data.interest_over_time?.timeline_data || []).map(d => ({
          date: d.date,
          value: d.values?.[0]?.extracted_value || 0,
        }))
      : [];

    const values = timeline.map(t => t.value);
    const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 50;
    const recentAvg = values.slice(-4).length
      ? values.slice(-4).reduce((s, v) => s + v, 0) / values.slice(-4).length
      : avg;
    const trend = recentAvg > avg * 1.1 ? 'rising' : recentAvg < avg * 0.85 ? 'falling' : 'stable';

    const related = relatedRes.status === 'fulfilled'
      ? {
          rising: (relatedRes.value.data.related_queries?.rising || []).slice(0, 5),
          top: (relatedRes.value.data.related_queries?.top || []).slice(0, 5),
        }
      : { rising: [], top: [] };

    return ok(res, {
      source: 'google_trends_serpapi',
      keyword,
      geo: 'JP',
      summary: {
        avgInterest: Math.round(avg),
        recentTrend: trend,
        trendLabel: trend === 'rising' ? '上昇中' : trend === 'falling' ? '低下中' : '安定',
        peakValue: values.length ? Math.max(...values) : 0,
      },
      timeline,
      related,
    });

  } catch (e) {
    return err(res, 500, e.message, { mock: true, data: mockTrends(keyword) });
  }
};

function mockTrends(keyword) {
  return {
    note: 'Mock — add SERPAPI_KEY to Vercel environment variables (free 100/month)',
    keyword,
    summary: { avgInterest: 62, recentTrend: 'rising', trendLabel: '上昇中', peakValue: 100 },
    timeline: Array.from({ length: 12 }, (_, i) => ({
      date: `2025-${String(i + 1).padStart(2, '0')}-01`,
      value: 40 + Math.floor(Math.random() * 45),
    })),
    related: { rising: [], top: [] },
  };
}
