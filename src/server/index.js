import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createSnapshotRouter, clearSnapshot } from './snapshots.js';
import { registerPresence } from './presence.js';

const PORT = 3001;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

/** Initialize REST routes. */
app.use(createSnapshotRouter(io));

/** Initialize Socket.io. */
registerPresence(io);

/** Clean up snapshot when user stops live, and hook into socket event. */
io.on('connection', (socket) => {
  let userId = null;

  socket.on('user:online', (id) => {
    userId = id;
  });

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
