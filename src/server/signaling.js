import { getFriends } from './friends.js';
import { getOnlineUsers, getLiveUsers } from './presence.js';

/**
 * Registers WebRTC signaling socket handlers.
 * Relays offers, answers, and ICE candidates between two users (peers).
 */
export function registerSignaling(io) {
  io.on('connection', (socket) => {
    let userId = null;

    socket.on('user:online', (id) => {
      userId = id;
    });

    /** Relay SDP offer to the target peer. */
    socket.on('peer:offer', ({ toId, sdp }) => {
      if (!userId) return;
      io.to(toId).emit('peer:offer', { fromId: userId, sdp });
    });

    /** Relay SDP answer to the target peer. */
    socket.on('peer:answer', ({ toId, sdp }) => {
      if (!userId) return;
      io.to(toId).emit('peer:answer', { fromId: userId, sdp });
    });

    /** Relay ICE candidate to the target peer. */
    socket.on('peer:ice', ({ toId, candidate }) => {
      if (!userId) return;
      io.to(toId).emit('peer:ice', { fromId: userId, candidate });
    });

    /**
     * Notify all friends when a user stops sharing, to tear down their inbound peer connections.
     */
    socket.on('user:stoplive', () => {
      if (!userId) return;
      const friendIds = getFriends(userId);
      for (const fid of friendIds) {
        io.to(fid).emit('peer:sharer-stopped', { sharerId: userId });
      }
    });
  });
}
