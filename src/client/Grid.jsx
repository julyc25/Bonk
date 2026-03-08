import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import socket from "./socket.js";
import bonkSoundUrl from "../sound/bonk.mp3";
import { startSnapshotWorker, stopSnapshotWorker } from "./screenshare/snapshots.js";
import {
  createOutboundPeer,
  closeAllOutbound,
  closeOutbound,
  closeInbound,
  closeAllPeers,
  handleOffer,
  handleAnswer,
  handleIce,
  setOnRemoteStream,
  setOnRemoteStreamRemoved,
  getOutboundPeers,
  setOnPeerConnectionFailed,
} from "./screenshare/peer.js";

const mono = { fontFamily: "monospace" };

const PRIMARY = '#000';
const PRIMARY_ACCENT = '#666';
const SECONDARY_ACCENT = '#ff2e97';
const SECONDARY = '#FFF';
const BONK_SOUND_URL = bonkSoundUrl;
const LOCAL_BLUR_FILTER = "blur(10px)";
const SHARED_BLUR_FILTER = "blur(14px)";

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload.error || "Couldn't complete that request. Please try again.");
    err.status = response.status;
    throw err;
  }
  return payload;
}

function normalizeFriendModel(self, friends) {
  const you = {
    id: self.id,
    name: self.name || self.id,
    status: self.status || "",
    isYou: true,
    live: false,
    online: true,
  };
  const others = (friends ?? []).map((friend) => ({
    id: friend.id,
    name: friend.name || friend.id,
    status: friend.status || "",
    isYou: false,
    live: false,
    online: false,
  }));
  return [you, ...others];
}

const btn = {
  background: "#000",
  border: "1px solid #333",
  color: "#BBB",
  padding: "4px 8px",
  cursor: "pointer",
  fontSize: 12,
  ...mono,
};
const btnPink = { ...btn, border: "1px solid #ff2e97", color: "#ff2e97" };
const btnGreen = { ...btn, border: "1px solid #39ff14", color: "#39ff14" };
const btnDanger = {
  ...btn,
  border: "1px solid #ff2e97",
  background: "#ff2e97",
  color: "#000",
};


const Screen = ({ name, isBlurred, isOff, isViewingBonk, snapshotUrl }) => {
  if (isOff) {
    return <div style={{ width: "100%", height: "100%", background: "#000" }} />;
  }
  if (isViewingBonk) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "#ff2e97", ...mono, marginBottom: 3 }}>
            [viewing bonk]
          </div>
          <div style={{ fontSize: 10, color: "#6a6a6a", ...mono }}>
            screen paused
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#000",
        filter: isBlurred ? LOCAL_BLUR_FILTER : "none",
        transition: "filter 0.2s",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {snapshotUrl ? (
        <img
          src={snapshotUrl}
          alt={`${name}'s screen`}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <div
          style={{
            opacity: 0.15,
            fontSize: 11,
            color: SECONDARY,
            ...mono,
            lineHeight: 1.5,
            textAlign: "center",
          }}
        >
          {`~ ${name.split(" ")[0].toLowerCase()} ~`}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          bottom: 5,
          right: 6,
          fontSize: 8,
          color: "#39ff14",
          ...mono,
        }}
      >
      </div>
    </div>
  );
};


const CloseBtn = ({ onClick }) => (
  <button
    onClick={onClick}
    style={{
      position: "absolute",
      top: 6,
      right: 6,
      zIndex: 10,
      background: "#000",
      border: "1px solid #333",
      color: "#fff",
      width: 28,
      height: 28,
      cursor: "pointer",
      fontSize: 14,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      ...mono,
    }}
  >
    x
  </button>
);

const BonkButton = ({ visible, onClick }) => (
  <button
    onClick={onClick}
    style={{
      position: "absolute",
      right: 8,
      bottom: 8,
      zIndex: 12,
      border: "1px solid #ff2e97",
      background: "rgba(0,0,0,0.85)",
      color: "#ff2e97",
      padding: "3px 8px",
      fontSize: 11,
      cursor: "pointer",
      opacity: visible ? 1 : 0,
      pointerEvents: visible ? "auto" : "none",
      transition: "opacity 0.12s ease",
      ...mono,
    }}
  >
    bonk
  </button>
);


/** Video element that auto-attaches a MediaStream via ref. */
const ExpandedVideo = ({ stream }) => {
  const videoRef = useRef(null);
  useEffect(() => {
    const node = videoRef.current;
    if (node && stream) {
      node.srcObject = stream;
    }
    return () => {
      if (node) {
        node.srcObject = null;
      }
    };
  }, [stream]);
  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        display: "block",
        background: PRIMARY,
      }}
    />
  );
};


const StatusEditor = ({ value, onChange }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    onChange(draft.trim() || value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        style={{
          background: "transparent",
          border: "none",
          borderBottom: "1px solid #ff2e97",
          color: "#ff2e97",
          fontSize: 10,
          outline: "none",
          width: "100%",
          minWidth: 0,
          boxSizing: "border-box",
          ...mono,
        }}
      />
    );
  }

  return (
    <span
      title="click to edit your status"
      onClick={(e) => {
        e.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
      style={{
        color: "#ff2e97",
        fontSize: 10,
        cursor: "text",
        borderBottom: "1px dashed #ff2e97",
        marginTop: 1,
        display: "inline-block",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        maxWidth: "100%",
      }}
    >
      {value}
    </span>
  );
};


const FriendsPanel = ({
  show,
  onClose,
  requests,
  onAccept,
  onDecline,
  addEmail,
  setAddEmail,
  onAdd,
}) => {
  if (!show) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        right: 0,
        width: 320,
        maxHeight: "calc(100vh - 70px)",
        background: "#000",
        border: "1px solid #333",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        ...mono,
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #222",
        }}
      >
        <span style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>
          friends
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#555",
            cursor: "pointer",
            fontSize: 16,
            ...mono,
          }}
        >
          x
        </button>
      </div>

      <div style={{ padding: "10px 12px", borderBottom: "1px solid #222" }}>
        <div
          style={{
            color: "#555",
            fontSize: 11,
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          add friend by email
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <input
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            placeholder="friend@gmail.com"
            style={{
              flex: 1,
              background: "#000",
              border: "1px solid #333",
              padding: "5px 8px",
              color: "#fff",
              fontSize: 13,
              outline: "none",
              ...mono,
            }}
          />
          <button
            onClick={onAdd}
            style={{ ...btnPink, opacity: addEmail.trim() ? 1 : 0.4 }}
          >
            add
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
        <div
          style={{
            color: "#555",
            fontSize: 11,
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          requests ({requests.length})
        </div>
        {requests.length === 0 && (
          <div style={{ color: "#333", fontSize: 13 }}>none</div>
        )}
        {requests.map((r) => (
          <div
            key={r.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 0",
              borderBottom: "1px solid #111",
            }}
          >
            <div>
              <div style={{ color: "#fff", fontSize: 13 }}>{r.name}</div>
              <div style={{ color: "#444", fontSize: 11 }}>{r.id}</div>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={() => onAccept(r.id)}
                style={{ ...btnGreen, fontSize: 11 }}
              >
                ok
              </button>
              <button
                onClick={() => onDecline(r.id)}
                style={{ ...btn, fontSize: 11 }}
              >
                no
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};


export default function Grid() {
  const navigate = useNavigate();
  const [blurred, setBlurred] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [showFriends, setShowFriends] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [addEmail, setAddEmail] = useState("");
  const [yourStatus, setYourStatus] = useState("");
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [toast, setToast] = useState(null);
  const [hoveredVideoId, setHoveredVideoId] = useState(null);
  const [removeFriendId, setRemoveFriendId] = useState(null);
  const [removingFriendId, setRemovingFriendId] = useState(null);

  // Track if this tab is active
  const [viewingBonk, setViewingBonk] = useState(
    () => document.visibilityState === "visible"
  );
  
  useEffect(() => {
    const onVisibility = () =>
      setViewingBonk(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  /** Snapshot URLs keyed by friend userId */
  const [snapshotUrls, setSnapshotUrls] = useState({});

  /** Latest presence snapshot from socket, used to avoid races with initial friends fetch. */
  const onlineFriendsRef = useRef(new Set());
  const liveFriendsRef = useRef(new Set());

  const applyPresenceToFriends = (friendList) =>
    friendList.map((friend) => {
      if (friend.isYou) return { ...friend, online: true };
      return {
        ...friend,
        online: onlineFriendsRef.current.has(friend.id),
        live: liveFriendsRef.current.has(friend.id),
      };
    });

  /** Ref so the snapshot worker can read the latest viewingBonk without restarting */
  const viewingBonkRef = useRef(viewingBonk);
  useEffect(() => { viewingBonkRef.current = viewingBonk; }, [viewingBonk]);
  const blurredRef = useRef(blurred);
  useEffect(() => { blurredRef.current = blurred; }, [blurred]);

  /** Hold the real video track so we can stop it later */
  const realTrackRef = useRef(null);
  const shareTrackRef = useRef(null);
  const sharePipelineRef = useRef(null);
  const bonkAudioRef = useRef(null);

  /** Remote MediaStreams keyed by sharer userId */
  const [remoteStreams, setRemoteStreams] = useState({});
  /** Inbound peers that exhausted reconnect attempts and should render as offline. */
  const [peerUnavailable, setPeerUnavailable] = useState({});

  useEffect(() => {
    const audio = new Audio(BONK_SOUND_URL);
    audio.preload = "auto";
    bonkAudioRef.current = audio;
    return () => {
      audio.pause();
      bonkAudioRef.current = null;
    };
  }, []);

  const playBonkSound = useCallback(() => {
    const audio = bonkAudioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  }, []);

  const stopSharePipeline = useCallback(() => {
    const pipeline = sharePipelineRef.current;
    sharePipelineRef.current = null;
    shareTrackRef.current = null;
    if (!pipeline) return;
    if (pipeline.intervalId !== null) {
      clearInterval(pipeline.intervalId);
    }
    pipeline.video.pause();
    pipeline.video.srcObject = null;
    if (pipeline.outputTrack.readyState === "live") {
      pipeline.outputTrack.stop();
    }
  }, []);

  useEffect(() => () => {
    stopSharePipeline();
  }, [stopSharePipeline]);

  /** Load friend graph and pending requests from backend. */
  useEffect(() => {
    let cancelled = false;

    async function loadFriends() {
      try {
        setLoadingFriends(true);
        const mePayload = await apiJson("/api/me");
        if (cancelled) return;
        setCurrentUser(mePayload.user);

        const payload = await apiJson("/api/friends");
        if (cancelled) return;
        setFriends(applyPresenceToFriends(normalizeFriendModel(payload.self, payload.friends)));
        setRequests(payload.requests ?? []);
        setYourStatus(payload.self?.status || "edit status here");
      } catch (err) {
        if (cancelled) return;
        if (err.status === 401) {
          navigate("/");
          return;
        }
        setToast(err instanceof Error ? err.message : "Couldn't load your friends right now.");
        setTimeout(() => setToast(null), 4000);
      } finally {
        if (!cancelled) setLoadingFriends(false);
      }
    }

    loadFriends();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  /** Socket connection lifecycle */
  useEffect(() => {
    if (!currentUser?.id) return undefined;

    socket.connect();
    socket.emit("user:online");

    /** When a friend's snapshot is updated, refresh the URL. */
    socket.on("snapshot:update", ({ userId, timestamp }) => {
      setSnapshotUrls((prev) => ({
        ...prev,
        [userId]: `/api/snapshot/${encodeURIComponent(userId)}?t=${timestamp}`,
      }));
    });

    socket.on("presence:error", ({ message }) => {
      setToast(message || "Couldn't update your online status.");
      setTimeout(() => setToast(null), 4000);
    });

    socket.on("signaling:error", ({ message }) => {
      setToast(message || "Couldn't start live sharing.");
      setTimeout(() => setToast(null), 4000);
    });

    /** Init presence, mark friends as live/online */
    socket.on("presence:init", ({ onlineFriends = [], liveFriends = [] }) => {
      onlineFriendsRef.current = new Set(onlineFriends);
      liveFriendsRef.current = new Set(liveFriends);
      setFriends((prev) =>
        applyPresenceToFriends(prev)
      );
      for (const fid of liveFriends) {
        setSnapshotUrls((prev) => ({
          ...prev,
          [fid]: `/api/snapshot/${encodeURIComponent(fid)}?t=${Date.now()}`,
        }));
      }
      setPeerUnavailable((prev) => {
        const next = {};
        for (const [id, failed] of Object.entries(prev)) {
          if (failed && liveFriends.includes(id)) {
            next[id] = true;
          }
        }
        return next;
      });
    });

    /** Change in a friend's presence */
    socket.on("presence:update", ({ userId, online, live }) => {
      if (online === false) {
        onlineFriendsRef.current.delete(userId);
        liveFriendsRef.current.delete(userId);
      } else {
        if (online) onlineFriendsRef.current.add(userId);
        if (live) {
          liveFriendsRef.current.add(userId);
        } else {
          liveFriendsRef.current.delete(userId);
        }
      }

      setFriends((prev) => {
        const exists = prev.some((f) => f.id === userId);
        if (!exists) return prev;
        return prev.map((f) =>
          f.id === userId ? { ...f, live, online } : f
        );
      });
      if (online && shareTrackRef.current && !getOutboundPeers().has(userId)) {
        createOutboundPeer(userId, shareTrackRef.current);
      }
      if (online === false) {
        closeInbound(userId);
      }
      if (!live) {
        setSnapshotUrls((prev) => {
          const next = { ...prev };
          delete next[userId];
          return next;
        });
        closeInbound(userId);
        setPeerUnavailable((prev) => {
          if (!prev[userId]) return prev;
          const next = { ...prev };
          delete next[userId];
          return next;
        });
      }
    });

    // WebRTC signaling events

    setOnRemoteStream((sharerId, stream) => {
      setPeerUnavailable((prev) => {
        if (!prev[sharerId]) return prev;
        const next = { ...prev };
        delete next[sharerId];
        return next;
      });
      setRemoteStreams((prev) => ({ ...prev, [sharerId]: stream }));
    });
    setOnRemoteStreamRemoved((sharerId) => {
      setRemoteStreams((prev) => {
        const next = { ...prev };
        delete next[sharerId];
        return next;
      });
    });
    setOnPeerConnectionFailed((peerId, direction) => {
      if (direction === "inbound") {
        closeInbound(peerId);
        setPeerUnavailable((prev) => ({ ...prev, [peerId]: true }));
      }
    });

    socket.on("peer:request-offer", ({ fromId }) => {
      if (!shareTrackRef.current) return;
      createOutboundPeer(fromId, shareTrackRef.current);
    });

    socket.on("peer:offer", ({ fromId, sdp }) => {
      handleOffer(fromId, sdp);
    });

    socket.on("peer:answer", ({ fromId, sdp }) => {
      handleAnswer(fromId, sdp);
    });

    socket.on("peer:ice", ({ fromId, candidate }) => {
      handleIce(fromId, candidate);
    });

    socket.on("peer:sharer-stopped", ({ sharerId }) => {
      closeInbound(sharerId);
      setPeerUnavailable((prev) => {
        if (!prev[sharerId]) return prev;
        const next = { ...prev };
        delete next[sharerId];
        return next;
      });
    });

    socket.on("peer:bonk", () => {
      playBonkSound();
    });

    return () => {
      socket.off("snapshot:update");
      socket.off("presence:init");
      socket.off("presence:update");
      socket.off("presence:error");
      socket.off("signaling:error");
      socket.off("peer:request-offer");
      socket.off("peer:offer");
      socket.off("peer:answer");
      socket.off("peer:ice");
      socket.off("peer:sharer-stopped");
      socket.off("peer:bonk");
      setOnRemoteStream(null);
      setOnRemoteStreamRemoved(null);
      setOnPeerConnectionFailed(null);
      closeAllPeers();
      setRemoteStreams({});
      socket.disconnect();
    };
  }, [currentUser?.id, playBonkSound]);

  const handleAccept = async (id) => {
    try {
      const payload = await apiJson("/api/friends/accept", {
        method: "POST",
        body: JSON.stringify({ requestId: id }),
      });
      setFriends((prev) => {
        const self = prev.find((f) => f.isYou);
        if (!self) return prev;
        const previousById = new Map(prev.map((friend) => [friend.id, friend]));
        const others = (payload.friends ?? []).map((friend) => ({
          id: friend.id,
          name: friend.name || friend.id,
          status: friend.status || "",
          isYou: false,
          live: previousById.get(friend.id)?.live ?? false,
          online: previousById.get(friend.id)?.online ?? false,
        }));
        return [self, ...others];
      });
      setRequests(payload.requests ?? []);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Couldn't accept that request.");
      setTimeout(() => setToast(null), 4000);
    }
  };

  const handleDecline = async (id) => {
    try {
      const payload = await apiJson("/api/friends/decline", {
        method: "POST",
        body: JSON.stringify({ requestId: id }),
      });
      setRequests(payload.requests ?? []);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Couldn't decline that request.");
      setTimeout(() => setToast(null), 4000);
    }
  };

  const handleAdd = async () => {
    const email = addEmail.trim().toLowerCase();
    if (!email) return;
    try {
      await apiJson("/api/friends/add", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setAddEmail("");
      setToast("Friend request sent.");
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Couldn't send friend request.");
      setTimeout(() => setToast(null), 4000);
    }
  };

  const cleanupFriendViewState = (friendId) => {
    closeInbound(friendId);
    closeOutbound(friendId);
    onlineFriendsRef.current.delete(friendId);
    liveFriendsRef.current.delete(friendId);
    setSnapshotUrls((prev) => {
      if (!prev[friendId]) return prev;
      const next = { ...prev };
      delete next[friendId];
      return next;
    });
    setPeerUnavailable((prev) => {
      if (!prev[friendId]) return prev;
      const next = { ...prev };
      delete next[friendId];
      return next;
    });
    setRemoteStreams((prev) => {
      if (!prev[friendId]) return prev;
      const next = { ...prev };
      delete next[friendId];
      return next;
    });
    setHoveredVideoId((prev) => (prev === friendId ? null : prev));
    setExpandedId((prev) => (prev === friendId ? null : prev));
  };

  const handleRemoveFriendConfirm = async (event, friendId) => {
    event.stopPropagation();
    if (removingFriendId) return;
    try {
      setRemovingFriendId(friendId);
      const payload = await apiJson("/api/friends/remove", {
        method: "POST",
        body: JSON.stringify({ friendId }),
      });
      setFriends((prev) => {
        const self = prev.find((f) => f.isYou);
        if (!self) return prev.filter((f) => f.id !== friendId);
        const previousById = new Map(prev.map((friend) => [friend.id, friend]));
        const others = (payload.friends ?? []).map((friend) => ({
          id: friend.id,
          name: friend.name || friend.id,
          status: friend.status || "",
          isYou: false,
          live: previousById.get(friend.id)?.live ?? liveFriendsRef.current.has(friend.id),
          online: previousById.get(friend.id)?.online ?? onlineFriendsRef.current.has(friend.id),
        }));
        return [self, ...others];
      });
      setRequests((prev) => payload.requests ?? prev);
      cleanupFriendViewState(friendId);
      setRemoveFriendId(null);
      setToast("Friend removed.");
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Couldn't remove this friend.");
      setTimeout(() => setToast(null), 4000);
    } finally {
      setRemovingFriendId(null);
    }
  };

  const isViewable = (f) => (f.isYou ? screenOn : f.live && !peerUnavailable[f.id]);

  const handleCardClick = (id) => {
    if (removeFriendId) setRemoveFriendId(null);
    const f = friends.find((x) => x.id === id);
    if (!f || !isViewable(f)) return;
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleBonk = (event, friendId) => {
    event.stopPropagation();
    const friend = friends.find((item) => item.id === friendId);
    if (!friend || friend.isYou || !isViewable(friend)) return;
    socket.emit("peer:bonk", { toId: friendId });
    playBonkSound();
  };

  const createShareTrack = (sourceTrack) => {
    stopSharePipeline();

    const sourceStream = new MediaStream([sourceTrack]);
    const video = document.createElement("video");
    video.srcObject = sourceStream;
    video.muted = true;
    video.playsInline = true;
    void video.play().catch(() => {});

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const fps = Math.min(
      30,
      Math.max(8, Math.round(sourceTrack.getSettings?.().frameRate ?? 15))
    );
    const outputStream = canvas.captureStream(fps);
    const outputTrack = outputStream.getVideoTracks()[0];

    const pipeline = {
      video,
      outputTrack,
      intervalId: null,
    };
    sharePipelineRef.current = pipeline;
    shareTrackRef.current = outputTrack;

    const render = () => {
      if (sharePipelineRef.current !== pipeline) return;
      if (sourceTrack.readyState !== "live") return;
      const width = video.videoWidth || sourceTrack.getSettings?.().width || 1280;
      const height = video.videoHeight || sourceTrack.getSettings?.().height || 720;
      if (width > 0 && height > 0) {
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        if (ctx) {
          ctx.filter = blurredRef.current ? SHARED_BLUR_FILTER : "none";
          ctx.drawImage(video, 0, 0, width, height);
          ctx.filter = "none";
        }
      }
    };

    pipeline.intervalId = setInterval(render, Math.max(16, Math.round(1000 / fps)));
    render();
    return outputTrack;
  };

  const stopLiveSession = () => {
    stopSnapshotWorker();
    closeAllOutbound();
    stopSharePipeline();
    if (realTrackRef.current) {
      const track = realTrackRef.current;
      realTrackRef.current = null;
      track.onended = null;
      track.stop();
    }
    socket.emit("user:stoplive");
    setScreenOn(false);
    setExpandedId(null);
  };

  const handleGoLiveToggle = (e) => {
    e.stopPropagation();
    if (screenOn) {
      stopLiveSession();
    } else {
      setExpandedId(null);
      void handleConfirmLive();
    }
  };

  const handleConfirmLive = async () => {
    if (!currentUser?.id) {
      setToast("Please sign in again.");
      setTimeout(() => setToast(null), 3000);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "monitor",
          monitorTypeSurfaces: "include",
          preferCurrentTab: false,
          selfBrowserSurface: "exclude",
        },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];

      realTrackRef.current = track;
      const shareTrack = createShareTrack(track);

      track.onended = () => {
        stopLiveSession();
      };

      setScreenOn(true);
      setExpandedId(currentUser?.id ?? null);
      socket.emit("user:golive");

      const onlineFriendIds = onlineFriendsRef.current;
      const onlineFriends = friends.filter(
        (f) => !f.isYou && (onlineFriendIds.size === 0 || onlineFriendIds.has(f.id))
      );
      for (const f of onlineFriends) {
        createOutboundPeer(f.id, shareTrack);
      }

      startSnapshotWorker(
        shareTrack,
        currentUser?.id,
        () => viewingBonkRef.current
      );
    } catch (err) {
      console.warn("[bonk] screen capture cancelled:", err);
    }
  };

  const expanded = expandedId
    ? friends.find((f) => f.id === expandedId)
    : null;
  const expandedCanBonk = Boolean(expanded && !expanded.isYou && isViewable(expanded));

  const sortedFriends = useMemo(() => {
    const you = friends.filter((f) => f.isYou);
    const others = friends.filter((f) => !f.isYou);
    const live = others.filter((f) => f.live);
    const notLive = others.filter((f) => !f.live);
    return [...you, ...live, ...notLive];
  }, [friends]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#000",
        color: "#fff",
        ...mono,
      }}
    >
      {/* NAVBAR */}
      <nav
        style={{
          padding: "22px 48px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #6a6a6a",
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: "#000",
        }}
      >
        <span style={{ fontSize: 24, fontWeight: 700, color: "#fff", letterSpacing: -0.5 }}>
          bonk
        </span>
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowFriends(!showFriends)}
            style={{
              ...btn,
              background: showFriends ? "#111" : "#000",
              display: "flex",
              alignItems: "center",
              gap: 4,
              position: "relative",
            }}
          >
            [friends]
            {requests.length > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: -5,
                  right: -5,
                  background: "#ff2e97",
                  color: "#000",
                  fontSize: 10,
                  fontWeight: 700,
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {requests.length}
              </span>
            )}
          </button>
          <FriendsPanel
            show={showFriends}
            onClose={() => setShowFriends(false)}
            requests={requests}
            onAccept={handleAccept}
            onDecline={handleDecline}
            addEmail={addEmail}
            setAddEmail={setAddEmail}
            onAdd={handleAdd}
          />
        </div>
      </nav>

      {showFriends && (
        <div
          onClick={() => setShowFriends(false)}
          style={{ position: "fixed", inset: 0, zIndex: 49 }}
        />
      )}

      <div style={{ padding: "12px 24px 40px" }}>
        {loadingFriends && (
          <div style={{ color: PRIMARY_ACCENT, fontSize: 12, marginBottom: 8 }}>
            loading friends...
          </div>
        )}
        {/* EXPANDED SCREEN */}
        {expanded && (
          <div style={{ maxWidth: 800, margin: "0 auto 12px" }}>
            <div
              style={{
                border: "1px solid #333",
                background: "#000",
                position: "relative",
              }}
            >
              <CloseBtn onClick={() => setExpandedId(null)} />
              <div
                style={{ aspectRatio: "16/9", width: "100%", position: "relative" }}
                onMouseEnter={() => {
                  if (expandedCanBonk) setHoveredVideoId(expanded.id);
                }}
                onMouseLeave={() => {
                  if (expandedCanBonk) setHoveredVideoId((prev) => (prev === expanded.id ? null : prev));
                }}
              >
                {/* Use live <video> for friends with an active remote stream */}
                {!expanded.isYou && remoteStreams[expanded.id] ? (
                  <ExpandedVideo stream={remoteStreams[expanded.id]} />
                ) : (
                  <Screen
                    name={expanded.name}
                    isBlurred={expanded.isYou ? blurred : false}
                    isOff={expanded.isYou ? !screenOn : false}
                    isViewingBonk={expanded.isYou ? viewingBonk : false}
                    snapshotUrl={snapshotUrls[expanded.id]}
                  />
                )}
                {expandedCanBonk && (
                  <BonkButton
                    visible={hoveredVideoId === expanded.id}
                    onClick={(event) => handleBonk(event, expanded.id)}
                  />
                )}
              </div>
              <div
                style={{
                  borderTop: "1px solid #222",
                  padding: "8px 10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 14, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {expanded.name}
                    </div>
                    {!expanded.isYou && (
                      <span
                        style={{
                          fontSize: 12,
                          color: isViewable(expanded) ? "#39ff14" : "#444",
                          flexShrink: 0,
                          ...mono,
                        }}
                      >
                        * {isViewable(expanded) ? "live" : "not live"}
                      </span>
                    )}
                  </div>
                  {isViewable(expanded) && (
                    <div style={{ marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span style={{ color: "#555", fontSize: 12 }}>
                        {expanded.isYou ? yourStatus : expanded.status}
                      </span>
                    </div>
                  )}
                </div>
                {expanded.isYou && (
                  <div style={{ display: "flex", gap: 4, marginLeft: 12, flexShrink: 0 }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setBlurred(!blurred);
                      }}
                      style={blurred ? btnPink : btn}
                    >
                      {blurred ? "[unblur]" : "[blur]"}
                    </button>
                    <button
                      onClick={handleGoLiveToggle}
                      style={screenOn ? btnDanger : btn}
                    >
                      {screenOn ? "[stop]" : "[go live]"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* MAIN GRID */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          {sortedFriends.map((f) => {
            const isExp = expandedId === f.id;
            const viewable = isViewable(f);
            const screenOff = !viewable;
            const displayStatus = f.isYou ? yourStatus : f.status;

            return (
              <div
                key={f.id}
                onClick={() => handleCardClick(f.id)}
                style={{
                  background: "#000",
                  border: isExp ? "3px solid #ff2e97" : "2px solid #333",
                  position: "relative",
                  cursor: screenOff ? "default" : "pointer",
                  opacity: isExp ? 0.6 : 1,
                  transition: "opacity 0.15s",
                }}
              >
                {!f.isYou && (
                  <>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        setRemoveFriendId((prev) => (prev === f.id ? null : f.id));
                      }}
                      disabled={Boolean(removingFriendId)}
                      title="remove friend"
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        zIndex: 16,
                        width: 18,
                        height: 18,
                        border: "1px solid #333",
                        background: "#000",
                        color: "#888",
                        fontSize: 11,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        ...mono,
                      }}
                    >
                      x
                    </button>
                    {removeFriendId === f.id && (
                      <div
                        onClick={(event) => event.stopPropagation()}
                        style={{
                          position: "absolute",
                          top: 28,
                          right: 6,
                          zIndex: 18,
                          border: "1px solid #ff2e97",
                          background: "#000",
                          padding: "8px 10px",
                          minWidth: 106,
                          maxWidth: 106
                        }}
                      >
                        <div style={{ fontSize: 10, color: "#ff2e97", marginBottom: 6 }}>
                          remove friend?
                        </div>
                        <div style={{ display: "flex", gap: 10 }}>
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              if (removingFriendId !== f.id) setRemoveFriendId(null);
                            }}
                            disabled={removingFriendId === f.id}
                            style={{
                              ...btn,
                              fontSize: 10,
                              padding: "2px 5px",
                            }}
                          >
                            cancel
                          </button>
                          <button
                            onClick={(event) => handleRemoveFriendConfirm(event, f.id)}
                            disabled={removingFriendId === f.id}
                            style={{
                              ...btnDanger,
                              fontSize: 10,
                              padding: "2px 5px",
                              background: "#ff2e97",
                              color: "#000",
                            }}
                          >
                            {removingFriendId === f.id ? "..." : "confirm"}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
                <div
                  style={{ aspectRatio: "16/10", position: "relative" }}
                  onMouseEnter={() => {
                    if (!f.isYou && viewable) setHoveredVideoId(f.id);
                  }}
                  onMouseLeave={() => {
                    if (!f.isYou) setHoveredVideoId((prev) => (prev === f.id ? null : prev));
                  }}
                >
                  <Screen
                    name={f.name}
                    isBlurred={f.isYou ? blurred : false}
                    isOff={screenOff}
                    isViewingBonk={f.isYou ? viewingBonk : false}
                    snapshotUrl={snapshotUrls[f.id]}
                  />
                  {!f.isYou && viewable && (
                    <BonkButton
                      visible={hoveredVideoId === f.id}
                      onClick={(event) => handleBonk(event, f.id)}
                    />
                  )}
                </div>
                <div
                  style={{
                    borderTop: "1px solid #222",
                    padding: "5px 7px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div style={{ fontSize: 12, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {f.name}
                      </div>
                      {!f.isYou && (
                        <span
                          style={{
                            fontSize: 10,
                            color: viewable ? "#39ff14" : "#444",
                            flexShrink: 0,
                            ...mono,
                          }}
                        >
                          * {viewable ? "live" : "not live"}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2, minHeight: 14, overflow: "hidden" }}>
                      {viewable && (
                        f.isYou ? (
                          <StatusEditor value={yourStatus} onChange={setYourStatus} />
                        ) : displayStatus ? (
                          <span
                            style={{
                              color: "#555",
                              fontSize: 10,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {displayStatus}
                          </span>
                        ) : null
                      )}
                    </div>
                  </div>
                  {f.isYou && (
                    <div style={{ display: "flex", gap: 3, marginLeft: 6, flexShrink: 0 }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setBlurred(!blurred);
                        }}
                        style={{
                          ...(blurred ? btnPink : btn),
                          padding: "2px 5px",
                        }}
                      >
                        {blurred ? "unblur" : "blur"}
                      </button>
                      <button
                        onClick={handleGoLiveToggle}
                        style={{
                          ...(screenOn ? btnDanger : btn),
                          padding: "2px 5px",
                        }}
                      >
                        {screenOn ? "stop" : "live"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: SECONDARY_ACCENT,
            color: PRIMARY,
            padding: "8px 16px",
            fontSize: 11,
            fontWeight: 700,
            zIndex: 200,
            ...mono,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
