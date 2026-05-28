const SPOTIFY_CLIENT_ID = 'c1b30a4a1bde4b1e9680e47fc93942ea';
const REDIRECT_URI = 'https://kue-production.up.railway.app/callback';
const SCOPES = 'streaming user-read-playback-state user-modify-playback-state';

// ── PKCE OAuth (DJ only) ──────────────────────────────────────────────────────

export async function startSpotifyAuth() {
  const verifier = randomStr(64);
  const challenge = await pkceChallenge(verifier);
  sessionStorage.setItem('pkce_verifier', verifier);

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge
  });
  const url = `https://accounts.spotify.com/authorize?${params}`;
  // Open in a new tab to avoid in-app browser restrictions
  window.open(url, '_blank');
}

export async function handleCallback() {
  const code = new URLSearchParams(location.search).get('code');
  if (!code) return null;

  const verifier = sessionStorage.getItem('pkce_verifier');
  const res = await fetch('https://kue-production.up.railway.app/api/spotify/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, verifier, redirect_uri: REDIRECT_URI })
  });
  const tokens = await res.json();
  saveTokens(tokens);
  history.replaceState({}, '', '/');
  return tokens.access_token;
}

// ── Token management ──────────────────────────────────────────────────────────

function saveTokens({ access_token, refresh_token, expires_in }) {
  localStorage.setItem('sp_token', access_token);
  localStorage.setItem('sp_refresh', refresh_token);
  localStorage.setItem('sp_expires', Date.now() + expires_in * 1000);
}

export async function getAccessToken() {
  const token = localStorage.getItem('sp_token');
  const expires = Number(localStorage.getItem('sp_expires'));
  if (token && Date.now() < expires - 60_000) return token;

  const refresh = localStorage.getItem('sp_refresh');
  if (!refresh) return null;

  const res = await fetch('https://kue-production.up.railway.app/api/spotify/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh })
  });
  const tokens = await res.json();
  saveTokens({ ...tokens, refresh_token: refresh });
  return tokens.access_token;
}

// ── Search (uses server-side client-credentials proxy) ────────────────────────

let searchCache = new Map();

export async function searchTracks(query) {
  const key = query.toLowerCase().trim();
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.ts < 300_000) return cached.results;

  const res = await fetch(`https://kue-production.up.railway.app/api/spotify/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('Search failed');
  const data = await res.json();

  const results = data.tracks.items.map(t => ({
    spotifyId: t.id,
    title: t.name,
    artist: t.artists.map(a => a.name).join(', '),
    albumArt: t.album.images[1]?.url || t.album.images[0]?.url,
    duration: Math.floor(t.duration_ms / 1000),
    previewUrl: t.preview_url,
    explicit: t.explicit
  }));

  searchCache.set(key, { results, ts: Date.now() });
  return results;
}

// ── Web Playback SDK ──────────────────────────────────────────────────────────

let player = null;

export function initPlayer(onReady, onStateChange) {
  window.onSpotifyWebPlaybackSDKReady = async () => {
    const token = await getAccessToken();
    if (!token) return;

    player = new Spotify.Player({
      name: 'Kue DJ',
      getOAuthToken: async cb => cb(await getAccessToken()),
      volume: 0.8
    });

    player.addListener('ready', ({ device_id }) => onReady(device_id));
    player.addListener('player_state_changed', onStateChange);
    player.connect();
  };

  const script = document.createElement('script');
  script.src = 'https://sdk.scdn.co/spotify-player.js';
  document.head.appendChild(script);
}

export async function playTrack(deviceId, spotifyId) {
  const token = await getAccessToken();
  await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [`spotify:track:${spotifyId}`] })
  });
}

// ── Preview playback (non-premium fallback) ───────────────────────────────────

let previewAudio = null;

export function playPreview(url) {
  stopPreview();
  previewAudio = new Audio(url);
  previewAudio.volume = 0.6;
  previewAudio.play();
  return previewAudio;
}

export function stopPreview() {
  if (previewAudio) { previewAudio.pause(); previewAudio = null; }
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function randomStr(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c]));
}

async function pkceChallenge(verifier) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c]));
}
