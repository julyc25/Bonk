import { useNavigate } from 'react-router-dom';

const GoogleIcon = () => (
    <svg width="20" height="20" viewBox="0 0 48 48">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
);

const mono = { fontFamily: "monospace" };
const PRIMARY = '#000';
const SECONDARY_ACCENT = '#ff2e97';
const SECONDARY = '#FFF';

export default function Landing() {
    const navigate = useNavigate();
    return (
        <div style={{ minHeight: "100dvh", background: PRIMARY, color: SECONDARY, ...mono, display: "flex", flexDirection: "column" }}>
            <nav style={{ padding: "22px clamp(24px, 5vw, 48px)", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #6a6a6a"}}>
                <span style={{ fontSize: 24, fontWeight: 700, color: SECONDARY, letterSpacing: -0.5 }}>bonk</span>
            </nav>

            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", padding: "clamp(40px, 10vw, 80px) clamp(60px, 15vw, 160px)", gap: "clamp(40px, 8vw, 80px)" }}>
                
                <div style={{ flex: "1 1 260px", maxWidth: 380, minWidth: "min(100%, 260px)" }}>
                    <h1 style={{ fontSize: "clamp(36px, 10vw, 45px)", fontWeight: 700, lineHeight: 1.2, margin: 0, color: SECONDARY, wordBreak: "break-word", ...mono }}>
                        Share screens.<br />
                        <span style={{ color: SECONDARY_ACCENT }}>Stay focused.</span>
                    </h1>
                    <p style={{ color: "#999", fontSize: "clamp(12px, 3vw, 14px)", lineHeight: 1.6, margin: "16px 0 28px", maxWidth: 460 }}>
                        Addicted to your devices? More focused with others around? Meet <span style={{ fontStyle: "italic" }}>bonk</span>, a place where your friends monitor your screen as you work.
                    </p>

                    <div style={{ border: "1px solid #6a6a6a", padding: "16px", background: PRIMARY }}>
                        <button onClick={() => navigate('/view')} style={{ width: "100%", padding: "10px 16px", border: "1px solid #AAA", background: "#fff", color: "#000", fontSize: 13, ...mono, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxSizing: "border-box" }}>
                            <GoogleIcon /> Sign in with Google
                        </button>
                        <p style={{ color: "#999", fontSize: 11, lineHeight: 1.6, margin: "12px 0 0" }}>
                            by continuing you agree to the{" "}
                            <a href="#" style={{ color: SECONDARY_ACCENT, textDecoration: "none" }}>privacy policy</a>.
                        </p>
                    </div>
                </div>

                <div style={{ flex: "1 1 260px", display: "flex", justifyContent: "center", alignItems: "flex-start", minWidth: "min(100%, 260px)" }}>
                    <img style={{ width: "100%", maxWidth: 600, objectFit: "contain", border: "1px solid #6a6a6a" }} src="/demo.png" alt="Demo Screenshot" />
                </div>
            </div>
        </div>
    );
}