# TrendBaseAI — Vercel Deployment

## Deploy in 3 minutes

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "initial commit"
gh repo create trendbase-ai --public --push
# or push manually to github.com
```

### Step 2 — Deploy to Vercel
```bash
npm i -g vercel
vercel
# Follow prompts — select current directory, no build command needed
```
Or: go to vercel.com → "Add New Project" → import your GitHub repo.

### Step 3 — Add environment variables in Vercel dashboard

Go to: Project → Settings → Environment Variables

| Variable | Value | Cost | Where to get it |
|---|---|---|---|
| `RAKUTEN_APP_ID` | your_id | ✅ FREE | https://webservice.rakuten.co.jp/ |
| `YOUTUBE_API_KEY` | your_key | ✅ FREE | https://console.cloud.google.com → YouTube Data API v3 |
| `SERPAPI_KEY` | your_key | ✅ FREE (100/mo) | https://serpapi.com |
| `TIKAPI_KEY` | your_key | 💰 $10/mo | https://tikapi.io |
| `APIFY_TOKEN` | your_token | 💰 ~$1/mo | https://apify.com |
| `TWITTER_BEARER_TOKEN` | your_token | 💰 $100/mo | https://developer.x.com |

**Start with just Rakuten + YouTube + SerpAPI — all free, backend fully works.**

---

## Project structure

```
/
├── index.html          ← Landing page (served by Vercel as static)
├── vercel.json         ← Vercel config (CORS headers, function runtime)
├── package.json        ← Only dependency: axios
└── api/
    ├── health.js       ← GET  /api/health
    ├── validate.js     ← POST /api/validate  ← main endpoint
    ├── rakuten.js      ← GET  /api/rakuten?keyword=副業
    ├── google-trends.js← GET  /api/google-trends?keyword=副業
    ├── youtube.js      ← GET  /api/youtube?keyword=副業
    ├── tiktok.js       ← GET  /api/tiktok
    ├── twitter.js      ← GET  /api/twitter?keyword=副業
    └── lib/
        └── helpers.js  ← shared CORS + response helpers
```

## How it works on Vercel

Each file in `/api/` becomes a serverless function automatically.
- `api/validate.js` → `https://your-app.vercel.app/api/validate`
- `api/rakuten.js`  → `https://your-app.vercel.app/api/rakuten`
- `index.html`      → `https://your-app.vercel.app/`

The landing page calls `/api/validate` (relative URL), which fires all
data sources in parallel and returns a unified score.

## Local development

```bash
npm install
vercel dev
# Opens http://localhost:3000 with hot reload
```

Or without Vercel CLI:
```bash
# You need vercel dev for the /api routes to work locally
# Alternative: use the trendbase-backend/ (Express) version for local dev
```
