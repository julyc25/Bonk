import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { attachAuth, authenticateSocket, createAuthRouter, requireAuth } from './auth.js';
import { createFriendsRouter, upsertUser } from './friends.js';
import { createSnapshotRouter, clearSnapshot } from './snapshots.js';
import { registerPresence } from './presence.js';
import { registerSignaling } from './signaling.js';

const PORT = 3001;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

app.use(express.json({ limit: '64kb' }));

/** Initialize REST routes. */
app.use(createAuthRouter({
  onUserAuthenticated: (user) => {
    upsertUser(user);
  },
}));
app.use('/api', attachAuth, requireAuth);
app.use(createFriendsRouter());
app.use(createSnapshotRouter(io));

// Return JSON for malformed JSON payloads instead of HTML error pages.
app.use((err, _req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Request body must be valid JSON.' });
  }
  return next(err);
});

/** Initialize Socket.io. */
io.use(authenticateSocket);
registerPresence(io);
registerSignaling(io);

/** Clean up snapshot when user stops live, and hook into socket event. */
io.on('connection', (socket) => {
  const userId = socket.data.authUser?.id ?? null;

  socket.on('user:stoplive', () => {
    if (userId) clearSnapshot(userId);
  });

  socket.on('disconnect', () => {
    if (userId) clearSnapshot(userId);
  });
});

httpServer.listen(PORT, () => {
  console.log(`bonk server listening on http://localhost:${PORT}`);
});
