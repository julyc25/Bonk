import { Router } from 'express';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const users = new Map();
const graph = new Map();
const pendingIncoming = new Map();

function makeDisplayName(email) {
  const [prefix = 'user'] = String(email).split('@');
  return prefix.slice(0, 1).toUpperCase() + prefix.slice(1);
}

export function normalizeUserId(value) {
  return String(value ?? '').trim().toLowerCase();
}

function ensureUserCollections(userId) {
  if (!graph.has(userId)) graph.set(userId, new Set());
  if (!pendingIncoming.has(userId)) pendingIncoming.set(userId, new Set());
}

function ensureUserByEmail(email) {
  const userId = normalizeUserId(email);
  if (!EMAIL_RE.test(userId)) return null;

  if (!users.has(userId)) {
    users.set(userId, {
      id: userId,
      email: userId,
      name: makeDisplayName(userId),
      status: '',
      picture: null,
    });
  }
  ensureUserCollections(userId);
  return userId;
}

export function upsertUser(profile) {
  const userId = ensureUserByEmail(profile?.email ?? profile?.id);
  if (!userId) return null;

  const existing = users.get(userId);
  const updated = {
    ...existing,
    name: String(profile?.name || existing?.name || makeDisplayName(userId)),
    picture: profile?.picture ?? existing?.picture ?? null,
  };
  users.set(userId, updated);
  return { ...updated };
}

export function hasUser(userId) {
  return users.has(normalizeUserId(userId));
}

export function getUser(userId) {
  const id = normalizeUserId(userId);
  const user = users.get(id);
  return user ? { ...user } : null;
}

export function getFriends(userId) {
  const id = normalizeUserId(userId);
  return [...(graph.get(id) ?? new Set())];
}

export function areFriends(leftUserId, rightUserId) {
  const left = normalizeUserId(leftUserId);
  const right = normalizeUserId(rightUserId);
  return (
    (graph.get(left) ?? new Set()).has(right) &&
    (graph.get(right) ?? new Set()).has(left)
  );
}

function linkFriends(leftUserId, rightUserId) {
  const left = normalizeUserId(leftUserId);
  const right = normalizeUserId(rightUserId);
  ensureUserCollections(left);
  ensureUserCollections(right);
  graph.get(left).add(right);
  graph.get(right).add(left);
}

function getFriendProfiles(userId) {
  return getFriends(userId)
    .map((id) => getUser(id))
    .filter(Boolean);
}

function getIncomingFriendRequests(userId) {
  const id = normalizeUserId(userId);
  ensureUserCollections(id);
  return [...pendingIncoming.get(id)]
    .map((requestId) => getUser(requestId))
    .filter(Boolean);
}

function addFriendRequest(fromUserId, toUserId) {
  const fromId = normalizeUserId(fromUserId);
  const toId = ensureUserByEmail(toUserId);

  if (!hasUser(fromId)) return { ok: false, message: 'Your account is not registered.' };
  if (!toId) return { ok: false, message: 'Please enter a valid friend email.' };
  if (fromId === toId) return { ok: false, message: 'You cannot add yourself.' };
  if (areFriends(fromId, toId)) return { ok: false, message: 'You are already friends.' };

  ensureUserCollections(toId);
  const incoming = pendingIncoming.get(toId);
  if (incoming.has(fromId)) return { ok: false, message: 'A friend request is already pending.' };

  incoming.add(fromId);
  return { ok: true };
}

function acceptFriendRequest(userId, fromUserId) {
  const userIdNorm = normalizeUserId(userId);
  const fromId = normalizeUserId(fromUserId);
  if (!hasUser(userIdNorm) || !hasUser(fromId)) {
    return { ok: false, message: 'This user no longer exists.' };
  }

  ensureUserCollections(userIdNorm);
  const requests = pendingIncoming.get(userIdNorm);
  if (!requests.has(fromId)) {
    return { ok: false, message: 'This friend request was not found.' };
  }

  requests.delete(fromId);
  linkFriends(userIdNorm, fromId);
  return { ok: true };
}

function declineFriendRequest(userId, fromUserId) {
  const userIdNorm = normalizeUserId(userId);
  const fromId = normalizeUserId(fromUserId);
  if (!hasUser(userIdNorm) || !hasUser(fromId)) {
    return { ok: false, message: 'This user no longer exists.' };
  }

  ensureUserCollections(userIdNorm);
  const requests = pendingIncoming.get(userIdNorm);
  if (!requests.has(fromId)) {
    return { ok: false, message: 'This friend request was not found.' };
  }

  requests.delete(fromId);
  return { ok: true };
}

function readJsonBody(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

export function createFriendsRouter() {
  const router = Router();

  router.get('/api/friends', (req, res) => {
    const userId = normalizeUserId(req.authUser?.id);
    if (!hasUser(userId)) {
      return res.status(401).json({ error: 'Please sign in again.' });
    }
    return res.json({
      self: getUser(userId),
      friends: getFriendProfiles(userId),
      requests: getIncomingFriendRequests(userId),
    });
  });

  router.post('/api/friends/add', (req, res) => {
    const userId = normalizeUserId(req.authUser?.id);
    const body = readJsonBody(req);
    if (!hasUser(userId)) {
      return res.status(401).json({ error: 'Please sign in again.' });
    }

    const result = addFriendRequest(userId, body.email);
    if (!result.ok) {
      return res.status(400).json({ error: result.message });
    }
    return res.status(201).json({ ok: true });
  });

  router.post('/api/friends/accept', (req, res) => {
    const userId = normalizeUserId(req.authUser?.id);
    const body = readJsonBody(req);
    if (!hasUser(userId)) {
      return res.status(401).json({ error: 'Please sign in again.' });
    }

    const result = acceptFriendRequest(userId, body.requestId);
    if (!result.ok) return res.status(404).json({ error: result.message });
    return res.json({
      ok: true,
      friends: getFriendProfiles(userId),
      requests: getIncomingFriendRequests(userId),
    });
  });

  router.post('/api/friends/decline', (req, res) => {
    const userId = normalizeUserId(req.authUser?.id);
    const body = readJsonBody(req);
    if (!hasUser(userId)) {
      return res.status(401).json({ error: 'Please sign in again.' });
    }

    const result = declineFriendRequest(userId, body.requestId);
    if (!result.ok) return res.status(404).json({ error: result.message });
    return res.json({
      ok: true,
      requests: getIncomingFriendRequests(userId),
    });
  });

  return router;
}

