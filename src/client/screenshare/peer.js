import socket from '../socket.js';

const ICE_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

/**
 * Map from peer id to RTCPeerConnection for all active connections.
 * Outbound: I am the sharer, they are the viewer.
 * Inbound: they are the sharer, I am the viewer.
 */
const outboundPeers = new Map();
const inboundPeers = new Map();

/** Callbacks set by the UI to receive remote streams and cleanup events. */
let onRemoteStream = null;
let onRemoteStreamRemoved = null;

export function setOnRemoteStream(cb) { onRemoteStream = cb; }
export function setOnRemoteStreamRemoved(cb) { onRemoteStreamRemoved = cb; }

/**
 * Create an outbound peer connection to a viewer.
 * Called once per online friend when we go live.
 */
export function createOutboundPeer(friendId, localTrack) {
  // Close exsiting connection to friend if it exists
  closeOutboundPeer(friendId);

  const pc = new RTCPeerConnection(ICE_CONFIG);
  outboundPeers.set(friendId, pc);

  pc.addTrack(localTrack);

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('peer:ice', { toId: friendId, candidate: e.candidate });
    }
  };

  pc.onnegotiationneeded = async () => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('peer:offer', { toId: friendId, sdp: pc.localDescription });
    } catch (err) {
      console.warn('[bonk] offer creation failed:', err);
    }
  };

  return pc;
}

/**
 * Replace the video track sent to all outbound peers without needint to renegotiate the connection.
 */
export function replaceOutboundTrack(newTrack) {
  for (const [, pc] of outboundPeers) {
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video' || s.track === null);
    if (sender) {
      sender.replaceTrack(newTrack).catch((err) =>
        console.warn('[bonk] replaceTrack failed:', err)
      );
    }
  }
}

/**
 * Create an inbound peer connection to receive a sharer's stream.
 */
export function createInboundPeer(sharerId) {
  // Close if I already have an inbound connection from this sharer
  closeInboundPeer(sharerId);

  const pc = new RTCPeerConnection(ICE_CONFIG);
  inboundPeers.set(sharerId, pc);

  pc.ontrack = (event) => {
    if (onRemoteStream && event.streams[0]) {
      onRemoteStream(sharerId, event.streams[0]);
    }
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('peer:ice', { toId: sharerId, candidate: e.candidate });
    }
  };

  return pc;
}

/**
 * Handle an incoming SDP offer.
 * Creates an inbound peer if it doesn't exist, sets remote description,
 * creates an answer, and sends it back.
 */
export async function handleOffer(fromId, sdp) {
  let pc = inboundPeers.get(fromId);
  if (!pc) {
    pc = createInboundPeer(fromId);
  }
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('peer:answer', { toId: fromId, sdp: pc.localDescription });
  } catch (err) {
    console.warn('[bonk] handleOffer failed:', err);
  }
}

/**
 * Handle an incoming SDP answer.
 * Sets the remote description on our outbound peer.
 */
export async function handleAnswer(fromId, sdp) {
  const pc = outboundPeers.get(fromId);
  if (!pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  } catch (err) {
    console.warn('[bonk] handleAnswer failed:', err);
  }
}

/**
 * Handle an incoming ICE candidate (can be either outbound or inbound peer).
 */
export async function handleIce(fromId, candidate) {
  const pc = outboundPeers.get(fromId) || inboundPeers.get(fromId);
  if (!pc) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.warn('[bonk] addIceCandidate failed:', err);
  }
}

function closeOutboundPeer(friendId) {
  const pc = outboundPeers.get(friendId);
  if (pc) {
    pc.close();
    outboundPeers.delete(friendId);
  }
}

function closeInboundPeer(sharerId) {
  const pc = inboundPeers.get(sharerId);
  if (pc) {
    pc.close();
    inboundPeers.delete(sharerId);
  }
}

/** Close all outbound peers when sharing is stopped. */
export function closeAllOutbound() {
  for (const [id] of outboundPeers) {
    closeOutboundPeer(id);
  }
}

/** Close a specific inbound peer when a sharer stops. */
export function closeInbound(sharerId) {
  closeInboundPeer(sharerId);
  if (onRemoteStreamRemoved) {
    onRemoteStreamRemoved(sharerId);
  }
}

/** Close everything. */
export function closeAllPeers() {
  for (const [id] of outboundPeers) closeOutboundPeer(id);
  for (const [id] of inboundPeers) closeInboundPeer(id);
}

/** Get the outbound peers map (for bonk-tab track swapping). */
export function getOutboundPeers() {
  return outboundPeers;
}
