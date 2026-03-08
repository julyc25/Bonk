import { getFriends } from './friends.js';

/** Map of user ids of online users to socket id. */
const onlineUsers = new Map();
/** Set of user ids currently sharing their screen. */
const liveUsers = new Set();

/** 
 * {io} is the server. 
 */
export function registerPresence(io) {
  io.on('connection', (socket) => {
    let userId = null;

    socket.on('user:online', (id) => {
      userId = id;
      onlineUsers.set(userId, socket.id);
      //Join a room named after the userId for targeted emits
      socket.join(userId); 

      // Tell this user which of their friends are currently live
      const friendIds = getFriends(userId);
      const liveFriends = friendIds.filter((fid) => liveUsers.has(fid));
      socket.emit('presence:init', {
        onlineFriends: friendIds.filter((fid) => onlineUsers.has(fid)),
        liveFriends,
      });

      // Notify friends that this user came online
      for (const fid of friendIds) {
        io.to(fid).emit('presence:update', {
          userId,
          online: true,
          live: liveUsers.has(userId),
        });
      }
    });

    socket.on('user:golive', () => {
      if (!userId) return;
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
      if (!userId) return;
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
      if (!userId) return;
      onlineUsers.delete(userId);
      liveUsers.delete(userId);
      const friendIds = getFriends(userId);
      for (const fid of friendIds) {
        io.to(fid).emit('presence:update', {
          userId,
          online: false,
          live: false,
        });
      }
      userId = null;
    });
  });
}

export function getOnlineUsers() {
  return onlineUsers;
}

export function getLiveUsers() {
  return liveUsers;
}
