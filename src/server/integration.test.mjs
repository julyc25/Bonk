import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import { attachAuth, authenticateSocket, createAuthRouter, requireAuth } from './auth.js';
import { createFriendsRouter, upsertUser } from './friends.js';
import { createSnapshotRouter } from './snapshots.js';
import { registerPresence } from './presence.js';
import { registerSignaling } from './signaling.js';

async function startHarness() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });

  app.use(express.json());
  app.use(createAuthRouter({ onUserAuthenticated: upsertUser }));
  app.use('/api', attachAuth, requireAuth);
  app.use(createFriendsRouter());
  app.use(createSnapshotRouter(io));
  registerPresence(io);
  registerSignaling(io);
  io.use(authenticateSocket);

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    io,
    close: async () => {
      await new Promise((resolve) => io.close(resolve));
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
}

function waitForEvent(socket, event, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);

    const onEvent = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };

    socket.once(event, onEvent);
  });
}

async function devLogin(baseUrl, email) {
  const response = await fetch(`${baseUrl}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie, 'Expected session cookie from dev login');
  return cookie.split(';')[0];
}

async function makeFriends(baseUrl, requesterCookie, recipientCookie, requesterId, recipientId) {
  const addResponse = await fetch(`${baseUrl}/api/friends/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: requesterCookie },
    body: JSON.stringify({ email: recipientId }),
  });
  if (addResponse.status !== 201) {
    const body = await addResponse.json();
    assert.equal(addResponse.status, 400);
    assert.equal(body.error, 'You are already friends.');
    return;
  }

  const acceptResponse = await fetch(`${baseUrl}/api/friends/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: recipientCookie },
    body: JSON.stringify({ requestId: requesterId }),
  });
  assert.equal(acceptResponse.status, 200);
}

async function testFriendsEndpoint() {
  const harness = await startHarness();
  try {
    const cookie = await devLogin(harness.baseUrl, 'you@gmail.com');
    const response = await fetch(`${harness.baseUrl}/api/friends`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.self.id, 'you@gmail.com');
    assert.ok(Array.isArray(payload.friends));
    assert.ok(Array.isArray(payload.requests));
  } finally {
    await harness.close();
  }
  console.log('PASS friends endpoint');
}

async function testFriendRequestFlow() {
  const harness = await startHarness();
  const targetId = 'step4_target@gmail.com';
  try {
    const youCookie = await devLogin(harness.baseUrl, 'you@gmail.com');
    const targetCookie = await devLogin(harness.baseUrl, targetId);

    const addResponse = await fetch(`${harness.baseUrl}/api/friends/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: youCookie },
      body: JSON.stringify({ email: targetId }),
    });
    assert.equal(addResponse.status, 201);

    const beforeAccept = await fetch(`${harness.baseUrl}/api/friends`, { headers: { Cookie: targetCookie } });
    assert.equal(beforeAccept.status, 200);
    const beforePayload = await beforeAccept.json();
    assert.equal(beforePayload.requests.some((r) => r.id === 'you@gmail.com'), true);

    const acceptResponse = await fetch(`${harness.baseUrl}/api/friends/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: targetCookie },
      body: JSON.stringify({ requestId: 'you@gmail.com' }),
    });
    assert.equal(acceptResponse.status, 200);
    const acceptPayload = await acceptResponse.json();
    assert.equal(acceptPayload.friends.some((f) => f.id === 'you@gmail.com'), true);
  } finally {
    await harness.close();
  }
  console.log('PASS friend request flow');
}

async function testSignalingRelay() {
  const harness = await startHarness();
  try {
    const youCookie = await devLogin(harness.baseUrl, 'you@gmail.com');
    const emilyCookie = await devLogin(harness.baseUrl, 'emily@gmail.com');
    const michelleCookie = await devLogin(harness.baseUrl, 'michelle@gmail.com');
    await makeFriends(harness.baseUrl, youCookie, emilyCookie, 'you@gmail.com', 'emily@gmail.com');

    const emily = ioClient(harness.baseUrl, { transports: ['websocket'], extraHeaders: { Cookie: emilyCookie } });
    const you = ioClient(harness.baseUrl, { transports: ['websocket'], extraHeaders: { Cookie: youCookie } });
    const michelle = ioClient(harness.baseUrl, { transports: ['websocket'], extraHeaders: { Cookie: michelleCookie } });

    try {
      await Promise.all([waitForEvent(you, 'connect'), waitForEvent(emily, 'connect'), waitForEvent(michelle, 'connect')]);
      you.emit('user:online');
      emily.emit('user:online');
      michelle.emit('user:online');
      await Promise.all([
        waitForEvent(you, 'presence:init'),
        waitForEvent(emily, 'presence:init'),
        waitForEvent(michelle, 'presence:init'),
      ]);

      const friendOffer = waitForEvent(you, 'peer:offer');
      emily.emit('peer:offer', { toId: 'you@gmail.com', sdp: { type: 'offer', sdp: 'ok' } });
      const receivedFriendOffer = await friendOffer;
      assert.equal(receivedFriendOffer.fromId, 'emily@gmail.com');

      const friendBonk = waitForEvent(you, 'peer:bonk');
      emily.emit('peer:bonk', { toId: 'you@gmail.com' });
      const receivedFriendBonk = await friendBonk;
      assert.equal(receivedFriendBonk.fromId, 'emily@gmail.com');

      let blocked = false;
      try {
        await Promise.race([
          waitForEvent(michelle, 'peer:offer', 500),
          (async () => {
            you.emit('peer:offer', { toId: 'michelle@gmail.com', sdp: { type: 'offer', sdp: 'blocked' } });
            await new Promise((resolve) => setTimeout(resolve, 550));
            return null;
          })(),
        ]);
      } catch {
        blocked = true;
      }
      assert.equal(blocked, true);

      let bonkBlocked = false;
      try {
        await Promise.race([
          waitForEvent(michelle, 'peer:bonk', 500),
          (async () => {
            you.emit('peer:bonk', { toId: 'michelle@gmail.com' });
            await new Promise((resolve) => setTimeout(resolve, 550));
            return null;
          })(),
        ]);
      } catch {
        bonkBlocked = true;
      }
      assert.equal(bonkBlocked, true);
    } finally {
      you.disconnect();
      emily.disconnect();
      michelle.disconnect();
    }
  } finally {
    await harness.close();
  }
  console.log('PASS signaling relay');
}

async function testSnapshotPipeline() {
  const harness = await startHarness();
  try {
    const youCookie = await devLogin(harness.baseUrl, 'you@gmail.com');
    const emilyCookie = await devLogin(harness.baseUrl, 'emily@gmail.com');
    await makeFriends(harness.baseUrl, youCookie, emilyCookie, 'you@gmail.com', 'emily@gmail.com');

    const you = ioClient(harness.baseUrl, { transports: ['websocket'], extraHeaders: { Cookie: youCookie } });
    const emily = ioClient(harness.baseUrl, { transports: ['websocket'], extraHeaders: { Cookie: emilyCookie } });

    try {
      await Promise.all([waitForEvent(you, 'connect'), waitForEvent(emily, 'connect')]);
      you.emit('user:online');
      emily.emit('user:online');
      await Promise.all([waitForEvent(you, 'presence:init'), waitForEvent(emily, 'presence:init')]);

      const badForm = new FormData();
      badForm.append('frame', new Blob(['not image'], { type: 'text/plain' }), 'bad.txt');
      const badResponse = await fetch(`${harness.baseUrl}/api/snapshot`, {
        method: 'POST',
        body: badForm,
        headers: { Cookie: youCookie },
      });
      assert.equal(badResponse.status, 415);

      const updatePromise = waitForEvent(emily, 'snapshot:update');
      const goodForm = new FormData();
      goodForm.append('frame', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'frame.jpg');
      const goodResponse = await fetch(`${harness.baseUrl}/api/snapshot`, {
        method: 'POST',
        body: goodForm,
        headers: { Cookie: youCookie },
      });
      assert.equal(goodResponse.status, 200);

      const snapshotEvent = await updatePromise;
      assert.equal(snapshotEvent.userId, 'you@gmail.com');
    } finally {
      you.disconnect();
      emily.disconnect();
    }
  } finally {
    await harness.close();
  }
  console.log('PASS snapshot pipeline');
}

async function main() {
  await testFriendsEndpoint();
  await testFriendRequestFlow();
  await testSignalingRelay();
  await testSnapshotPipeline();
  console.log('ALL_SERVER_TESTS_PASS');
}

main().catch((err) => {
  console.error('SERVER_TESTS_FAILED');
  console.error(err?.stack || err);
  process.exit(1);
});
