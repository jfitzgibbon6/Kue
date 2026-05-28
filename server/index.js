const express = require('express');
const axios = require('axios');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, REDIRECT_URI, PORT = 3000 } = process.env;

// ── Client-credentials token cache (for search proxy) ────────────────────────

let ccToken = null, ccExpires = 0;

async function getClientToken() {
  if (ccToken && Date.now() < ccExpires - 60_000) return ccToken;
  const res = await axios.post('https://accounts.spotify.com/api/token',
    new URLSearchParams({ grant_type: 'client_credentials' }),
    { auth: { username: SPOTIFY_CLIENT_ID, password: SPOTIFY_CLIENT_SECRET } }
  );
  ccToken = res.data.access_token;
  ccExpires = Date.now() + res.data.expires_in * 1000;
  return ccToken;
}

// ── PKCE token exchange ───────────────────────────────────────────────────────

app.post('/api/spotify/token', async (req, res) => {
  const { code, verifier, redirect_uri } = req.body;
  try {
    const r = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code, redirect_uri,
        client_id: SPOTIFY_CLIENT_ID,
        code_verifier: verifier
      })
    );
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.response?.data || e.message });
  }
});

// ── Refresh token ─────────────────────────────────────────────────────────────

app.post('/api/spotify/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  try {
    const r = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token }),
      { auth: { username: SPOTIFY_CLIENT_ID, password: SPOTIFY_CLIENT_SECRET } }
    );
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.response?.data || e.message });
  }
});

// ── Search proxy ──────────────────────────────────────────────────────────────

app.get('/api/spotify/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query' });
  try {
    const token = await getClientToken();
    const r = await axios.get('https://api.spotify.com/v1/search', {
      params: { q, type: 'track', limit: 10 },
      headers: { Authorization: `Bearer ${token}` }
    });
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.response?.data || e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Kue server running on http://localhost:${PORT}`));
