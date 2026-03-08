import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { config as loadEnv } from 'dotenv';
import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';

loadEnv({ quiet: true });

const SESSION_COOKIE = 'bonk_session';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const sessions = new Map();

const googleClientId = process.env.GOOGLE_CLIENT_ID ?? '';
const oauthClient = googleClientId ? new OAuth2Client(googleClientId) : null;
const sessionSecret = process.env.SESSION_SECRET ?? crypto.randomBytes(32).toString('hex');

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const entry of cookieHeader.split(';')) {
    const [rawKey, ...rawValueParts] = entry.trim().split('=');
    if (!rawKey) continue;
    cookies[rawKey] = decodeURIComponent(rawValueParts.join('='));
  }
  return cookies;
}

function signSessionId(sessionId) {
  return crypto.createHmac('sha256', sessionSecret).update(sessionId).digest('hex');
}

function issueSession(user) {
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  sessions.set(sessionId, { user, expiresAt });
  return `${sessionId}.${signSessionId(sessionId)}`;
}

function getUserFromSessionToken(token) {
  if (!token) return null;
  const [sessionId, signature] = token.split('.');
  if (!sessionId || !signature) return null;

  const expected = signSessionId(sessionId);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  const entry = sessions.get(sessionId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return entry.user;
}

function deleteSessionFromToken(token) {
  if (!token) return;
  const [sessionId] = token.split('.');
  if (sessionId) sessions.delete(sessionId);
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function readSessionTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE] ?? null;
}

function userFromGooglePayload(payload) {
  const email = normalizeEmail(payload?.email);
  if (!email) return null;
  if (!payload?.email_verified) return null;
  return {
    id: email,
    email,
    name: String(payload?.name || payload?.given_name || email.split('@')[0]),
    picture: payload?.picture ?? null,
  };
}

export function attachAuth(req, _res, next) {
  const sessionToken = readSessionTokenFromRequest(req);
  req.authUser = getUserFromSessionToken(sessionToken);
  next();
}

export function requireAuth(req, res, next) {
  if (!req.authUser) {
    return res.status(401).json({ error: 'Please sign in to continue.' });
  }
  return next();
}

export function authenticateSocket(socket, next) {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  const token = cookies[SESSION_COOKIE] ?? null;
  const authUser = getUserFromSessionToken(token);
  if (!authUser) {
    return next(new Error('unauthorized'));
  }
  socket.data.authUser = authUser;
  return next();
}

export function createAuthRouter({ onUserAuthenticated }) {
  const router = Router();

  router.get('/api/auth/config', (_req, res) => {
    res.json({
      googleEnabled: Boolean(googleClientId),
      googleClientId: googleClientId || null,
    });
  });

  router.get('/api/me', attachAuth, requireAuth, (req, res) => {
    res.json({ user: req.authUser });
  });

  router.post('/api/auth/google', async (req, res) => {
    if (!oauthClient || !googleClientId) {
      return res.status(500).json({
        error: 'Google sign-in is not configured on the server.',
      });
    }

    const credential = String(req.body?.credential ?? '');
    if (!credential) {
      return res.status(400).json({ error: 'Missing Google credential.' });
    }

    try {
      const ticket = await oauthClient.verifyIdToken({
        idToken: credential,
        audience: googleClientId,
      });
      const payload = ticket.getPayload();
      const user = userFromGooglePayload(payload);
      if (!user) {
        return res.status(401).json({ error: 'Google account could not be verified.' });
      }

      if (onUserAuthenticated) onUserAuthenticated(user);
      const token = issueSession(user);
      setSessionCookie(res, token);
      return res.json({ user });
    } catch (err) {
      return res.status(401).json({
        error: 'Google sign-in failed. Please try again.',
        detail: process.env.NODE_ENV === 'development' ? String(err?.message || err) : undefined,
      });
    }
  });

  router.post('/api/auth/logout', attachAuth, (req, res) => {
    const token = readSessionTokenFromRequest(req);
    deleteSessionFromToken(token);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // Dev-only login path for local testing and automated tests.
  router.post('/api/auth/dev-login', (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ error: 'Not found.' });
    }
    const email = normalizeEmail(req.body?.email);
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Provide a valid email address.' });
    }
    const user = {
      id: email,
      email,
      name: String(req.body?.name || email.split('@')[0]),
      picture: null,
    };
    if (onUserAuthenticated) onUserAuthenticated(user);
    const token = issueSession(user);
    setSessionCookie(res, token);
    return res.json({ user });
  });

  return router;
}
