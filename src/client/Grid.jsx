import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import socket from "./socket.js";
import { startSnapshotWorker, stopSnapshotWorker } from "./screenshare/snapshots.js";


export const mono = { fontFamily: "monospace" };
const PRIMARY = '#000';
const PRIMARY_ACCENT = '#555';
const SECONDARY_ACCENT = '#ff2e97';
const SECONDARY = '#FFF';


const FRIENDS = [
 {
   id: "you@gmail.com",
   name: "You",
   status: "edit status here",
   isYou: true,
   live: false,
 },
 {
   id: "emily@gmail.com",
   name: "Emily",
   status: "doing 100 CS 2800 proofs",
   live: true,
 },
 {
   id: "clarice@gmail.com",
   name: "Clarice",
   status: "slacking off",
   live: false,
 },
 {
   id: "julie@gmail.com",
   name: "Julie",
   status: "making a cpu simulator for CS 3410",
   live: true,
 }
];


const FRIEND_REQUESTS = [
 { id: "michelle@gmail.com", name: "Michelle" },
 { id: "yiwen@gmail.com", name: "Yiwen" },
 { id: "namitha@gmail.com", name: "Namitha" },
];


const btn = {
 background: "#000",
 border: "1px solid #333",
 color: "#888",
 padding: "4px 8px",
 cursor: "pointer",
 fontSize: 10,
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


// TODO: Hardcoded for now, will do auth later.
const USER_ID = "you@gmail.com";

const Screen = ({ name, isBlurred, isOff, isViewingBonk, snapshotUrl }) => {
 // Shows a black screen when not live
 if (isOff) {
   return <div style={{ width: "100%", height: "100%", background: "#000" }} />;
 }
 // Pauses screen sharing when on this tab
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
         <div style={{ fontSize: 9, color: "#ff2e97", ...mono, marginBottom: 3 }}>
           ⚠ viewing bonk
         </div>
         <div style={{ fontSize: 8, color: "#333", ...mono }}>
           screen paused
         </div>
       </div>
       <div
         style={{
           position: "absolute",
           bottom: 5,
           right: 6,
           fontSize: 8,
           color: "#ff2e97",
           ...mono,
         }}
       >
         ● live
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
           fontSize: 9,
           color: "#fff",
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
     background: "#000",
     border: "1px solid #333",
     color: "#fff",
     width: 24,
     height: 24,
     cursor: "pointer",
     fontSize: 12,
     display: "flex",
     alignItems: "center",
     justifyContent: "center",
     ...mono,
   }}
 >
   x
 </button>
);


// Editable status for user
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
         fontSize: 8,
         outline: "none",
         width: "100%",
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
       fontSize: 8,
       cursor: "text",
       borderBottom: "1px dashed #ff2e97",
       marginTop: 1,
       display: "inline-block",
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
       width: 300,
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
       <span style={{ color: "#fff", fontWeight: 700, fontSize: 12 }}>
         friends
       </span>
       <button
         onClick={onClose}
         style={{
           background: "none",
           border: "none",
           color: "#555",
           cursor: "pointer",
           fontSize: 14,
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
           fontSize: 9,
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
             fontSize: 11,
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
           fontSize: 9,
           textTransform: "uppercase",
           marginBottom: 8,
         }}
       >
         requests ({requests.length})
       </div>
       {requests.length === 0 && (
         <div style={{ color: "#333", fontSize: 11 }}>none</div>
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
             <div style={{ color: "#fff", fontSize: 11 }}>{r.name}</div>
             <div style={{ color: "#444", fontSize: 9 }}>{r.id}</div>
           </div>
           <div style={{ display: "flex", gap: 4 }}>
             <button
               onClick={() => onAccept(r.id)}
               style={{ ...btnGreen, fontSize: 9 }}
             >
               ok
             </button>
             <button
               onClick={() => onDecline(r.id)}
               style={{ ...btn, fontSize: 9 }}
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
 const [yourStatus, setYourStatus] = useState("");
 const [toast, setToast] = useState(null);


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
     /** Pre-fetch snapshots for friends that are already live */
     for (const fid of liveFriends) {
       setSnapshotUrls((prev) => ({
         ...prev,
         [fid]: `/api/snapshot/${encodeURIComponent(fid)}?t=${Date.now()}`,
       }));
     }
   });

   // Change in a friend's presense
   socket.on("presence:update", ({ userId, online, live }) => {
     setFriends((prev) => {
       const exists = prev.some((f) => f.id === userId);
       if (!exists) return prev;
       return prev.map((f) =>
         f.id === userId ? { ...f, live, online } : f
       );
     });
     if (!live) {
       // Clear previous snapshot
       setSnapshotUrls((prev) => {
         const next = { ...prev };
         delete next[userId];
         return next;
       });
     }
   });

   return () => {
     socket.off("snapshot:update");
     socket.off("presence:init");
     socket.off("presence:update");
     socket.disconnect();
   };
 }, []);


 const handleAccept = (id) => {
   const r = requests.find((x) => x.id === id);
   if (r) {
     setFriends((prev) => [
       ...prev,
       {
         id: r.id,
         name: r.name,
         status: "",
         live: false,
       },
     ]);
   }
   setRequests((prev) => prev.filter((x) => x.id !== id));
 };


 const handleDecline = (id) =>
   setRequests((prev) => prev.filter((x) => x.id !== id));


 const handleAdd = () => {
   if (addEmail.trim()) setAddEmail("");
 };


 const isViewable = (f) => f.isYou ? screenOn : f.live;


 const handleCardClick = (id) => {
   const f = friends.find((x) => x.id === id);
   if (!f || !isViewable(f)) return;
   setExpandedId((prev) => (prev === id ? null : id));
 };


 const handleGoLiveToggle = (e) => {
   e.stopPropagation();
   if (screenOn) {
     // Stop sharing
     stopSnapshotWorker();
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

     // Only allow entire-screen sharing
     if (track.getSettings().displaySurface !== "monitor") {
       track.stop();
       setToast("Please share your entire screen.");
       setTimeout(() => setToast(null), 5000);
       await new Promise((r) => setTimeout(r, 300));
       return handleConfirmLive();
     }

     realTrackRef.current = track;

     // If the user stops sharing via browser UI, clean up
     track.onended = () => {
       stopSnapshotWorker();
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

     startSnapshotWorker(
       track,
       USER_ID,
       () => viewingBonkRef.current
     );
   } catch (err) {
     // User cancelled the screen picker or permission denied
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
         borderBottom: "1px solid #222",
         position: "sticky",
         top: 0,
         zIndex: 50,
         background: "#000",
         fontSize: 24
       }}
     >
       <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: -0.5 }}>
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
                 fontSize: 8,
                 fontWeight: 700,
                 width: 14,
                 height: 14,
                 borderRadius: 7,
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
       {showPreview && (
         <div style={{ marginBottom: 12 }}>
           <div
             style={{
               border: "1px dashed #ff2e97",
               background: "#000",
               position: "relative",
             }}
           >
             <div
               style={{
                 position: "absolute",
                 top: 6,
                 left: 8,
                 zIndex: 10,
                 border: "1px solid #ff2e97",
                 color: "#ff2e97",
                 fontSize: 9,
                 fontWeight: 700,
                 padding: "2px 8px",
                 background: "#000",
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
               <div style={{ fontSize: 12, color: "#fff" }}>
                 {youData.name}*{" "}
                 <span style={{ color: "#ff2e97", fontSize: 10 }}>
                   preview
                 </span>
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
                     color: "#000",
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


       {expanded && !showPreview && (
         <div style={{ marginBottom: 12 }}>
           <div
             style={{
               border: "1px solid #333",
               background: "#000",
               position: "relative",
             }}
           >
             <CloseBtn onClick={() => setExpandedId(null)} />
             <div style={{ aspectRatio: "16/9", width: "100%" }}>
               <Screen
                 name={expanded.name}
                 isBlurred={expanded.isYou ? blurred : false}
                 isOff={expanded.isYou ? !screenOn : false}
                 isViewingBonk={expanded.isYou ? viewingBonk : false}
                 snapshotUrl={snapshotUrls[expanded.id]}
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
               <div style={{ fontSize: 12, color: "#fff" }}>
                 {expanded.name}
                 {expanded.isYou ? "*" : ""}{" "}
                 {isViewable(expanded) && (
                   <span style={{ color: "#555", fontSize: 10 }}>
                     {expanded.isYou ? yourStatus : expanded.status}
                   </span>
                 )}
               </div>
               {expanded.isYou && (
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


       <div
         style={{
           display: "grid",
           gridTemplateColumns: "repeat(4, 1fr)",
           gap: 6,
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
                   <div style={{ fontSize: 10, color: "#fff" }}>
                     {f.name}
                     {f.isYou ? "*" : ""}
                   </div>
                   <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
                     <span
                       style={{
                         fontSize: 8,
                         color: viewable ? "#39ff14" : "#444",
                         flexShrink: 0,
                         ...mono,
                       }}
                     >
                       {viewable ? "live" : "not live"}
                     </span>
                     {viewable && (
                       f.isYou ? (
                         <StatusEditor value={yourStatus} onChange={setYourStatus} />
                       ) : displayStatus ? (
                         <span
                           style={{
                             color: "#555",
                             fontSize: 8,
                             overflow: "hidden",
                             textOverflow: "ellipsis",
                             whiteSpace: "nowrap",
                           }}
                         >
                           · {displayStatus}
                         </span>
                       ) : null
                     )}
                   </div>
                 </div>
                 {f.isYou && (
                   <div style={{ display: "flex", gap: 3, marginLeft: 4 }}>
                     <button
                       onClick={(e) => {
                         e.stopPropagation();
                         setBlurred(!blurred);
                       }}
                       style={{
                         ...(blurred ? btnPink : btn),
                         fontSize: 8,
                         padding: "2px 5px",
                       }}
                     >
                       {blurred ? "unblur" : "blur"}
                     </button>
                     <button
                       onClick={handleGoLiveToggle}
                       style={{
                         ...(screenOn ? btnDanger : btn),
                         fontSize: 8,
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
           background: "#ff2e97",
           color: "#000",
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
