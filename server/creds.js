// "Continue with Roblox" (OAuth 2.0 + PKCE) and picking the right credentials for a game.
import { createHash } from 'node:crypto';
import * as db from './store.js';
import { decrypt, encrypt, random } from './auth.js';

const OAUTH = 'https://apis.roblox.com/oauth/v1';

// Everything Update Day calls on Roblox. DataStores aren't offered to OAuth apps, so the game script handles those.
export const SCOPES = [
  'openid', 'profile', 'legacy-universe:manage', 'universe:write', 'universe.place:write',
  'game-pass:read', 'game-pass:write', 'developer-product:read', 'developer-product:write',
  'universe.event:read', 'universe.event:write', 'universe-messaging-service:publish',
];

const fail = (status, message) => Object.assign(new Error(message), { status });

export function origin(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || (process.env.VERCEL ? 'https' : 'http')).split(',')[0];
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

// Roblox only redirects to URLs registered on the app, so a spoofed Host header can't steal a code.
export const redirectUri = (req) => `${origin(req)}/api/oauth/callback`;

export function authorizeUrl(req) {
  const state = random(16);
  const verifier = random(48);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const q = new URLSearchParams({
    client_id: process.env.ROBLOX_CLIENT_ID, redirect_uri: redirectUri(req), scope: SCOPES.join(' '),
    response_type: 'code', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'consent',
  });
  return { url: `${OAUTH}/authorize?${q}`, state, verifier };
}

async function tokenCall(path, params) {
  const r = await fetch(`${OAUTH}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: process.env.ROBLOX_CLIENT_ID, client_secret: process.env.ROBLOX_CLIENT_SECRET }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw fail(r.status === 400 || r.status === 401 ? 401 : 502, `Roblox sign-in failed: ${data.error_description || data.error || r.status}`);
  return data;
}

// Universe ids the token may touch. "U" means every universe owned by the user themself.
async function grantedUniverses(accessToken) {
  const r = await tokenCall('token/resources', { token: accessToken });
  const ids = new Set();
  for (const info of r.resource_infos || []) for (const id of info.resources?.universe?.ids || []) ids.add(String(id));
  return [...ids];
}

// Code -> tokens -> who signed in and which games they picked on Roblox's consent screen.
export async function finishLogin(req, code, verifier) {
  const t = await tokenCall('token', { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri(req) });
  const me = await fetch(`${OAUTH}/userinfo`, { headers: { authorization: `Bearer ${t.access_token}` } }).then((r) => r.json());
  if (!me.sub) throw fail(502, 'Roblox did not say who signed in.');
  const user = {
    uid: String(me.sub), name: me.preferred_username || me.name, displayName: me.nickname || me.name, picture: me.picture || null,
    access: encrypt(t.access_token), accessExp: Date.now() + (t.expires_in || 900) * 1000,
    refresh: encrypt(t.refresh_token), refreshedAt: Date.now(), universes: await grantedUniverses(t.access_token),
  };
  await db.set(`user:${user.uid}`, user);
  return user;
}

// Refresh tokens are single use, so only one request at a time may swap them.
export async function accessToken(uid) {
  for (let i = 0; i < 8; i++) {
    const u = await db.get(`user:${uid}`);
    if (!u?.refresh) throw fail(400, 'Sign in with Roblox again.');
    if (u.accessExp - 60000 > Date.now()) return decrypt(u.access);
    if (await db.lock(`lock:refresh:${uid}`, 20)) {
      try {
        const fresh = await db.get(`user:${uid}`);
        if (fresh.accessExp - 60000 > Date.now()) return decrypt(fresh.access);
        const t = await tokenCall('token', { grant_type: 'refresh_token', refresh_token: decrypt(fresh.refresh) }).catch(async (e) => {
          await db.set(`user:${uid}`, { ...fresh, refresh: null }); // dead token: make the UI ask to reconnect
          throw fail(400, `${fresh.name}'s Roblox connection expired. Sign in with Roblox again.`);
        });
        await db.set(`user:${uid}`, {
          ...fresh, access: encrypt(t.access_token), accessExp: Date.now() + (t.expires_in || 900) * 1000,
          refresh: encrypt(t.refresh_token), refreshedAt: Date.now(),
        });
        return t.access_token;
      } finally {
        await db.del(`lock:refresh:${uid}`);
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw fail(503, 'Roblox sign-in is busy, try again.');
}

const canUse = (u, cfg) => u?.refresh && (u.universes.includes(cfg.universeId) || (u.universes.includes('U') && cfg.creatorType === 'User' && cfg.creatorId === u.uid));

// Headers for Open Cloud calls on this game: its API key if it has one, else any member's Roblox sign-in.
export async function authFor(cfg) {
  if (cfg.apiKey) return { 'x-api-key': decrypt(cfg.apiKey) };
  let last;
  for (const uid of cfg.members || []) {
    const u = await db.get(`user:${uid}`);
    if (!canUse(u, cfg)) continue;
    try { return { authorization: `Bearer ${await accessToken(uid)}` }; } catch (e) { last = e; }
  }
  throw last || fail(400, 'This game is not connected. Open Settings and connect it with Roblox or an API key.');
}

// Keep sign-ins alive: refresh tokens die after 90 days unused.
export async function keepAlive(uids) {
  for (const uid of uids) {
    const u = await db.get(`user:${uid}`);
    if (u?.refresh && Date.now() - u.refreshedAt > 20 * 86400000) {
      await db.set(`user:${uid}`, { ...u, accessExp: 0 });
      await accessToken(uid).catch(() => {});
    }
  }
}
