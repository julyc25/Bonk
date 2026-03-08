import { areFriends, getFriends, hasUser, normalizeUserId } from './friends.js';
import { getOnlineUsers } from './presence.js';

/**
 * Registers WebRTC signaling socket handlers.
 * Relays offers, answers, and ICE candidates between two users (peers).
 */
export function registerSignaling(io) {
  io.on('connection', (socket) => {
    const userId = normalizeUserId(socket.data.authUser?.id);
    let isOnline = false;

    socket.on('user:online', () => {
      if (!hasUser(userId)) {
        socket.emit('signaling:error', { message: 'Could not verify this user for live sharing.' });
        return;
      }
      isOnline = true;
    });

    /**
     * When a user goes live, tell each of their online friends to prepare an inbound peer.
     */
    socket.on('user:golive', () => {
      if (!isOnline || !hasUser(userId)) return;
      const friendIds = getFriends(userId);
      const online = getOnlineUsers();
      for (const fid of friendIds) {
        if (online.has(fid)) {
          io.to(fid).emit('peer:request-offer', { fromId: userId });
        }
      }
    });

    /** Relay reconnect-triggered offer requests to a target peer. */
    socket.on('peer:request-offer', ({ toId }) => {
      if (!isOnline || !hasUser(userId)) return;
      const targetId = normalizeUserId(toId);
      if (!targetId || !areFriends(userId, targetId)) return;
      if (!getOnlineUsers().has(targetId)) return;
      io.to(targetId).emit('peer:request-offer', { fromId: userId });
    });

    /** Relay SDP offer to the target peer. */
    socket.on('peer:offer', ({ toId, sdp }) => {
      if (!isOnline || !hasUser(userId)) return;
      if (!sdp || typeof sdp !== 'object') return;
      const targetId = normalizeUserId(toId);
      if (!targetId || !areFriends(userId, targetId)) return;
      if (!getOnlineUsers().has(targetId)) return;
      io.to(targetId).emit('peer:offer', { fromId: userId, sdp });
    });

    /** Relay SDP answer to the target peer. */
    socket.on('peer:answer', ({ toId, sdp }) => {
      if (!isOnline || !hasUser(userId)) return;
      if (!sdp || typeof sdp !== 'object') return;
      const targetId = normalizeUserId(toId);
      if (!targetId || !areFriends(userId, targetId)) return;
      if (!getOnlineUsers().has(targetId)) return;
      io.to(targetId).emit('peer:answer', { fromId: userId, sdp });
    });

    /** Relay ICE candidate to the target peer. */
    socket.on('peer:ice', ({ toId, candidate }) => {
      if (!isOnline || !hasUser(userId)) return;
      if (!candidate || typeof candidate !== 'object') return;
      const targetId = normalizeUserId(toId);
      if (!targetId || !areFriends(userId, targetId)) return;
      if (!getOnlineUsers().has(targetId)) return;
      io.to(targetId).emit('peer:ice', { fromId: userId, candidate });
    });

    /**
     * Notify all friends when a user stops sharing, to tear down their inbound peer connections.
     */
    socket.on('user:stoplive', () => {
      if (!isOnline || !hasUser(userId)) return;
      const friendIds = getFriends(userId);
      for (const fid of friendIds) {
        io.to(fid).emit('peer:sharer-stopped', { sharerId: userId });
      }
    });
  });
}

