import { Router } from 'express';
import multer from 'multer';
import { getFriends, hasUser, normalizeUserId } from './friends.js';

/** Map user id to { buffer: Buffer, timestamp: number } */
const store = new Map();
const DEFAULT_SNAPSHOT_TTL_MS = 30_000;
const SNAPSHOT_TTL_MS = Number.parseInt(process.env.SNAPSHOT_TTL_MS ?? `${DEFAULT_SNAPSHOT_TTL_MS}`, 10)
  || DEFAULT_SNAPSHOT_TTL_MS;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 }, // 512 KB max per snapshot
});

function isExpired(entry, now = Date.now()) {
  return now - entry.timestamp > SNAPSHOT_TTL_MS;
}

function evictExpiredSnapshots() {
  const now = Date.now();
  for (const [userId, entry] of store) {
    if (isExpired(entry, now)) {
      store.delete(userId);
    }
  }
}

function getLiveSnapshot(userId) {
  const entry = store.get(userId);
  if (!entry) return null;
  if (isExpired(entry)) {
    store.delete(userId);
    return null;
  }
  return entry;
}

/** Returns a new router, setting up HTTP routes and Socket events. */
export function createSnapshotRouter(io) {
  const cleanupTimer = setInterval(() => {
    evictExpiredSnapshots();
  }, Math.max(5_000, Math.floor(SNAPSHOT_TTL_MS / 2)));
  cleanupTimer.unref?.();

  io.on('close', () => {
    clearInterval(cleanupTimer);
  });

  // handles REST endpoints
  const router = Router();

  // Client sends a JPEG blob; user is read from authenticated session.
  router.post('/api/snapshot', upload.single('frame'), (req, res) => {
    const userId = normalizeUserId(req.authUser?.id);
    if (!userId || !hasUser(userId) || !req.file) {
      return res.status(400).json({ error: 'Please provide a valid user and image frame.' });
    }
    if (!req.file.mimetype?.startsWith('image/')) {
      return res.status(415).json({ error: 'Unsupported file type. Please upload an image.' });
    }

    evictExpiredSnapshots();
    const entry = {
      buffer: req.file.buffer,
      contentType: req.file.mimetype || 'image/jpeg',
      timestamp: Date.now(),
    };
    store.set(userId, entry);

    // Notify friends via socket.io
    const friendIds = getFriends(userId);
    for (const fid of friendIds) {
      io.to(fid).emit('snapshot:update', {
        userId,
        timestamp: entry.timestamp,
      });
    }

    res.json({ ok: true });
  });

  // Returns the latest JPEG for a user
  router.get('/api/snapshot/:userId', (req, res) => {
    const targetUserId = normalizeUserId(req.params.userId);
    const entry = getLiveSnapshot(targetUserId);
    if (!entry) {
      return res.status(404).json({ error: 'No snapshot is available yet.' });
    }
    res.set('Content-Type', entry.contentType);
    res.set('Cache-Control', 'no-store');
    res.send(entry.buffer);
  });

  return router;
}

export function clearSnapshot(userId) {
  store.delete(userId);
}
