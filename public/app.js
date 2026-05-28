import { initAuth } from './firebase-config.js';
import {
  createSession, joinSession, keepAlive, isDJ,
  subscribeQueue, subscribeNowPlaying, subscribeHistory, subscribePeopleCount,
  vote, addSong, removeSong, advanceQueue, playPrevious
} from './queue-manager.js';
import { searchTracks, playPreview, stopPreview, startSpotifyAuth, handleCallback, initPlayer, getAccessToken } from './spotify-api.js';
import { startPlaybackMonitor, renderWaveform, setDJDevice, setPaused, setAdmin } from './playback-controller.js';

let currentUser = null;
let sessionId = null;
let userIsDJ = false;
let previewPlaying = null;
let searchTimer = null;
let paused = false;

// ── Boot ──────────────────────────────────────────────────────────────────────

(async () => {
  if (location.search.includes('code=')) await handleCallback();

  // Auto-fill session code from QR scan
  const joinCode = new URLSearchParams(location.search).get('join');
  if (joinCode) document.getElementById('ldCode2').value = joinCode;

  currentUser = await initAuth();
  sessionId = localStorage.getItem('kue_session');
  const savedName = localStorage.getItem('kue_name');

  if (sessionId && savedName) {
    try {
      await joinSession(sessionId, currentUser.uid, savedName);
      await boot(savedName);
    } catch {
      localStorage.removeItem('kue_session');
      showLanding();
    }
  } else {
    showLanding();
  }

  // Attach listeners
  document.getElementById('btnCreateSession').addEventListener('click', createNewSession);
  document.getElementById('btnJoinSession').addEventListener('click', joinExistingSession);
  document.getElementById('btnAddSong').addEventListener('click', openAddSong);
  document.getElementById('btnLeave').addEventListener('click', leaveSession);
  document.getElementById('btnDJControls').addEventListener('click', openDJControls);
  document.getElementById('btnCloseAdd').addEventListener('click', closeAddSong);
  document.getElementById('btnCloseDJ').addEventListener('click', closeDJControls);
  document.getElementById('btnDJSkip').addEventListener('click', djSkip);
  document.getElementById('btnLeaveSession').addEventListener('click', leaveSession);
  document.getElementById('btnDJPause').addEventListener('click', djPause);
  document.getElementById('btnPrev').addEventListener('click', () => playPrevious(sessionId));
  document.getElementById('btnPause').addEventListener('click', djPause);
  document.getElementById('btnNext').addEventListener('click', djSkip);
  document.getElementById('btnDJSpotify').addEventListener('click', () => startSpotifyAuth());
  document.getElementById('btnDJClear').addEventListener('click', djClearQueue);
  document.getElementById('kSearchInput').addEventListener('input', onSearchInput);
  document.getElementById('tabQueue').addEventListener('click', function () { kTab(this, 'q'); });
  document.getElementById('tabHistory').addEventListener('click', function () { kTab(this, 'h'); });
})();

async function boot(displayName) {
  userIsDJ = await isDJ(sessionId, currentUser.uid);
  setAdmin(userIsDJ);
  document.getElementById('btnDJControls').style.display = userIsDJ ? 'flex' : 'none';
  document.getElementById('klanding').style.display = 'none';
  document.getElementById('kapp').style.cssText = 'display:flex;flex-direction:column;height:100%;';

  const venueName = localStorage.getItem('kue_venue') || sessionId;
  document.getElementById('kvenueName').textContent = venueName;

  keepAlive(sessionId, currentUser.uid);
  subscribeNowPlaying(sessionId, np => startPlaybackMonitor(sessionId, np));
  subscribeQueue(sessionId, currentUser.uid, renderQueue);
  subscribeHistory(sessionId, renderHistory);
  subscribePeopleCount(sessionId, n => { document.getElementById('kpeople').textContent = n; });

  if (userIsDJ && await getAccessToken()) {
    initPlayer(deviceId => setDJDevice(deviceId), () => {});
  }

  renderWaveform(0);
}

function showLanding() {
  document.getElementById('kapp').style.display = 'none';
  document.getElementById('klanding').style.display = 'flex';
}

// ── Landing ───────────────────────────────────────────────────────────────────

async function createNewSession() {
  const name = document.getElementById('ldName').value.trim();
  if (!name) return shake('ldName');

  localStorage.setItem('kue_name', name);
  localStorage.setItem('kue_venue', `${name}'s Session`);
  sessionId = await createSession(currentUser.uid, name, name, `${name}'s Session`);
  localStorage.setItem('kue_session', sessionId);

  document.getElementById('ldCode').textContent = sessionId;
  document.getElementById('ldShareBox').style.display = 'flex';

  const joinUrl = `https://kuem-15821.web.app?join=${sessionId}`;
  const canvas = document.getElementById('ldQR');
  QRCode.toCanvas(canvas, joinUrl, { width: 120, color: { dark: '#E2289F', light: '#111' } });

  await boot(name);
}

async function joinExistingSession() {
  const name = document.getElementById('ldName').value.trim();
  const code = document.getElementById('ldCode2').value.trim().toUpperCase();
  if (!name) return shake('ldName');
  if (!code) return shake('ldCode2');

  localStorage.setItem('kue_name', name);
  try {
    const meta = await joinSession(code, currentUser.uid, name);
    sessionId = code;
    localStorage.setItem('kue_session', sessionId);
    localStorage.setItem('kue_venue', meta.venueName || code);
    await boot(name);
  } catch {
    shake('ldCode2');
    document.getElementById('ldErr').textContent = 'Session not found.';
  }
}

// ── Queue rendering ───────────────────────────────────────────────────────────

function tr(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

function renderQueue(songs) {
  const el = document.getElementById('kqv');
  if (!songs.length) {
    el.innerHTML = '<div style="text-align:center;color:#333;font-size:12px;padding:32px 0;">Queue is empty — add a song!</div>';
    return;
  }

  el.innerHTML = songs.map((s, i) => {
    const pos = i + 1, top = pos === 1;
    const av = s.addedBy?.avatarInitials || s.addedBy?.displayName?.replace('@', '').slice(0, 2).toUpperCase() || '??';
    const art = s.albumArt
      ? `<img src="${s.albumArt}" width="46" height="46" style="border-radius:7px;object-fit:cover;" alt="${s.title}">`
      : `<div style="font-size:18px;">🎵</div>`;

    return `<div class="kqi${top ? ' k1' : ''}" data-id="${s.id}">
      ${top
        ? `<div class="kqnb"><span class="kqn tp">${pos}</span><div class="kqnbs">
            ${[7, 12, 9].map((h, bi) => `<div class="kqnbr" style="height:${h}px;animation-delay:${bi * 0.2}s;transform-origin:bottom;"></div>`).join('')}
           </div></div>`
        : `<span class="kqn">${pos}</span>`}
      <div class="kqar" style="width:46px;height:46px;flex-shrink:0;">${art}</div>
      <div class="kqin">
        <div class="kqtl">${tr(s.title, 20)}${s.explicit ? '<span class="kexpl">E</span>' : ''}</div>
        <div class="kqar2">${tr(s.artist, 26)}</div>
        <div class="kqby"><div class="kav">${av}</div>Added by ${s.addedBy?.displayName || 'someone'}</div>
      </div>
      <div class="kvc2">
        <button class="kuv${s.userVote === 1 ? ' v' : ''}" data-vote-id="${s.id}" data-dir="1" aria-label="Upvote">
          <i class="ti ti-chevron-up" style="font-size:15px;color:#fff;" aria-hidden="true"></i>
        </button>
        <span class="kvn">${s.voteCount}</span>
        <button class="kdv${s.userVote === -1 ? ' v' : ''}" data-vote-id="${s.id}" data-dir="-1" aria-label="Downvote">
          <i class="ti ti-chevron-down" style="font-size:15px;color:#8A8A8A;" aria-hidden="true"></i>
        </button>
        ${userIsDJ ? `<button class="kmo" data-remove-id="${s.id}" aria-label="Remove"><i class="ti ti-trash" aria-hidden="true"></i></button>` : ''}
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-vote-id]').forEach(btn => {
    btn.addEventListener('click', () => vote(sessionId, btn.dataset.voteId, currentUser.uid, Number(btn.dataset.dir)));
  });
  el.querySelectorAll('[data-remove-id]').forEach(btn => {
    btn.addEventListener('click', () => removeSong(sessionId, btn.dataset.removeId));
  });
}

// ── History rendering ─────────────────────────────────────────────────────────

function renderHistory(songs) {
  const el = document.getElementById('khv');
  if (!songs.length) {
    el.innerHTML = `<i class="ti ti-history" style="font-size:52px;color:#1a1a1a;" aria-hidden="true"></i>
      <span style="color:#333;font-size:13px;">Songs played tonight will appear here.</span>`;
    return;
  }
  el.innerHTML = songs.map(s => {
    const art = s.albumArt
      ? `<img src="${s.albumArt}" width="46" height="46" style="border-radius:7px;object-fit:cover;" alt="${s.title}">`
      : `<div style="width:46px;height:46px;border-radius:7px;background:#1a1a1a;display:flex;align-items:center;justify-content:center;font-size:18px;">🎵</div>`;
    return `<div class="kqi" style="opacity:.6;">
      ${art}
      <div class="kqin">
        <div class="kqtl">${tr(s.title, 22)}</div>
        <div class="kqar2">${tr(s.artist, 28)}</div>
        <div class="kqby">Final votes: <strong style="color:#E2289F;">${s.voteCount ?? s.finalVoteCount ?? '—'}</strong></div>
      </div>
    </div>`;
  }).join('');
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function kTab(btn, v) {
  document.querySelectorAll('.ktab').forEach(t => t.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('kqv').style.display = v === 'q' ? 'block' : 'none';
  document.getElementById('khv').style.display = v === 'h' ? 'flex' : 'none';
}

// ── Add Song modal ────────────────────────────────────────────────────────────

function openAddSong() {
  document.getElementById('kAddModal').style.display = 'flex';
  document.getElementById('kSearchInput').focus();
}

function closeAddSong() {
  document.getElementById('kAddModal').style.display = 'none';
  document.getElementById('kSearchInput').value = '';
  document.getElementById('kSearchResults').innerHTML = '';
  stopPreview();
  previewPlaying = null;
}

function onSearchInput() {
  clearTimeout(searchTimer);
  const q = document.getElementById('kSearchInput').value.trim();
  if (q.length < 2) { document.getElementById('kSearchResults').innerHTML = ''; return; }
  searchTimer = setTimeout(() => runSearch(q), 300);
}

async function runSearch(q) {
  const el = document.getElementById('kSearchResults');
  el.innerHTML = '<div style="text-align:center;color:#555;padding:20px;font-size:12px;">Searching…</div>';
  try {
    const results = await searchTracks(q);
    if (!results.length) { el.innerHTML = '<div style="text-align:center;color:#555;padding:20px;font-size:12px;">No results</div>'; return; }

    el.innerHTML = results.map((t, i) => {
      const dur = `${Math.floor(t.duration / 60)}:${String(t.duration % 60).padStart(2, '0')}`;
      return `<div class="ksri">
        ${t.albumArt ? `<img src="${t.albumArt}" width="46" height="46" style="border-radius:7px;object-fit:cover;" alt="${t.title}">` : '<div style="width:46px;height:46px;border-radius:7px;background:#1a1a1a;"></div>'}
        <div class="kqin">
          <div class="kqtl">${tr(t.title, 22)}${t.explicit ? '<span class="kexpl">E</span>' : ''}</div>
          <div class="kqar2">${tr(t.artist, 28)}</div>
          <div class="kqby">${dur}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          ${t.previewUrl ? `<button class="kdv" data-preview="${i}" aria-label="Preview"><i class="ti ti-player-play" style="font-size:12px;color:#E2289F;"></i></button>` : ''}
          <button class="kadb" style="height:32px;font-size:11px;padding:0 10px;" data-add="${i}">Add</button>
        </div>
      </div>`;
    }).join('');

    window._searchResults = results;

    el.querySelectorAll('[data-preview]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.preview);
        const t = window._searchResults[i];
        if (previewPlaying === i) { stopPreview(); previewPlaying = null; }
        else { playPreview(t.previewUrl); previewPlaying = i; }
      });
    });
    el.querySelectorAll('[data-add]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const t = window._searchResults[Number(btn.dataset.add)];
        if (!t) return;
        stopPreview();
        await addSong(sessionId, t, currentUser.uid, localStorage.getItem('kue_name') || 'anonymous');
        closeAddSong();
        showToast('Song added to queue!');
      });
    });
  } catch {
    el.innerHTML = '<div style="text-align:center;color:#555;padding:20px;font-size:12px;">Search failed. Try again.</div>';
  }
}

// ── DJ Controls ───────────────────────────────────────────────────────────────

function openDJControls() {
  if (!userIsDJ) return;
  document.getElementById('modalSessionCode').textContent = sessionId;
  const joinUrl = `https://kuem-15821.web.app?join=${sessionId}`;
  QRCode.toCanvas(document.getElementById('modalQR'), joinUrl, { width: 120, color: { dark: '#E2289F', light: '#111' } });
  document.getElementById('kDJModal').style.display = 'flex';
}

function closeDJControls() {
  document.getElementById('kDJModal').style.display = 'none';
}

function leaveSession() {
  localStorage.removeItem('kue_session');
  localStorage.removeItem('kue_name');
  localStorage.removeItem('kue_venue');
  location.reload();
}

async function djSkip() {
  await advanceQueue(sessionId);
  closeDJControls();
  showToast('Skipped to next song');
}

function djPause() {
  paused = !paused;
  const btn = document.getElementById('btnDJPause');
  const pauseBtn = document.getElementById('btnPause');
  if (paused) {
    btn.textContent = 'Resume';
    btn.style.background = '#1a6b3a';
    if (pauseBtn) { pauseBtn.style.display = 'flex'; pauseBtn.innerHTML = '<i class="ti ti-player-play" aria-hidden="true"></i>'; }
    showToast('Queue paused');
  } else {
    btn.textContent = 'Pause';
    btn.style.background = '';
    if (pauseBtn) { pauseBtn.innerHTML = '<i class="ti ti-player-pause" aria-hidden="true"></i>'; }
    showToast('Queue resumed');
  }
  setPaused(paused);
  closeDJControls();
}

async function djClearQueue() {
  if (!confirm('Clear the entire queue?')) return;
  const { get, ref, remove } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
  const { db } = await import('./firebase-config.js');
  const snap = await get(ref(db, `sessions/${sessionId}/queue`));
  if (!snap.exists()) return;
  await Promise.all(Object.keys(snap.val()).map(id => remove(ref(db, `sessions/${sessionId}/queue/${id}`))));
  closeDJControls();
  showToast('Queue cleared');
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg) {
  let t = document.getElementById('ktoast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'ktoast';
    t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#E2289F;color:#fff;font-size:12px;font-weight:700;padding:8px 18px;border-radius:20px;z-index:9999;transition:opacity .3s;pointer-events:none;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.style.opacity = '0', 2000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function shake(id) {
  const el = document.getElementById(id);
  el.style.animation = 'kshake .3s ease';
  el.addEventListener('animationend', () => el.style.animation = '', { once: true });
}
