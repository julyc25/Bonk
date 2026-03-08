import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import socket from "./socket.js";
import { startSnapshotWorker, stopSnapshotWorker } from "./screenshare/snapshots.js";
import {
  createOutboundPeer,
  replaceOutboundTrack,
  closeAllOutbound,
  closeInbound,
  closeAllPeers,
  handleOffer,
  handleAnswer,
  handleIce,
  setOnRemoteStream,
  setOnRemoteStreamRemoved,
  createInboundPeer,
} from "./screenshare/peer.js";

export const mono = { fontFamily: "monospace" };

const PRIMARY = '#000';
const PRIMARY_ACCENT = '#555';
const SECONDARY_ACCENT = '#ff2e97';
const SECONDARY = '#FFF';

// TODO: Hardcoded for now, will do auth later.
// Use ?user=emily@gmail.com (or any friend ID) to test as a different user.
const USER_ID = new URLSearchParams(window.location.search).get("user") || "you@gmail.com";

// All known users — shared directory until auth/DB is wired up.
const ALL_USERS = {
  "you@gmail.com":     { name: "You",     status: "edit status here" },
  "emily@gmail.com":   { name: "Emily",   status: "doing 100 CS 2800 proofs" },
  "clarice@gmail.com": { name: "Clarice", status: "slacking off" },
  "julie@gmail.com":   { name: "Julie",   status: "making a cpu simulator for CS 3410" },
};

// Friend graph (mirrors src/server/friends.js)
const FRIEND_GRAPH = {
  "you@gmail.com":     ["emily@gmail.com", "clarice@gmail.com", "julie@gmail.com"],
  "emily@gmail.com":   ["you@gmail.com", "clarice@gmail.com", "julie@gmail.com"],
  "clarice@gmail.com": ["you@gmail.com", "emily@gmail.com"],
  "julie@gmail.com":   ["you@gmail.com", "emily@gmail.com"],
};

// Build FRIENDS dynamically: current user first (isYou), then their friends.
const myFriendIds = FRIEND_GRAPH[USER_ID] ?? [];
const me = ALL_USERS[USER_ID] ?? { name: USER_ID, status: "" };
const FRIENDS = [
  { id: USER_ID, name: me.name, status: me.status, isYou: true, live: false },
  ...myFriendIds.map((fid) => {
    const u = ALL_USERS[fid] ?? { name: fid, status: "" };
    return { id: fid, name: u.name, status: u.status, live: false };
  }),
];

const FRIEND_REQUESTS = [
  { id: "michelle@gmail.com", name: "Michelle" },
  { id: "yiwen@gmail.com", name: "Yiwen" },
  { id: "namitha@gmail.com", name: "Namitha" },
];

const btn = {
  background: PRIMARY,
  border: "1px solid #333",
  color: "#888",
  padding: "4px 8px",
  cursor: "pointer",
  fontSize: 12,
  ...mono,
};
const btnPink = { ...btn, border: `1px solid ${SECONDARY_ACCENT}`, color: SECONDARY_ACCENT };
const btnGreen = { ...btn, border: "1px solid #39ff14", color: "#39ff14" };
const btnDanger = {
  ...btn,
  border: `1px solid ${SECONDARY_ACCENT}`,
  background: SECONDARY_ACCENT,
  color: PRIMARY,
};


const Screen = ({ name, isBlurred, isOff, isViewingBonk, snapshotUrl }) => {
  if (isOff) {
    return <div style={{ width: "100%", height: "100%", background: PRIMARY }} />;
  }
  if (isViewingBonk) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: PRIMARY,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, color: SECONDARY_ACCENT, ...mono, marginBottom: 3 }}>
            ⚠ viewing bonk
          </div>
          <div style={{ fontSize: 10, color: "#333", ...mono }}>
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
        background: PRIMARY,
        filter: isBlurred ? "blur(8px)" : "none",
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
        ● live
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
      background: PRIMARY,
      border: "1px solid #333",
      color: SECONDARY,
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


/** Video element that auto-attaches a MediaStream via ref. */
const ExpandedVideo = ({ stream }) => {
  const videoRef = useRef(null);
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
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
          borderBottom: `1px solid ${SECONDARY_ACCENT}`,
          color: SECONDARY_ACCENT,
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
        color: SECONDARY_ACCENT,
        fontSize: 10,
        cursor: "text",
        borderBottom: `1px dashed ${SECONDARY_ACCENT}`,
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
        background: PRIMARY,
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
        <span style={{ color: SECONDARY, fontWeight: 700, fontSize: 14 }}>
          friends
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: PRIMARY_ACCENT,
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
            color: PRIMARY_ACCENT,
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
              background: PRIMARY,
              border: "1px solid #333",
              padding: "5px 8px",
              color: SECONDARY,
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
            color: PRIMARY_ACCENT,
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
              <div style={{ color: SECONDARY, fontSize: 13 }}>{r.name}</div>
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
  const [blurred, setBlurred] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [showFriends, setShowFriends] = useState(false);
  const [friends, setFriends] = useState(FRIENDS);
  const [requests, setRequests] = useState(FRIEND_REQUESTS);
  const [addEmail, setAddEmail] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [yourStatus, setYourStatus] = useState("edit status here");
  const [toast, setToast] = useState(null);

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

  /** Ref so the snapshot worker can read the latest viewingBonk without restarting */
  const viewingBonkRef = useRef(viewingBonk);
  useEffect(() => { viewingBonkRef.current = viewingBonk; }, [viewingBonk]);

  /** Hold the real video track so we can stop it later */
  const realTrackRef = useRef(null);

  /** Remote MediaStreams keyed by sharer userId */
  const remoteStreamsRef = useRef({});
  /** Counter to force re-render when remote streams change */
  const [remoteStreamVersion, setRemoteStreamVersion] = useState(0);

  /** Socket connection lifecycle */
  useEffect(() => {
    socket.connect();
    socket.emit("user:online", USER_ID);

    /** When a friend's snapshot is updated, refresh the URL. */
    socket.on("snapshot:update", ({ userId, timestamp }) => {
      setSnapshotUrls((prev) => ({
        ...prev,
        [userId]: `/api/snapshot/${encodeURIComponent(userId)}?t=${timestamp}`,
      }));
    });

    /** Init presence, mark friends as live/online */
    socket.on("presence:init", ({ liveFriends }) => {
      setFriends((prev) =>
        prev.map((f) =>
          liveFriends.includes(f.id) ? { ...f, live: true } : f
        )
      );
      for (const fid of liveFriends) {
        setSnapshotUrls((prev) => ({
          ...prev,
          [fid]: `/api/snapshot/${encodeURIComponent(fid)}?t=${Date.now()}`,
        }));
      }
    });

    /** Change in a friend's presence */
    socket.on("presence:update", ({ userId, online, live }) => {
      setFriends((prev) => {
        const exists = prev.some((f) => f.id === userId);
        if (!exists) return prev;
        return prev.map((f) =>
          f.id === userId ? { ...f, live, online } : f
        );
      });
      if (!live) {
        setSnapshotUrls((prev) => {
          const next = { ...prev };
          delete next[userId];
          return next;
        });
      }
    });

    // ── WebRTC signaling events ──

    setOnRemoteStream((sharerId, stream) => {
      remoteStreamsRef.current[sharerId] = stream;
      setRemoteStreamVersion((v) => v + 1);
    });
    setOnRemoteStreamRemoved((sharerId) => {
      delete remoteStreamsRef.current[sharerId];
      setRemoteStreamVersion((v) => v + 1);
    });

    socket.on("peer:request-offer", ({ fromId }) => {
      createInboundPeer(fromId);
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
    });

    return () => {
      socket.off("snapshot:update");
      socket.off("presence:init");
      socket.off("presence:update");
      socket.off("peer:request-offer");
      socket.off("peer:offer");
      socket.off("peer:answer");
      socket.off("peer:ice");
      socket.off("peer:sharer-stopped");
      closeAllPeers();
      socket.disconnect();
    };
  }, []);

  const handleAccept = (id) => {
    const r = requests.find((x) => x.id === id);
    if (r) {
      setFriends((prev) => [
        ...prev,
        { id: r.id, name: r.name, status: "", live: false },
      ]);
    }
    setRequests((prev) => prev.filter((x) => x.id !== id));
  };

  const handleDecline = (id) =>
    setRequests((prev) => prev.filter((x) => x.id !== id));

  const handleAdd = () => {
    if (addEmail.trim()) setAddEmail("");
  };

  const isViewable = (f) => (f.isYou ? screenOn : f.live);

  const handleCardClick = (id) => {
    const f = friends.find((x) => x.id === id);
    if (!f || !isViewable(f)) return;
    setShowPreview(false);
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleGoLiveToggle = (e) => {
    e.stopPropagation();
    if (screenOn) {
      stopSnapshotWorker();
      closeAllOutbound();
      if (realTrackRef.current) {
        realTrackRef.current.stop();
        realTrackRef.current = null;
      }
      socket.emit("user:stoplive");
      setScreenOn(false);
      setShowPreview(false);
      setExpandedId(null);
    } else {
      setShowPreview(true);
      setExpandedId(null);
    }
  };

  const handleConfirmLive = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor" },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];

      if (track.getSettings().displaySurface !== "monitor") {
        track.stop();
        setToast("Please share your entire screen.");
        setTimeout(() => setToast(null), 5000);
        await new Promise((r) => setTimeout(r, 300));
        return handleConfirmLive();
      }

      realTrackRef.current = track;

      track.onended = () => {
        stopSnapshotWorker();
        closeAllOutbound();
        socket.emit("user:stoplive");
        realTrackRef.current = null;
        setScreenOn(false);
        setShowPreview(false);
        setExpandedId(null);
      };

      setScreenOn(true);
      setShowPreview(false);
      setExpandedId(USER_ID);
      socket.emit("user:golive");

      const onlineFriends = friends.filter((f) => !f.isYou && f.online !== false);
      for (const f of onlineFriends) {
        createOutboundPeer(f.id, track);
      }

      startSnapshotWorker(
        track,
        USER_ID,
        () => viewingBonkRef.current
      );
    } catch (err) {
      console.warn("[bonk] screen capture cancelled:", err);
      setShowPreview(false);
    }
  };

  const handleCancelPreview = () => setShowPreview(false);

  const expanded = expandedId
    ? friends.find((f) => f.id === expandedId)
    : null;

  const youData = friends.find((f) => f.isYou);

  const sortedFriends = useMemo(() => {
    const you = friends.filter((f) => f.isYou);
    const others = friends.filter((f) => !f.isYou);
    const live = others.filter((f) => f.live);
    const notLive = others.filter((f) => !f.live);
    return [...you, ...live, ...notLive];
  }, [friends, screenOn]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: PRIMARY,
        color: SECONDARY,
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
          borderBottom: "1px solid #222",
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: PRIMARY,
        }}
      >
        <span style={{ fontSize: 24, fontWeight: 700, color: SECONDARY, letterSpacing: -0.5 }}>
          bonk
        </span>
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowFriends(!showFriends)}
            style={{
              ...btn,
              background: showFriends ? "#111" : PRIMARY,
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
                  right: -8,
                  background: SECONDARY_ACCENT,
                  color: PRIMARY,
                  fontSize: 10,
                  fontWeight: 700,
                  minWidth: 16,
                  padding: "0 4px",
                  boxSizing: "border-box",
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
        {/* PREVIEW SCREEN */}
        {showPreview && (
          <div style={{ maxWidth: 800, margin: "0 auto 12px" }}>
            <div
              style={{
                border: `1px dashed ${SECONDARY_ACCENT}`,
                background: PRIMARY,
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 6,
                  left: 8,
                  zIndex: 10,
                  border: `1px solid ${SECONDARY_ACCENT}`,
                  color: SECONDARY_ACCENT,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  background: PRIMARY,
                  ...mono,
                }}
              >
                PREVIEW — only you see this
              </div>
              <CloseBtn onClick={handleCancelPreview} />
              <div style={{ aspectRatio: "16/9", width: "100%" }}>
                <Screen
                  name={youData.name}
                  isBlurred={blurred}
                  isOff={false}
                  isViewingBonk={viewingBonk}
                  snapshotUrl={snapshotUrls[USER_ID]}
                />
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
                <div style={{ fontSize: 14, color: SECONDARY }}>
                  {youData.name}{" "}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
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
                    onClick={handleConfirmLive}
                    style={{
                      ...btnGreen,
                      background: "#39ff14",
                      color: PRIMARY,
                      fontWeight: 700,
                    }}
                  >
                    confirm &amp; go live
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* EXPANDED SCREEN */}
        {expanded && !showPreview && (
          <div style={{ maxWidth: 800, margin: "0 auto 12px" }}>
            <div
              style={{
                border: "1px solid #333",
                background: PRIMARY,
                position: "relative",
              }}
            >
              <CloseBtn onClick={() => setExpandedId(null)} />
              <div style={{ aspectRatio: "16/9", width: "100%" }}>
                {/* Use live <video> for friends with an active remote stream */}
                {!expanded.isYou && remoteStreamsRef.current[expanded.id] ? (
                  <ExpandedVideo stream={remoteStreamsRef.current[expanded.id]} />
                ) : (
                  <Screen
                    name={expanded.name}
                    isBlurred={expanded.isYou ? blurred : false}
                    isOff={expanded.isYou ? !screenOn : false}
                    isViewingBonk={expanded.isYou ? viewingBonk : false}
                    snapshotUrl={snapshotUrls[expanded.id]}
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
                    <div style={{ fontSize: 14, color: SECONDARY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
                        ● {isViewable(expanded) ? "live" : "not live"}
                      </span>
                    )}
                  </div>
                  {isViewable(expanded) && (
                    <div style={{ marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span style={{ color: PRIMARY_ACCENT, fontSize: 12 }}>
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
                  background: PRIMARY,
                  border: isExp ? `3px solid ${SECONDARY_ACCENT}` : "2px solid #333",
                  cursor: screenOff ? "default" : "pointer",
                  opacity: isExp ? 0.6 : 1,
                  transition: "opacity 0.15s",
                }}
              >
                <div style={{ aspectRatio: "16/10" }}>
                  <Screen
                    name={f.name}
                    isBlurred={f.isYou ? blurred : false}
                    isOff={screenOff}
                    isViewingBonk={f.isYou ? viewingBonk : false}
                    snapshotUrl={snapshotUrls[f.id]}
                  />
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
                      <div style={{ fontSize: 12, color: SECONDARY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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
                          ● {viewable ? "live" : "not live"}
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
                              color: PRIMARY_ACCENT,
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
                        {screenOn ? "stop" : "go live"}
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
