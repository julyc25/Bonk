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
    let resizeObserver = null;
    let onWindowResize = null;
    let lastRenderedWidth = 0;

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

        const renderGoogleButton = () => {
          if (cancelled || !googleBtnRef.current) return;
          const host = googleBtnRef.current;
          const width = Math.max(180, Math.min(320, Math.floor(host.clientWidth - 20)));
          if (Math.abs(width - lastRenderedWidth) < 2) return;
          lastRenderedWidth = width;
          host.innerHTML = '';
          window.google.accounts.id.renderButton(host, {
            theme: 'outline',
            size: 'large',
            text: 'signin_with',
            shape: 'rectangular',
            width,
          });
        };

        renderGoogleButton();
        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => renderGoogleButton());
          resizeObserver.observe(googleBtnRef.current);
        } else {
          onWindowResize = () => renderGoogleButton();
          window.addEventListener('resize', onWindowResize);
        }
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
      resizeObserver?.disconnect();
      if (onWindowResize) window.removeEventListener('resize', onWindowResize);
    };
  }, [navigate]);

  return (
    <div style={{ minHeight: '100dvh', background: PRIMARY, color: SECONDARY, ...mono, display: 'flex', flexDirection: 'column' }}>
      <nav style={{ padding: '22px clamp(24px, 5vw, 48px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #6a6a6a' }}>
        <span style={{ fontSize: 24, fontWeight: 700, color: SECONDARY, letterSpacing: -0.5 }}>bonk</span>
      </nav>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', padding: 'clamp(40px, 10vw, 80px) clamp(60px, 15vw, 160px)', gap: 'clamp(40px, 8vw, 80px)' }}>
        <div style={{ flex: '1 1 260px', maxWidth: 380, minWidth: 'min(100%, 260px)' }}>
          <h1 style={{ fontSize: 'clamp(36px, 10vw, 45px)', fontWeight: 700, lineHeight: 1.2, margin: 0, color: SECONDARY, wordBreak: 'break-word', ...mono }}>
            Share screens.
            <br />
            <span style={{ color: SECONDARY_ACCENT }}>Stay focused.</span>
          </h1>
          <p style={{ color: '#999', fontSize: 'clamp(12px, 3vw, 14px)', lineHeight: 1.6, margin: '16px 0 28px', maxWidth: 460 }}>
            Addicted to your devices? More focused with others around? Meet <span style={{ fontStyle: 'italic' }}>bonk</span>, a place where your friends monitor your screen as you work.
          </p>

          <div style={{ border: '1px solid #6a6a6a', padding: '16px', background: PRIMARY }}>
            <div
              ref={googleBtnRef}
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'center',
                padding: '6px 10px',
                boxSizing: 'border-box',
              }}
            />
            {loadingAuth && <p style={{ color: '#999', fontSize: 11, lineHeight: 1.6, margin: '12px 0 0' }}>Initializing Google sign-in...</p>}
            {authError && <p style={{ color: SECONDARY_ACCENT, fontSize: 11, lineHeight: 1.6, margin: '12px 0 0' }}>{authError}</p>}
            <p style={{ color: '#999', fontSize: 11, lineHeight: 1.6, margin: '12px 14px 0' }}>
              By continuing you agree to the{' '}
              <a href="#" style={{ color: SECONDARY_ACCENT, textDecoration: 'none' }}>privacy policy</a>.
            </p>
          </div>
        </div>

        <div style={{ flex: '1 1 260px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', minWidth: 'min(100%, 260px)' }}>
          <img style={{ width: '100%', maxWidth: 600, objectFit: 'contain', border: '1px solid #6a6a6a' }} src="/demo.png" alt="Demo Screenshot" />
        </div>
      </div>
    </div>
  );
}
