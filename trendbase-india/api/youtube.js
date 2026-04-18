// GET /api/youtube?keyword=副業&mode=trending|search
// YouTube Data API v3 — free (10,000 units/day)
// Setup: https://console.cloud.google.com → Enable YouTube Data API v3 → create API key
const axios = require('axios');
const { handleOptions, ok, err } = require('./lib/helpers');

const YT_KEY = process.env.YOUTUBE_API_KEY;
const YT_BASE = 'https://www.googleapis.com/youtube/v3';

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const keyword = req.query.keyword || '';
  const mode = req.query.mode || (keyword ? 'search' : 'trending');

  if (!YT_KEY) {
    return ok(res, {
      mock: true,
      setup: 'Enable YouTube Data API v3 free at https://console.cloud.google.com → add YOUTUBE_API_KEY to Vercel env vars',
      data: mode === 'trending' ? mockTrending() : mockSearch(keyword),
    });
  }

  try {
    if (mode === 'trending') {
      const r = await axios.get(`${YT_BASE}/videos`, {
        params: {
          part: 'snippet,statistics',
          chart: 'mostPopular',
          regionCode: 'JP',
          hl: 'ja',
          maxResults: 20,
          key: YT_KEY,
        },
        timeout: 8000,
      });

      const videos = r.data.items.map(v => ({
        title: v.snippet.title,
        channel: v.snippet.channelTitle,
        viewCount: parseInt(v.statistics.viewCount || 0),
        tags: v.snippet.tags?.slice(0, 5) || [],
      }));

      // Extract keyword frequency from titles as trend signal
      const words = videos.flatMap(v =>
        v.title.split(/[\s　・【】「」（）()]+/).filter(w => w.length > 1)
      );
      const freq = {};
      words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
      const topKeywords = Object.entries(freq)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8)
        .map(([word, count]) => ({ word, count }));

      return ok(res, {
        source: 'youtube_data_api_v3',
        region: 'JP',
        trendKeywords: topKeywords,
        videoCount: videos.length,
      });
    }

    // Search mode — demand signal for a specific keyword
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const r = await axios.get(`${YT_BASE}/search`, {
      params: {
        part: 'snippet',
        q: keyword,
        type: 'video',
        regionCode: 'JP',
        relevanceLanguage: 'ja',
        order: 'viewCount',
        maxResults: 10,
        publishedAfter: sixMonthsAgo.toISOString(),
        key: YT_KEY,
      },
      timeout: 8000,
    });

    return ok(res, {
      source: 'youtube_data_api_v3',
      keyword,
      totalResults: r.data.pageInfo?.totalResults || 0,
      results: r.data.items.map(v => ({
        title: v.snippet.title,
        channel: v.snippet.channelTitle,
        publishedAt: v.snippet.publishedAt,
      })),
    });

  } catch (e) {
    return err(res, 500, e.message, {
      mock: true,
      data: mode === 'trending' ? mockTrending() : mockSearch(keyword),
    });
  }
};

function mockTrending() {
  return {
    note: 'Mock — add YOUTUBE_API_KEY (free) to Vercel env vars',
    trendKeywords: [
      { word: '副業', count: 9 }, { word: 'AI', count: 7 },
      { word: '在宅', count: 5 }, { word: '稼ぐ', count: 4 },
    ],
  };
}

function mockSearch(keyword) {
  return { note: 'Mock', keyword, totalResults: 11800 };
}
