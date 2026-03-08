import { getFriends, hasUser, normalizeUserId } from './friends.js';

/** Map of user ids of online users to socket id. */
const onlineUsers = new Map();
/** Set of user ids currently sharing their screen. */
const liveUsers = new Set();

export function registerPresence(io) {
  io.on('connection', (socket) => {
    const userId = normalizeUserId(socket.data.authUser?.id);
    let isRegisteredOnline = false;

    socket.on('user:online', () => {
      if (!hasUser(userId)) {
        socket.emit('presence:error', { message: 'Could not verify this user. Please sign in again.' });
        return;
      }

      const existingSocketId = onlineUsers.get(userId);
      if (existingSocketId && existingSocketId !== socket.id) {
        const existingSocket = io.sockets.sockets.get(existingSocketId);
        if (existingSocket) existingSocket.disconnect(true);
      }

      onlineUsers.set(userId, socket.id);
      socket.join(userId);

      const friendIds = getFriends(userId);
      const liveFriends = friendIds.filter((fid) => liveUsers.has(fid));
      socket.emit('presence:init', {
        onlineFriends: friendIds.filter((fid) => onlineUsers.has(fid)),
        liveFriends,
      });

      if (isRegisteredOnline) return;
      isRegisteredOnline = true;

      for (const fid of friendIds) {
        io.to(fid).emit('presence:update', {
          userId,
          online: true,
          live: liveUsers.has(userId),
        });
      }
    });

    socket.on('user:golive', () => {
      if (!hasUser(userId)) return;
      liveUsers.add(userId);
      const friendIds = getFriends(userId);
      for (const fid of friendIds) {
        io.to(fid).emit('presence:update', {
          userId,
          online: true,
          live: true,
        });
      }
    });

    socket.on('user:stoplive', () => {
      if (!hasUser(userId)) return;
      liveUsers.delete(userId);
      const friendIds = getFriends(userId);
      for (const fid of friendIds) {
        io.to(fid).emit('presence:update', {
          userId,
          online: true,
          live: false,
        });
      }
    });

    socket.on('disconnect', () => {
      if (!hasUser(userId)) return;
      if (onlineUsers.get(userId) === socket.id) {
        onlineUsers.delete(userId);
      }
      liveUsers.delete(userId);
      const friendIds = getFriends(userId);
      for (const fid of friendIds) {
        io.to(fid).emit('presence:update', {
          userId,
          online: false,
          live: false,
        });
      }
      isRegisteredOnline = false;
    });
  });
}

export function getOnlineUsers() {
  return onlineUsers;
}

export function getLiveUsers() {
  return liveUsers;
}

