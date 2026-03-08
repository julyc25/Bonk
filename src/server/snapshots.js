import { Router } from 'express';
import multer from 'multer';
import { getFriends } from './friends.js';

/** Map user id to { buffer: Buffer, timestamp: number } */
const store = new Map();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 }, // 512 KB max per snapshot
});

/** Returns a new router, setting up HTTP routes and Socket events. */
export function createSnapshotRouter(io) {
  // handles REST endpoints
  const router = Router();

  // Client sends a JPEG blob and userId field
  router.post('/api/snapshot', upload.single('frame'), (req, res) => {
    const userId = req.body.userId;
    if (!userId || !req.file) {
      return res.status(400).json({ error: 'missing userId or frame' });
    }

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
    const entry = store.get(req.params.userId);
    if (!entry) {
      return res.status(404).json({ error: 'no snapshot' });
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
