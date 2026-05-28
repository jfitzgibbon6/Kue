import { advanceQueue } from './queue-manager.js';
import { playTrack } from './spotify-api.js';

let advanceTimer = null;
let progressTimer = null;
let djDeviceId = null;
let isPaused = false;
let isAdmin = false;
let currentSession = null;
let currentDuration = 0;

export function setDJDevice(deviceId) { djDeviceId = deviceId; }
export function setPaused(val) { isPaused = val; }
export function setAdmin(val) {
  isAdmin = val;
  const bar = document.getElementById('kprbClickable');
  if (bar) {
    bar.style.cursor = isAdmin ? 'pointer' : 'default';
    if (isAdmin) {
      bar.onclick = onScrub;
    } else {
      bar.onclick = null;
    }
  }
}

function onScrub(e) {
  if (!isAdmin || !currentSession || !currentDuration) return;
  const bar = e.currentTarget;
  const rect = bar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const newStartedAt = Date.now() - pct * currentDuration * 1000;

  import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js').then(({ ref, update }) => {
    import('./firebase-config.js').then(({ db }) => {
      update(ref(db, `sessions/${currentSession}/nowPlaying`), { startedAt: newStartedAt });
    });
  });
}

export function startPlaybackMonitor(sessionId, nowPlaying) {
  clearTimers();
  currentSession = sessionId;

  if (!nowPlaying) { clearNowPlayingUI(); return; }

  currentDuration = nowPlaying.duration;
  updateNowPlayingUI(nowPlaying);

  const adminControls = document.getElementById('adminControls');
  if (adminControls) adminControls.style.display = isAdmin ? 'flex' : 'none';

  const bar = document.getElementById('kprbClickable');
  if (bar) {
    bar.style.cursor = isAdmin ? 'pointer' : 'default';
    bar.onclick = isAdmin ? onScrub : null;
  }

  const elapsed = Date.now() - nowPlaying.startedAt;
  const remaining = nowPlaying.duration * 1000 - elapsed;

  if (remaining <= 0) { advanceQueue(sessionId); return; }

  advanceTimer = setTimeout(() => { if (!isPaused) advanceQueue(sessionId); }, remaining);
  progressTimer = setInterval(() => {
    if (!isPaused) updateProgress(Date.now() - nowPlaying.startedAt, nowPlaying.duration);
  }, 1000);
  updateProgress(elapsed, nowPlaying.duration);

  if (djDeviceId && nowPlaying.spotifyId) {
    playTrack(djDeviceId, nowPlaying.spotifyId).catch(() => {});
  }
}

function updateProgress(elapsedMs, durationSecs) {
  const elapsed = Math.min(elapsedMs / 1000, durationSecs);
  const pct = (elapsed / durationSecs * 100).toFixed(1);

  const bar = document.getElementById('kpf');
  if (bar) bar.style.width = pct + '%';

  const timeEl = document.getElementById('kpt');
  if (timeEl) {
    const m = Math.floor(elapsed / 60), s = Math.floor(elapsed % 60);
    timeEl.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  renderWaveform(elapsed / durationSecs);
}

function updateNowPlayingUI(np) {
  const titleEl = document.querySelector('.knptit');
  const artistEl = document.querySelector('.knpar');
  const artEl = document.querySelector('.kart');
  const durEl = document.getElementById('kpdur');

  if (titleEl) titleEl.textContent = np.title;
  if (artistEl) artistEl.innerHTML =
    `<i class="ti ti-player-play-filled" style="font-size:11px;color:#E2289F;" aria-hidden="true"></i>${np.artist}`;
  if (durEl) {
    const m = Math.floor(np.duration / 60), s = np.duration % 60;
    durEl.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
  }
  if (artEl) {
    artEl.innerHTML = np.albumArt
      ? `<img src="${np.albumArt}" width="82" height="82" style="border-radius:9px;object-fit:cover;" alt="${np.title}">`
      : artEl.innerHTML;
  }
}

function clearNowPlayingUI() {
  const titleEl = document.querySelector('.knptit');
  if (titleEl) titleEl.textContent = 'Nothing playing';
  const adminControls = document.getElementById('adminControls');
  if (adminControls) adminControls.style.display = 'none';
  currentDuration = 0;
}

const WF = [4,7,14,20,24,18,22,26,16,9,19,23,21,11,7,15,21,27,23,17,13,19,25,21,15,9,17,23,19,13,21,25,19,11,15,21,17,13,9,17,23,19,11,7,4];

export function renderWaveform(progress = 0) {
  const el = document.getElementById('kwf');
  if (!el) return;
  el.innerHTML = WF.map((h, i) => {
    const played = i / WF.length < progress;
    const delay = (i * 0.035 % 0.9).toFixed(2);
    return `<div style="width:3px;height:${h}px;border-radius:2px;flex-shrink:0;` +
      `background:${played ? '#E2289F' : '#222'};` +
      `${played ? `animation:kwfp 1.1s ease-in-out ${delay}s infinite` : ''}"></div>`;
  }).join('');
}

function clearTimers() {
  clearTimeout(advanceTimer);
  clearInterval(progressTimer);
}
