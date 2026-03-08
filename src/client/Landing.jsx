import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const mono = { fontFamily: 'monospace' };
const PRIMARY = '#000';
const SECONDARY_ACCENT = '#ff2e97';
const SECONDARY = '#FFF';

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.getElementById('google-gsi-script');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Sign in failed. Please try again.');
  }
  return payload;
}

export default function Landing() {
  const navigate = useNavigate();
  const googleBtnRef = useRef(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const initAuth = async () => {
      try {
        const me = await fetch('/api/me', { credentials: 'include' });
        if (me.ok) {
          navigate('/view', { replace: true });
          return;
        }

        const config = await apiJson('/api/auth/config');
        if (!config.googleEnabled || !config.googleClientId) {
          setAuthError('Google sign-in is not configured on this server.');
          return;
        }

        await loadGoogleScript();
        if (cancelled || !googleBtnRef.current) return;

        window.google.accounts.id.initialize({
          client_id: config.googleClientId,
          callback: async ({ credential }) => {
            try {
              await apiJson('/api/auth/google', {
                method: 'POST',
                body: JSON.stringify({ credential }),
              });
              navigate('/view', { replace: true });
            } catch (err) {
              setAuthError(err instanceof Error ? err.message : 'Google sign-in failed.');
            }
          },
        });

        googleBtnRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          width: 380,
        });
      } catch (err) {
        if (!cancelled) {
          setAuthError(err instanceof Error ? err.message : 'Unable to initialize sign-in.');
        }
      } finally {
        if (!cancelled) setLoadingAuth(false);
      }
    };

    initAuth();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div style={{
      minHeight: '100dvh',
      background: PRIMARY,
      color: SECONDARY,
      ...mono,
      display: 'flex',
      flexDirection: 'column',
    }}
    >
      <nav style={{
        padding: '22px clamp(24px, 5vw, 48px)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid #222',
      }}
      >
        <span style={{ fontSize: 24, fontWeight: 700, color: SECONDARY, letterSpacing: -0.5 }}>bonk</span>
      </nav>

      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        padding: 'clamp(40px, 10vw, 80px) clamp(24px, 8vw, 60px)',
        gap: 'clamp(40px, 8vw, 80px)',
      }}
      >
        <div style={{ flex: '1 1 300px', maxWidth: 520, minWidth: 'min(100%, 300px)' }}>
          <h1 style={{
            fontSize: 'clamp(36px, 10vw, 64px)',
            fontWeight: 700,
            lineHeight: 1.2,
            margin: 0,
            color: SECONDARY,
            wordBreak: 'break-word',
            ...mono,
          }}
          >
            Share screens,
            <br />
            <span style={{ color: SECONDARY_ACCENT }}>Stay focused.</span>
          </h1>
          <p style={{
            color: '#999',
            fontSize: 'clamp(14px, 4vw, 18px)',
            lineHeight: 1.8,
            margin: '24px 0 40px',
            maxWidth: 460,
          }}
          >
            Addicted to your devices? More focused with others around? Meet <span style={{ fontStyle: 'italic' }}>bonk</span>, a place where your friends monitor your screen as you work.
          </p>

          <div style={{ border: '1px solid #333', padding: 'clamp(20px, 5vw, 32px)', background: PRIMARY }}>
            <div ref={googleBtnRef} style={{ width: '100%', maxWidth: 420 }} />
            {loadingAuth && (
              <p style={{ color: '#999', fontSize: 14, marginTop: 14 }}>Initializing Google sign-in...</p>
            )}
            {authError && (
              <p style={{ color: SECONDARY_ACCENT, fontSize: 14, marginTop: 14 }}>{authError}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

