import socket from '../socket.js';

const DEFAULT_STUN_SERVER = 'stun:stun.l.google.com:19302';
const MAX_FAILED_RECONNECT_ATTEMPTS = 1;

function parseCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildIceConfig() {
  const iceServers = [{ urls: DEFAULT_STUN_SERVER }];
  const turnUrls = parseCsv(import.meta.env.VITE_TURN_URLS);
  const username = String(import.meta.env.VITE_TURN_USERNAME ?? '').trim();
  const credential = String(import.meta.env.VITE_TURN_CREDENTIAL ?? '').trim();

  if (turnUrls.length > 0 && username && credential) {
    iceServers.push({
      urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls,
      username,
      credential,
    });
  }

  return { iceServers };
}

const ICE_CONFIG = buildIceConfig();

/**
 * Map from peer id to RTCPeerConnection for all active connections.
 * Outbound: I am the sharer, they are the viewer.
 * Inbound: they are the sharer, I am the viewer.
 */
const outboundPeers = new Map();
const inboundPeers = new Map();
const outboundTracks = new Map();
const outboundReconnectAttempts = new Map();
const inboundReconnectAttempts = new Map();

/** Callbacks set by the UI to receive remote streams and cleanup events. */
let onRemoteStream = null;
let onRemoteStreamRemoved = null;
let onPeerConnectionFailed = null;

export function setOnRemoteStream(cb) { onRemoteStream = cb; }
export function setOnRemoteStreamRemoved(cb) { onRemoteStreamRemoved = cb; }
export function setOnPeerConnectionFailed(cb) { onPeerConnectionFailed = cb; }

function setupConnectionStateHandler(pc, peerId, direction) {
  const attemptsMap = direction === 'outbound' ? outboundReconnectAttempts : inboundReconnectAttempts;

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === 'connected') {
      attemptsMap.set(peerId, 0);
      return;
    }
    if (state !== 'failed') return;

    const attempts = attemptsMap.get(peerId) ?? 0;
    if (attempts < MAX_FAILED_RECONNECT_ATTEMPTS) {
      attemptsMap.set(peerId, attempts + 1);
      if (direction === 'outbound') {
        const track = outboundTracks.get(peerId);
        if (track && track.readyState === 'live') {
          createOutboundPeer(peerId, track);
          return;
        }
      } else {
        createInboundPeer(peerId);
        socket.emit('peer:request-offer', { toId: peerId });
        return;
      }
    }

    if (onPeerConnectionFailed) {
      onPeerConnectionFailed(peerId, direction);
    }
  };
}

/**
 * Create an outbound peer connection to a viewer.
 * Called once per online friend when we go live.
 */
export function createOutboundPeer(friendId, localTrack) {
  closeOutboundPeer(friendId);

  const pc = new RTCPeerConnection(ICE_CONFIG);
  outboundPeers.set(friendId, pc);
  outboundTracks.set(friendId, localTrack);
  pc.addTrack(localTrack);
  setupConnectionStateHandler(pc, friendId, 'outbound');

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('peer:ice', { toId: friendId, candidate: event.candidate });
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
 * Replace the video track sent to all outbound peers without renegotiating.
 */
export function replaceOutboundTrack(newTrack) {
  for (const [peerId, pc] of outboundPeers) {
    outboundTracks.set(peerId, newTrack);
    const sender = pc.getSenders().find((item) => item.track?.kind === 'video' || item.track === null);
    if (sender) {
      sender.replaceTrack(newTrack).catch((err) => {
        console.warn('[bonk] replaceTrack failed:', err);
      });
    }
  }
}

/**
 * Create an inbound peer connection to receive a sharer's stream.
 */
export function createInboundPeer(sharerId) {
  closeInboundPeer(sharerId);

  const pc = new RTCPeerConnection(ICE_CONFIG);
  inboundPeers.set(sharerId, pc);
  setupConnectionStateHandler(pc, sharerId, 'inbound');

  pc.ontrack = (event) => {
    const stream = event.streams[0] || new MediaStream([event.track]);
    if (onRemoteStream && stream) {
      onRemoteStream(sharerId, stream);
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('peer:ice', { toId: sharerId, candidate: event.candidate });
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
    pc.onconnectionstatechange = null;
    pc.close();
    outboundPeers.delete(friendId);
  }
}

function closeInboundPeer(sharerId) {
  const pc = inboundPeers.get(sharerId);
  if (pc) {
    pc.onconnectionstatechange = null;
    pc.close();
    inboundPeers.delete(sharerId);
  }
}

/** Close all outbound peers when sharing is stopped. */
export function closeAllOutbound() {
  for (const [id] of outboundPeers) {
    closeOutboundPeer(id);
  }
  outboundReconnectAttempts.clear();
  outboundTracks.clear();
}

/** Close a specific outbound peer by viewer id. */
export function closeOutbound(friendId) {
  closeOutboundPeer(friendId);
  outboundReconnectAttempts.delete(friendId);
  outboundTracks.delete(friendId);
}

/** Close a specific inbound peer when a sharer stops. */
export function closeInbound(sharerId) {
  closeInboundPeer(sharerId);
  inboundReconnectAttempts.delete(sharerId);
  if (onRemoteStreamRemoved) {
    onRemoteStreamRemoved(sharerId);
  }
}

/** Close everything. */
export function closeAllPeers() {
  for (const [id] of outboundPeers) closeOutboundPeer(id);
  for (const [id] of inboundPeers) closeInboundPeer(id);
  outboundReconnectAttempts.clear();
  inboundReconnectAttempts.clear();
  outboundTracks.clear();
}

/** Get the outbound peers map (for bonk-tab track swapping). */
export function getOutboundPeers() {
  return outboundPeers;
}
