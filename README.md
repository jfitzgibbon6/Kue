# Kue — Collaborative Music Queue

Real-time music queue voting app. Guests vote on what plays next; the DJ controls playback via Spotify.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vanilla JS (ES modules), inline CSS |
| Real-time sync | Firebase Realtime Database |
| Auth | Firebase Anonymous Auth |
| Music search | Spotify Web API (client credentials) |
| DJ playback | Spotify Web Playback SDK (PKCE OAuth) |
| Server | Express.js (OAuth proxy + search proxy) |
| Hosting | Firebase Hosting |

---

## Local Development

### 1. Clone & install

```bash
git clone https://github.com/your-org/kue.git
cd kue
npm install
```

### 2. Firebase setup

1. Create a project at https://console.firebase.google.com
2. Enable **Realtime Database** (start in test mode)
3. Enable **Anonymous Authentication**
4. Copy your web app config into `public/firebase-config.js`

Deploy security rules:
```bash
npm install -g firebase-tools
firebase login
firebase deploy --only database
```

### 3. Spotify setup

1. Register an app at https://developer.spotify.com/dashboard
2. Add redirect URI: `http://localhost:3000/callback`
3. Copy credentials into `server/.env`:

```bash
cp server/.env.example server/.env
# then fill in SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
```

### 4. Run

```bash
# Terminal 1 — Express server (OAuth + search proxy)
npm run dev

# Terminal 2 — Serve frontend (any static server)
npx serve public -p 8080
```

Open http://localhost:8080

---

## Project Structure

```
kue/
├── public/
│   ├── index.html            # Full UI (landing + app + modals)
│   ├── app.js                # Boot, rendering, event handlers
│   ├── firebase-config.js    # Firebase init + anonymous auth
│   ├── queue-manager.js      # All Firebase reads/writes
│   ├── spotify-api.js        # Spotify OAuth, search, playback
│   ├── playback-controller.js# Now Playing UI + auto-advance
│   ├── service-worker.js     # PWA offline cache
│   └── manifest.json         # PWA manifest
├── server/
│   ├── index.js              # Express: token exchange + search proxy
│   └── .env.example
├── database.rules.json       # Firebase security rules
├── firebase.json             # Firebase Hosting config
└── package.json
```

---

## Deployment

```bash
# Build nothing — it's all static
firebase deploy
```

Set environment variables for the server (Firebase Functions or your own host):
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `REDIRECT_URI` → `https://your-domain/callback`

---

## How It Works

1. **DJ** enters their name + venue name → session code generated (e.g. `XJ4K9P`)
2. **Guests** enter the code → join the session anonymously
3. Anyone can search Spotify and add songs to the queue
4. Votes are written per-user to Firebase; `voteCount` is updated atomically via transactions
5. Queue re-sorts in real-time across all clients via `onValue` listener
6. When a song ends, the highest-voted song auto-advances to Now Playing
7. DJ can skip, clear queue, or connect Spotify for in-browser playback
