// Shared helpers for all Vercel serverless functions

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    cors(res);
    res.status(204).end();
    return true;
  }
  return false;
}

function ok(res, data) {
  cors(res);
  res.status(200).json(data);
}

function err(res, status, message, extra = {}) {
  cors(res);
  res.status(status).json({ error: message, ...extra });
}

module.exports = { cors, handleOptions, ok, err };
