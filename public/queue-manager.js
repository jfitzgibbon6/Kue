import { db } from './firebase-config.js';
import {
  ref, push, set, get, remove, update,
  onValue, runTransaction, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ── Listeners ────────────────────────────────────────────────────────────────

export function subscribeQueue(sessionId, userId, cb) {
  return onValue(ref(db, `sessions/${sessionId}/queue`), snap => {
    const raw = snap.val() || {};
    const arr = Object.entries(raw).map(([id, s]) => ({
      id, ...s,
      userVote: s.votes?.[userId] || 0
    })).sort((a, b) => b.voteCount - a.voteCount);
    cb(arr);
  });
}

export function subscribeNowPlaying(sessionId, cb) {
  return onValue(ref(db, `sessions/${sessionId}/nowPlaying`), snap => cb(snap.val()));
}

export function subscribeHistory(sessionId, cb) {
  return onValue(ref(db, `sessions/${sessionId}/history`), snap => {
    const raw = snap.val() || {};
    const arr = Object.entries(raw)
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => b.playedAt - a.playedAt);
    cb(arr);
  });
}

export function subscribePeopleCount(sessionId, cb) {
  return onValue(ref(db, `sessions/${sessionId}/users`), snap => {
    cb(snap.exists() ? Object.keys(snap.val()).length : 0);
  });
}

// ── Voting ────────────────────────────────────────────────────────────────────

export async function vote(sessionId, songId, userId, direction) {
  const voteRef = ref(db, `sessions/${sessionId}/queue/${songId}/votes/${userId}`);
  const countRef = ref(db, `sessions/${sessionId}/queue/${songId}/voteCount`);

  let delta = 0;
  await runTransaction(voteRef, current => {
    const prev = current || 0;
    const next = prev === direction ? 0 : direction;
    delta = next - prev;
    return next;
  });

  if (delta !== 0) {
    await runTransaction(countRef, c => (c || 0) + delta);
  }
}

// ── Queue mutations ───────────────────────────────────────────────────────────

export async function addSong(sessionId, track, userId, displayName) {
  const newRef = push(ref(db, `sessions/${sessionId}/queue`));
  const data = {
    ...track,
    previewUrl: track.previewUrl || null,
    addedAt: serverTimestamp(),
    addedBy: { userId, displayName, avatarInitials: initials(displayName) },
    votes: { [userId]: 1 },
    voteCount: 1
  };
  Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
  await set(newRef, data);

  // Auto-start if nothing is playing
  const npSnap = await get(ref(db, `sessions/${sessionId}/nowPlaying`));
  if (!npSnap.exists()) await advanceQueue(sessionId);
}

export async function removeSong(sessionId, songId) {
  await remove(ref(db, `sessions/${sessionId}/queue/${songId}`));
}

export async function playPrevious(sessionId) {
  const [histSnap, npSnap] = await Promise.all([
    get(ref(db, `sessions/${sessionId}/history`)),
    get(ref(db, `sessions/${sessionId}/nowPlaying`))
  ]);

  const history = histSnap.val() || {};
  const sorted = Object.entries(history).sort(([, a], [, b]) => b.playedAt - a.playedAt);
  if (!sorted.length) return;

  const [prevId, prevSong] = sorted[0];

  // Put current nowPlaying back at top of queue
  const current = npSnap.val();
  if (current?.songId) {
    const requeue = { ...current };
    delete requeue.songId;
    delete requeue.startedAt;
    requeue.voteCount = 999; // ensure it stays at top
    await set(ref(db, `sessions/${sessionId}/queue/${current.songId}`), requeue);
  }

  // Remove from history
  await remove(ref(db, `sessions/${sessionId}/history/${prevId}`));

  // Set as now playing
  await update(ref(db, `sessions/${sessionId}`), {
    nowPlaying: { ...prevSong, songId: prevId, startedAt: serverTimestamp() }
  });
}

export async function advanceQueue(sessionId) {
  const [qSnap, npSnap] = await Promise.all([
    get(ref(db, `sessions/${sessionId}/queue`)),
    get(ref(db, `sessions/${sessionId}/nowPlaying`))
  ]);

  const queue = qSnap.val() || {};
  const sorted = Object.entries(queue).sort(([, a], [, b]) => b.voteCount - a.voteCount);

  // Archive current now-playing to history
  const current = npSnap.val();
  if (current?.songId) {
    await set(ref(db, `sessions/${sessionId}/history/${current.songId}`), {
      ...current, playedAt: serverTimestamp()
    });
  }

  if (!sorted.length) {
    await remove(ref(db, `sessions/${sessionId}/nowPlaying`));
    return;
  }

  const [nextId, nextSong] = sorted[0];
  await Promise.all([
    update(ref(db, `sessions/${sessionId}`), {
      nowPlaying: { ...nextSong, songId: nextId, startedAt: serverTimestamp() }
    }),
    remove(ref(db, `sessions/${sessionId}/queue/${nextId}`))
  ]);
}

// ── Session management ────────────────────────────────────────────────────────

export async function createSession(userId, displayName, djName, venueName) {
  const code = randomCode();
  await set(ref(db, `sessions/${code}`), {
    metadata: {
      createdAt: serverTimestamp(),
      createdBy: userId,
      djName, venueName,
      isActive: true
    }
  });
  await joinSession(code, userId, displayName);
  return code;
}

export async function joinSession(sessionId, userId, displayName) {
  const snap = await get(ref(db, `sessions/${sessionId}/metadata`));
  if (!snap.exists()) throw new Error('Session not found');
  await set(ref(db, `sessions/${sessionId}/users/${userId}`), {
    displayName,
    joinedAt: serverTimestamp(),
    lastActive: serverTimestamp()
  });
  return snap.val();
}

export function keepAlive(sessionId, userId) {
  const r = ref(db, `sessions/${sessionId}/users/${userId}/lastActive`);
  return setInterval(() => set(r, serverTimestamp()), 30_000);
}

export async function isDJ(sessionId, userId) {
  const snap = await get(ref(db, `sessions/${sessionId}/metadata/createdBy`));
  return snap.val() === userId;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name) {
  return name.replace('@', '').slice(0, 2).toUpperCase();
}

function randomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
