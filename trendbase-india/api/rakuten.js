// GET /api/rakuten?keyword=副業&mode=search|ranking
// Official Rakuten Web Service — completely free
// Register: https://webservice.rakuten.co.jp/
const axios = require('axios');
const { handleOptions, ok, err } = require('./lib/helpers');

const BASE = 'https://app.rakuten.co.jp/services/api';
const APP_ID = process.env.RAKUTEN_APP_ID;

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const keyword = req.query.keyword || '副業';
  const mode = req.query.mode || 'search';

  if (!APP_ID) {
    return ok(res, {
      mock: true,
      setup: 'Register free at https://webservice.rakuten.co.jp/ → add RAKUTEN_APP_ID to Vercel env vars',
      data: mockSearch(keyword),
    });
  }

  try {
    if (mode === 'ranking') {
      const r = await axios.get(`${BASE}/IchibaItem/Ranking/20170628`, {
        params: { applicationId: APP_ID, format: 'json', hits: 10, keyword },
        timeout: 8000,
      });
      const items = r.data.Items.map(i => ({
        rank: i.Item.rank,
        name: i.Item.itemName,
        price: i.Item.itemPrice,
        shop: i.Item.shopName,
        reviewCount: i.Item.reviewCount,
        reviewAverage: i.Item.reviewAverage,
      }));
      return ok(res, { source: 'rakuten_ranking', keyword, items });
    }

    // Default: search — returns demand signal
    const r = await axios.get(`${BASE}/IchibaItem/Search/20170706`, {
      params: {
        applicationId: APP_ID,
        format: 'json',
        keyword,
        hits: 10,
        sort: '-reviewCount',
      },
      timeout: 8000,
    });

    const items = r.data.Items.map(i => ({
      name: i.Item.itemName,
      price: i.Item.itemPrice,
      reviewCount: i.Item.reviewCount,
      reviewAverage: i.Item.reviewAverage,
    }));

    const totalReviews = items.reduce((s, i) => s + (i.reviewCount || 0), 0);
    const avgPrice = items.length
      ? Math.round(items.reduce((s, i) => s + i.price, 0) / items.length)
      : 0;
    const itemCount = r.data.count || 0;

    return ok(res, {
      source: 'rakuten_search',
      keyword,
      demandSignal: {
        totalReviews,
        avgPrice,
        itemCount,
        level: demandLevel(totalReviews, itemCount),
      },
      items,
    });

  } catch (e) {
    return err(res, 500, e.message, { mock: true, data: mockSearch(keyword) });
  }
};

function demandLevel(reviews, count) {
  if (reviews > 50000 || count > 10000) return '非常に高い';
  if (reviews > 10000 || count > 3000)  return '高い';
  if (reviews > 1000  || count > 500)   return '中程度';
  return '低い';
}

function mockSearch(keyword) {
  return {
    note: 'Mock — add RAKUTEN_APP_ID to Vercel environment variables',
    keyword,
    demandSignal: { totalReviews: 14200, avgPrice: 3200, itemCount: 4100, level: '高い' },
  };
}
