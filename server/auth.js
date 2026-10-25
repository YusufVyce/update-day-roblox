// Login, sessions and secrets. APP_SECRET signs cookies and encrypts tokens and API keys.
// Two ways in: "Continue with Roblox" (ROBLOX_CLIENT_ID/SECRET) and/or a password (ADMIN_PASSWORD).
import { createHmac, createHash, timingSafeEqual, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const secret = process.env.APP_SECRET || '';
const password = process.env.ADMIN_PASSWORD || '';
export const passwordLogin = password.length >= 8;
export const oauthReady = Boolean(process.env.ROBLOX_CLIENT_ID && process.env.ROBLOX_CLIENT_SECRET);
export const authReady = secret.length >= 16 && (passwordLogin || oauthReady);

// Optional allow-list of Roblox user ids or usernames. Empty = any Roblox user may sign in and manage their own games.
const allowed = (process.env.ALLOWED_USERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export const isAllowed = (id, name) => !allowed.length || allowed.includes(String(id)) || allowed.includes(String(name).toLowerCase());

const COOKIE = 'ud_session';
const DAYS = 30;
const secure = process.env.VERCEL ? '; Secure' : '';
export const sign = (s) => createHmac('sha256', secret).update(s).digest('base64url');
const sha = (s) => createHash('sha256').update(String(s)).digest();
export const random = (n = 32) => randomBytes(n).toString('base64url');

export function safeEqual(a, b) {
  return timingSafeEqual(sha(a), sha(b));
}

export const checkPassword = (input) => passwordLogin && safeEqual(input, password);

// uid is a Roblox user id, or "admin" for the password login.
export function sessionCookie(uid) {
  const v = `${uid}.${Date.now() + DAYS * 86400000}`;
  return `${COOKIE}=${v}.${sign(v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${secure}`;
}

export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function cookie(req, name) {
  return (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='))?.slice(name.length + 1) || null;
}

// Returns the signed-in uid or null.
export function sessionUser(req) {
  if (!authReady) return null;
  const m = /^(admin|\d{1,20})\.(\d+)\.([\w-]+)$/.exec(cookie(req, COOKIE) || '');
  if (!m || +m[2] < Date.now() || !safeEqual(sign(`${m[1]}.${m[2]}`), m[3])) return null;
  if (m[1] === 'admin' && !passwordLogin) return null;
  return m[1];
}

// Short-lived cookie that carries the OAuth state and PKCE verifier across the Roblox redirect.
export function oauthCookie(state, verifier) {
  const v = `${state}.${verifier}`;
  return `ud_oauth=${v}.${sign(v)}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=600${secure}`;
}

export function readOauthCookie(req) {
  const m = /^([\w-]+)\.([\w-]+)\.([\w-]+)$/.exec(cookie(req, 'ud_oauth') || '');
  if (!m || !safeEqual(sign(`${m[1]}.${m[2]}`), m[3])) return null;
  return { state: m[1], verifier: m[2] };
}

// Vercel Cron and cron-job.org send "Authorization: Bearer <CRON_SECRET>".
export function isCron(req) {
  const s = process.env.CRON_SECRET;
  return Boolean(s) && safeEqual(req.headers.authorization || '', `Bearer ${s}`);
}

const encKey = () => createHash('sha256').update('api-key:' + secret).digest();

export function encrypt(text) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', encKey(), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(box) {
  const [iv, tag, data] = String(box).split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}
