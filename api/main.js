// Every /api/* request lands here (see vercel.json) and is routed by path.
import * as db from '../server/store.js';
import * as rbx from '../server/roblox.js';
import * as discord from '../server/discord.js';
import {
  authReady, oauthReady, passwordLogin, isAllowed, checkPassword, sessionCookie, clearCookie, sessionUser,
  oauthCookie, readOauthCookie, cookie, isCron, encrypt, decrypt, random, safeEqual,
} from '../server/auth.js';
import { authorizeUrl, finishLogin, authFor, origin, redirectUri, SCOPES } from '../server/creds.js';
import { tick, log, prices } from '../server/tick.js';
import { gameScript } from '../server/script.js';
import { parsePlaceId, salePrice, downsample, STEPS } from '../lib.js';

const fail = (status, message) => Object.assign(new Error(message), { status });

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

function redirect(res, to, cookies = []) {
  res.statusCode = 302;
  res.setHeader('location', to);
  if (cookies.length) res.setHeader('set-cookie', cookies);
  res.end();
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let s = '';
  for await (const chunk of req) {
    s += chunk;
    if (s.length > 3e6) throw fail(413, 'Request too large.');
  }
  try { return s ? JSON.parse(s) : {}; } catch { throw fail(400, 'Bad JSON.'); }
}

/* ---------- validation ---------- */

const str = (v, max, name) => {
  if (typeof v !== 'string' || !v.trim()) throw fail(400, `${name} is required.`);
  if (v.length > max) throw fail(400, `${name} is too long (max ${max}).`);
  return v.trim();
};
const optStr = (v, max, name) => (v == null || v === '' ? '' : str(v, max, name));
const int = (v, min, max, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw fail(400, `${name} must be a whole number from ${min} to ${max}.`);
  return n;
};
const time = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < Date.parse('2020-01-01') || n > Date.parse('2100-01-01')) throw fail(400, `${name} is not a valid time.`);
  return n;
};
const zone = (v) => {
  try { new Intl.DateTimeFormat('en', { timeZone: v }); return v; } catch { throw fail(400, 'Unknown time zone.'); }
};
const stepKeys = (v) => STEPS.map((s) => s.key).filter((k) => Array.isArray(v) && v.includes(k));
const id = () => Math.random().toString(36).slice(2, 10);

/* ---------- games ---------- */

const canSee = (cfg, uid) => uid === 'admin' || cfg.members.includes(uid);

async function loadGame(u, uid) {
  if (!/^\d{1,20}$/.test(String(u))) throw fail(400, 'Bad game id.');
  const cfg = await db.get(`game:${u}`);
  if (!cfg || !canSee(cfg, uid)) throw fail(404, 'That game is not in your list.');
  return cfg;
}

const save = (cfg) => db.set(`game:${cfg.universeId}`, cfg);

async function view(cfg) {
  const { apiKey, feedToken, autopilot, ...rest } = cfg;
  const { discordUrl, ...ap } = autopilot;
  let connected = Boolean(apiKey);
  if (!connected) {
    const users = await Promise.all(cfg.members.map((m) => db.get(`user:${m}`)));
    connected = users.some((u) => u?.refresh && (u.universes.includes(cfg.universeId) || u.universes.includes('U')));
  }
  return { ...rest, autopilot: { ...ap, hasDiscord: Boolean(discordUrl) }, hasKey: Boolean(apiKey), connected };
}

async function addGame(u, uid, extra = {}) {
  const existing = await db.get(`game:${u}`);
  if (existing) {
    if (!existing.members.includes(uid) && uid !== 'admin') existing.members.push(uid);
    Object.assign(existing, extra);
    await save(existing);
    return existing;
  }
  const g = await rbx.publicGame(u);
  const cfg = {
    universeId: u, placeId: g.placeId, name: g.name, icon: g.icon, creator: g.creator, creatorType: g.creatorType, creatorId: g.creatorId,
    groupId: g.creatorType === 'Group' ? g.creatorId : null, language: g.language, members: uid === 'admin' ? [] : [uid],
    apiKey: null, feedToken: random(24), addedAt: Date.now(), timezone: 'UTC',
    countdown: { target: null, steps: STEPS.map((s) => s.key), active: false, icons: true, applied: null, saved: [] },
    autopilot: {
      titleTag: '', titleDays: 3, restart: false, bleedMinutes: 0, discordUrl: null, discordSteps: ['h24', 'h1', 'now'], mention: '',
      discordBefore: '⏰ **{game}** update in **{time}**!', discordLive: '🚀 **{game}** update is LIVE! {link}', state: freshState(),
    },
    sales: [], timers: [], log: [], catalog: '', tiers: 'Normal', dataKeys: {},
    adminHour: { day: 6, time: '18:00', minutes: 60 },
    ...extra,
  };
  log(cfg, 'Game connected');
  await save(cfg);
  await db.set('games', [...new Set([...((await db.get('games')) || []), u])]);
  return cfg;
}

const freshState = () => ({ titleSet: false, titleOriginal: null, titleTagged: null, titleRestored: false, restarted: false, sent: [] });

async function myGames(uid) {
  const all = await Promise.all(((await db.get('games')) || []).map((u) => db.get(`game:${u}`)));
  return all.filter((g) => g && canSee(g, uid));
}

// Universes the user picked on Roblox's consent screen, plus their own public games when they granted "all my games".
async function syncGrants(user) {
  const ids = user.universes.filter((x) => x !== 'U');
  if (user.universes.includes('U')) {
    const r = await rbx.request(`https://games.roblox.com/v2/users/${user.uid}/games?limit=50&sortOrder=Desc`).catch(() => ({ data: [] }));
    ids.push(...(r.data || []).map((g) => String(g.id)));
  }
  for (const u of new Set(ids)) await addGame(u, user.uid).catch(() => {});
}

/* ---------- routes ---------- */

const routes = {
  'GET session': async (req, res, b, q, uid) => {
    const user = uid && uid !== 'admin' ? await db.get(`user:${uid}`) : null;
    return {
      authed: Boolean(uid),
      authReady, oauthReady, passwordLogin,
      storeReady: db.storeReady,
      cronReady: Boolean(process.env.CRON_SECRET),
      lastCron: uid ? await db.get('tick:last') : null,
      user: uid === 'admin' ? { uid, name: 'Admin', displayName: 'Admin' }
        : user && { uid, name: user.name, displayName: user.displayName, picture: user.picture, connected: Boolean(user.refresh) },
      redirectUri: redirectUri(req),
      scopes: SCOPES.join(' '),
    };
  },

  'POST login': async (req, res, b) => {
    if (!passwordLogin) throw fail(400, 'Password login is off. Use Continue with Roblox.');
    const ip = String(req.headers['x-forwarded-for'] || 'local').split(',')[0].trim();
    if ((await db.hit(`login:${ip}`, 900)) > 10) throw fail(429, 'Too many tries. Wait 15 minutes.');
    if (!checkPassword(String(b.password || ''))) throw fail(401, 'Wrong password.');
    res.setHeader('set-cookie', sessionCookie('admin'));
    return { ok: true };
  },

  'POST logout': async (req, res) => {
    res.setHeader('set-cookie', clearCookie);
    return { ok: true };
  },

  'GET oauth/start': async (req, res, b, q) => {
    if (!oauthReady) throw fail(400, 'Roblox sign-in is not set up on this site (see README).');
    const { url, state, verifier } = authorizeUrl(req);
    const tz = q.get('tz') || '';
    redirect(res, url, [oauthCookie(state, verifier), `ud_tz=${encodeURIComponent(tz)}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=600`]);
  },

  'GET oauth/callback': async (req, res, b, q) => {
    const back = (msg) => redirect(res, `/#error=${encodeURIComponent(msg)}`, ['ud_oauth=; Path=/api; Max-Age=0']);
    if (q.get('error')) return back(q.get('error_description') || 'Roblox sign-in was cancelled.');
    const saved = readOauthCookie(req);
    if (!saved || !safeEqual(saved.state, q.get('state') || '')) return back('Sign-in expired, try again.');
    const user = await finishLogin(req, str(q.get('code'), 2000, 'code'), saved.verifier);
    if (!isAllowed(user.uid, user.name)) return back(`@${user.name} is not allowed on this site.`);
    await syncGrants(user);
    // Games created by this sign-in get the time zone of the browser that started it.
    const tz = decodeURIComponent(cookie(req, 'ud_tz') || '');
    if (tz) {
      for (const g of await myGames(user.uid)) {
        if (g.timezone === 'UTC' && Date.now() - g.addedAt < 60000) await save({ ...g, timezone: zone(tz) });
      }
    }
    redirect(res, '/#/', [sessionCookie(user.uid), 'ud_oauth=; Path=/api; Max-Age=0']);
  },

  'GET games': async (req, res, b, q, uid) => Promise.all((await myGames(uid)).map(view)),

  // Add by link. Works if the user's Roblox sign-in covers the game, or with an API key.
  'POST games/add': async (req, res, b, q, uid) => {
    const placeId = parsePlaceId(b.link);
    if (!placeId) throw fail(400, 'Paste a roblox.com/games/... link or a place ID.');
    const u = await rbx.universeOf(placeId);
    const extra = { timezone: zone(b.timezone || 'UTC') };
    if (b.apiKey) {
      const key = str(b.apiKey, 2000, 'API key');
      await rbx.universeInfo({ 'x-api-key': key }, u);
      extra.apiKey = encrypt(key);
    } else {
      const user = uid !== 'admin' && (await db.get(`user:${uid}`));
      if (!user?.universes?.includes(u) && !(user?.universes?.includes('U'))) {
        throw fail(403, 'Your Roblox sign-in does not include this game. Press "Connect with Roblox" and pick it, or use an API key.');
      }
    }
    return view(await addGame(u, uid, extra));
  },

  'POST games/remove': async (req, res, b, q, uid) => {
    const cfg = await loadGame(b.u, uid);
    cfg.members = cfg.members.filter((m) => m !== uid);
    if (cfg.members.length && uid !== 'admin') return save(cfg).then(() => ({ ok: true }));
    await db.set('games', ((await db.get('games')) || []).filter((x) => x !== cfg.universeId));
    await Promise.all([...STEPS.map((s) => s.key), 'base'].map((k) => db.del(`icon:${cfg.universeId}:${k}`)));
    await db.del(`game:${cfg.universeId}`);
    return { ok: true };
  },

  'GET game': async (req, res, b, q, uid) => {
    if (q.get('u')) return rbx.publicGame((await loadGame(q.get('u'), uid)).universeId);
    const placeId = parsePlaceId(q.get('link'));
    if (!placeId) throw fail(400, 'Paste a roblox.com/games/... link or a place ID.');
    return rbx.publicGame(await rbx.universeOf(placeId));
  },

  'GET stats': async (req, res, b, q, uid) => {
    const cfg = await loadGame(q.get('u'), uid);
    const days = int(q.get('days') || 1, 1, 30, 'Days');
    const from = Date.now() - days * 86400000;
    const keys = [];
    for (let t = from; t <= Date.now() + 86400000; t += 86400000) keys.push(`stats:${cfg.universeId}:${new Date(t).toISOString().slice(0, 10)}`);
    const all = (await Promise.all([...new Set(keys)].map(db.range))).flat().filter((s) => s[0] >= from).sort((a, c) => a[0] - c[0]);
    return downsample(all, 600);
  },

  'POST settings': async (req, res, b, q, uid) => {
    const cfg = await loadGame(b.u, uid);
    if ('timezone' in b) cfg.timezone = zone(b.timezone);
    if ('language' in b) cfg.language = str(b.language, 10, 'Language');
    if ('catalog' in b) cfg.catalog = optStr(b.catalog, 20000, 'Gift list');
    if ('tiers' in b) cfg.tiers = optStr(b.tiers, 500, 'Tiers');
    if ('adminHour' in b) {
      cfg.adminHour = {
        day: int(b.adminHour.day, 0, 6, 'Day'),
        time: /^\d{2}:\d{2}$/.test(b.adminHour.time) ? b.adminHour.time : '18:00',
        minutes: int(b.adminHour.minutes, 5, 1440, 'Length'),
      };
    }
    if ('apiKey' in b) {
      if (b.apiKey) {
        const key = str(b.apiKey, 2000, 'API key');
        await rbx.universeInfo({ 'x-api-key': key }, cfg.universeId);
        cfg.apiKey = encrypt(key);
        log(cfg, 'API key added');
      } else {
        cfg.apiKey = null;
        log(cfg, 'API key removed');
      }
    }
    if (b.newFeedToken) cfg.feedToken = random(24);
    if (b.refresh) {
      const g = await rbx.publicGame(cfg.universeId);
      Object.assign(cfg, { name: g.name, icon: g.icon, creator: g.creator });
    }
    await save(cfg);
    return view(cfg);
  },

  'POST autopilot': async (req, res, b, q, uid) => {
    const cfg = await loadGame(b.u, uid);
    const ap = cfg.autopilot;
    if ('titleTag' in b) ap.titleTag = optStr(b.titleTag, 25, 'Title tag');
    if ('titleDays' in b) ap.titleDays = int(b.titleDays, 1, 30, 'Days');
    if ('restart' in b) ap.restart = Boolean(b.restart);
    if ('bleedMinutes' in b) ap.bleedMinutes = int(b.bleedMinutes, 0, 60, 'Minutes');
    if ('discordSteps' in b) ap.discordSteps = stepKeys(b.discordSteps);
    if ('mention' in b) ap.mention = ['', '@everyone', '@here'].includes(b.mention) ? b.mention : '';
    if ('discordBefore' in b) ap.discordBefore = str(b.discordBefore, 300, 'Message');
    if ('discordLive' in b) ap.discordLive = str(b.discordLive, 300, 'Message');
    if ('discordUrl' in b) {
      if (b.discordUrl && !discord.validWebhook(b.discordUrl)) throw fail(400, 'That is not a Discord webhook URL.');
      ap.discordUrl = b.discordUrl ? encrypt(b.discordUrl) : null;
    }
    await save(cfg);
    return view(cfg);
  },

  'POST discord/test': async (req, res, b, q, uid) => {
    const cfg = await loadGame(b.u, uid);
    if (!cfg.autopilot.discordUrl) throw fail(400, 'Add a webhook URL first.');
    await discord.post(decrypt(cfg.autopilot.discordUrl), {
      content: `✅ Update Day is connected. Announcements for **${cfg.name}** will appear here.`, title: cfg.name, link: `https://www.roblox.com/games/${cfg.placeId}`,
    }).catch((e) => { throw fail(400, e.message); });
    return { ok: true };
  },

  'POST countdown': async (req, res, b, q, uid) => {
    const cfg = await loadGame(b.u, uid);
    const cd = cfg.countdown;
    if ('target' in b) {
      const target = b.target == null ? null : time(b.target, 'Update time');
      if (target !== cd.target) {
        Object.assign(cd, { applied: null, appliedAt: null, error: null });
        cfg.autopilot.state = freshState();
      }
      cd.target = target;
    }
    if (Array.isArray(b.steps)) cd.steps = stepKeys(b.steps);
    if ('icons' in b) cd.icons = Boolean(b.icons);
    if ('active' in b) {
      if (b.active && !cd.target) throw fail(400, 'Pick the update time first.');
      // "back" reuses the base icon, so it has no image of its own.
      const need = [...cd.steps.filter((k) => k !== 'back'), 'base'];
      if (b.active && cd.icons && !need.every((k) => cd.saved.includes(k))) throw fail(400, 'Save the icons first.');
      cd.active = Boolean(b.active);
      log(cfg, cd.active ? 'Countdown started' : 'Countdown stopped');
    }
    await save(cfg);
    return view(cfg);
  },

  // One generated icon (JPEG, base64) per request to stay far below the 4.5 MB body limit.
  'POST icon': async (req, res, b, q, uid) => {
    const cfg = await loadGame(b.u, uid);
    const step = b.step === 'base' ? 'base' : STEPS.find((s) => s.key === b.step)?.key;
    if (!step) throw fail(400, 'Unknown step.');
    if (typeof b.data !== 'string' || !b.data.startsWith('/9j/') || b.data.length > 1_500_000) throw fail(400, 'Icon must be a JPEG under 1 MB.');
    await db.set(`icon:${cfg.universeId}:${step}`, b.data);
    // Re-read so parallel uploads of the other steps don't overwrite each other's "saved" mark.
    const fresh = await loadGame(b.u, uid);
    fresh.countdown.saved = [...new Set([...fresh.countdown.saved, step])];
    await save(fresh);
    return { ok: true };
  },

  'GET icon': async (req, res, b, q, uid) => {
    const cfg = await loadGame(q.get('u'), uid);
    const data = await db.get(`icon:${cfg.universeId}:${q.get('step')}`);
    if (!data) throw fail(404, 'No icon saved.');
    return { data };
  },

  // The live Roblox icon as base64, so the browser can draw on it (rbxcdn sends no CORS headers).
  'GET baseicon': async (req, res, b, q, uid) => {
    const cfg = await loadGame(q.get('u'), uid);
    const g = await rbx.publicGame(cfg.universeId);
    if (!g.icon || !new URL(g.icon).hostname.endsWith('.rbxcdn.com')) throw fail(404, 'This game has no icon yet.');
    const r = await fetch(g.icon);
    if (!r.ok) throw fail(502, 'Could not download the icon.');
    return { data: Buffer.from(await r.arrayBuffer()).toString('base64'), type: r.headers.get('content-type') || 'image/png' };
  },

  'POST restart': async (req, res, b, q, uid) => {
    const cfg = await loadGame(b.u, uid);
    await rbx.restartServers(await authFor(cfg), cfg.universeId, int(b.bleedMinutes || 0, 0, 60, 'Minutes'));
    log(cfg, 'Servers restarted by hand');
    await save(cfg);
    return { ok: true };
  },

  'POST tick': () => tick(),

  'GET events': async (req, res, b, q, uid) => {
    const cfg = await loadGame(q.get('u'), uid);
    return rbx.listEvents(await authFor(cfg), cfg.universeId);
  },

  'POST events/create': async (req, res, b, q, uid) => {
    const cfg = await loadGame(b.u, uid);
    const start = time(b.start, 'Start');
    const end = time(b.end, 'End');
    if (end <= start) throw fail(400, 'End must be after the start.');
    const g = await rbx.publicGame(cfg.universeId);
    const body = {
      title: str(b.title, 50, 'Title'),
      subtitle: str(b.subtitle, 50, 'Subtitle'),
      description: optStr(b.description, 1000, 'Description') || undefined,
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
      visibility: 'public',
      categories: [{ category: str(b.category, 30, 'Category'), rank: 1 }],
      ...(cfg.groupId && { groupId: Number(cfg.groupId) }),
      ...(g.firstImageId && { thumbnails: [{ mediaId: g.firstImageId, rank: 1 }] }),
    };
    const ev = await rbx.createEvent(await authFor(cfg), cfg.universeId, body);
    log(cfg, `Event created: ${body.title}`);
    await save(cfg);
    return ev;
  },

  'POST events/delete': async (req, res, b, q, uid) => {
    const cfg = await loadGame(b.u, uid);
    if (!/^\d{1,30}$/.test(String(b.id))) throw fail(400, 'Bad event id.');
    await rbx.deleteEvent(await authFor(cfg), b.id);
    log(cfg, 'Event deleted');
    await save(cfg);
    return { ok: true };
  },

  'GET items': async (req, res, b, q, uid) => {
    const cfg = await loadGame(q.get('u'), uid);
    return rbx.listItems(await authFor(cfg), cfg.universeId);
  },

  'POST sales/create': async (req, res, b, q, uid) => {
    const cfg = await loadGame(b.u, uid);
    const pct = int(b.pct, 1, 95, 'Discount');
    const start = time(b.start, 'Start');
    const end = time(b.end, 'End');
    if (end <= start) throw fail(400, 'End must be after the start.');
    if (end <= Date.now()) throw fail(400, 'That sale would already be over.');
    if (!Array.isArray(b.items) || !b.items.length) throw fail(400, 'Pick the items that go on sale.');
    // Prices come from Roblox, not the browser, so the restore price is the real one.
    const live = await rbx.listItems(await authFor(cfg), cfg.universeId);
    const items = b.items.map((x) => {
      const it = live.find((l) => l.kind === x.kind && l.id === String(x.id));
      if (!it) throw fail(400, 'One of the picked items no longer exists.');
      return { ...it, salePrice: salePrice(it.price, pct) };
    });
    const clash = cfg.sales.find((s) => ['planned', 'live'].includes(s.status) && s.start < end && start < s.end
      && s.items.some((i) => items.some((j) => j.kind === i.kind && j.id === i.id)));
    if (clash) throw fail(409, 'Some of these items are already in a sale at that time.');
    const sale = { id: id(), pct, start, end, items, status: 'planned', errors: [], createdAt: Date.now() };
    cfg.sales = [sale, ...cfg.sales].slice(0, 50);
    log(cfg, `Sale planned: ${pct}% off ${items.length} items`);
    await save(cfg);
    return view(cfg);
  },

  'POST sales/cancel': async (req, res, b, q, uid) => {
    const cfg = await loadGame(b.u, uid);
    const sale = cfg.sales.find((s) => s.id === b.id);
    if (!sale) throw fail(404, 'Sale not found.');
    if (sale.status === 'live') await prices(cfg, await authFor(cfg), sale, false);
    sale.status = 'cancelled';
    log(cfg, `Sale cancelled${sale.errors.length ? ' (some prices failed to restore)' : ''}`, !sale.errors.length);
    await save(cfg);
    return view(cfg);
  },

  'GET player': async (req, res, b, q, uid) => {
    const cfg = await loadGame(q.get('u'), uid);
    const user = await rbx.findUser(str(q.get('name'), 20, 'Username'));
    return { user, gifts: await db.range(`gifts:${cfg.universeId}:${user.id}`) };
  },

  'POST gift': async (req, res, b, q, uid) => {
    const cfg = await loadGame(b.u, uid);
    const userId = String(b.userId);
    if (!/^\d{1,20}$/.test(userId)) throw fail(400, 'Look up a player first.');
    const gift = {
      id: id(), type: str(b.type, 40, 'Gift type'), item: str(b.item, 80, 'Gift'),
      tier: optStr(b.tier, 40, 'Tier'), amount: int(b.amount, 1, 50, 'How many'), sentAt: Date.now(),
    };
    await db.push(`gifts:${cfg.universeId}:${userId}`, gift, 90 * 86400);
    // Online players get it now; the rest when they join.
    await authFor(cfg).then((a) => rbx.publish(a, cfg.universeId, 'UpdateDay', JSON.stringify({ type: 'gift', userId }))).catch(() => {});
    log(cfg, `Gift sent: ${gift.amount}x ${gift.item} to ${userId}`);
    await save(cfg);
    return gift;
  },

  // Player data goes through a running game server: it finds the DataStores and the player's keys by itself,
  // so nobody types store names and no DataStore API key is needed. The site only queues the job.
  'POST data/read': async (req, res, b, q, uid) => {
    const cfg = await loadGame(b.u, uid);
    const userId = String(b.userId);
    if (!/^\d{1,20}$/.test(userId)) throw fail(400, 'Look up a player first.');
    return startJob(cfg, { kind: 'read', userId, known: b.rescan ? {} : cfg.dataKeys || {} });
  },

  'POST data/save': async (req, res, b, q, uid) => {
    const cfg = await loadGame(b.u, uid);
    const userId = String(b.userId);
    if (!/^\d{1,20}$/.test(userId)) throw fail(400, 'Look up a player first.');
    if (JSON.stringify(b.value ?? null).length > 1_000_000) throw fail(400, 'Data is too large (1 MB max).');
    const job = await startJob(cfg, { kind: 'write', userId, store: str(b.store, 50, 'DataStore'), key: str(b.key, 50, 'Key'), value: b.value ?? null });
    log(cfg, `Player data save sent for ${userId} (${b.store})`);
    await save(cfg);
    return job;
  },

  'GET data/result': async (req, res, b, q, uid) => {
    const cfg = await loadGame(q.get('u'), uid);
    const job = await db.get(`job:${String(q.get('id')).replace(/[^\w-]/g, '')}`);
    if (!job || job.u !== cfg.universeId) throw fail(404, 'That request expired. Try again.');
    return { status: job.status, result: job.result ?? null };
  },

  'POST timers': async (req, res, b, q, uid) => {
    const cfg = await loadGame(b.u, uid);
    if (!Array.isArray(b.timers) || b.timers.length > 30) throw fail(400, 'Up to 30 timers.');
    const timers = b.timers.map((t) => ({ name: str(t.name, 40, 'Timer name'), endsAt: time(t.endsAt, 'Timer end') }));
    if (new Set(timers.map((t) => t.name)).size !== timers.length) throw fail(400, 'Timer names must be unique.');
    cfg.timers = timers;
    await authFor(cfg).then((a) => rbx.publish(a, cfg.universeId, 'UpdateDay', JSON.stringify({ type: 'timers' }))).catch(() => {});
    log(cfg, `Timers published (${timers.length})`);
    await save(cfg);
    return view(cfg);
  },

  'GET script': async (req, res, b, q, uid) => {
    const cfg = await loadGame(q.get('u'), uid);
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="UpdateDay.server.luau"');
    res.setHeader('cache-control', 'no-store');
    res.end(gameScript(origin(req), cfg.universeId, cfg.feedToken));
  },

  /* ---------- called by game servers (feed token, no login) ---------- */

  'GET feed': async (req, res, b, q) => {
    const cfg = await feedGame(req, q.get('u'));
    return { timers: Object.fromEntries(cfg.timers.map((t) => [t.name, Math.floor(t.endsAt / 1000)])), now: Math.floor(Date.now() / 1000) };
  },

  'POST feed/claim': async (req, res, b) => {
    const cfg = await feedGame(req, b.u);
    if (!/^\d{1,20}$/.test(String(b.userId))) throw fail(400, 'Bad user id.');
    const gifts = (await db.take(`gifts:${cfg.universeId}:${b.userId}`)) || [];
    if (gifts.length) {
      const fresh = await db.get(`game:${cfg.universeId}`);
      log(fresh, `${gifts.length} gift${gifts.length > 1 ? 's' : ''} delivered to ${b.userId}`);
      await save(fresh);
    }
    return gifts;
  },

  // The game server that won the claim (in MemoryStore, in-game) fetches the job here...
  'GET feed/job': async (req, res, b, q) => {
    const cfg = await feedGame(req, q.get('u'));
    const job = await db.get(`job:${String(q.get('id')).replace(/[^\w-]/g, '')}`);
    if (!job || job.u !== cfg.universeId || job.status === 'done') throw fail(404, 'No such job.');
    await db.set(`job:${job.id}`, { ...job, status: 'working' }, 600);
    return job;
  },

  // ...and reports back. Read results also teach the site each store's key pattern for next time.
  'POST feed/job/result': async (req, res, b) => {
    const cfg = await feedGame(req, b.u);
    const job = await db.get(`job:${String(b.id).replace(/[^\w-]/g, '')}`);
    if (!job || job.u !== cfg.universeId || job.status === 'done') throw fail(404, 'No such job.');
    let result = b.result;
    if (job.kind === 'read') {
      result = (Array.isArray(result) ? result : []).slice(0, 60).map((r) => ({
        store: String(r.store).slice(0, 100), template: r.template ? String(r.template).slice(0, 100) : null,
        key: r.key ? String(r.key).slice(0, 100) : null, found: Boolean(r.found), value: r.value ?? null, error: r.error ? String(r.error).slice(0, 300) : null,
      }));
      // false = "not keyed by player", so the next read skips listing that store's keys.
      const fresh = await db.get(`game:${cfg.universeId}`);
      fresh.dataKeys = { ...(Object.keys(job.known).length ? fresh.dataKeys : {}) };
      for (const r of result) if (!r.error) fresh.dataKeys[r.store] = r.template || false;
      await save(fresh);
    } else {
      result = { ok: Boolean(result?.ok), error: result?.error ? String(result.error).slice(0, 300) : null };
      const fresh = await db.get(`game:${cfg.universeId}`);
      log(fresh, result.ok ? `Player data saved for ${job.userId} (${job.store})` : `Player data save failed: ${result.error}`, result.ok);
      await save(fresh);
    }
    await db.set(`job:${job.id}`, { ...job, status: 'done', result }, 600);
    return { ok: true };
  },
};

async function startJob(cfg, job) {
  const auth = await authFor(cfg);
  const jid = random(12);
  await db.set(`job:${jid}`, { ...job, id: jid, u: cfg.universeId, status: 'waiting', at: Date.now() }, 600);
  await rbx.publish(auth, cfg.universeId, 'UpdateDay', JSON.stringify({ type: 'job', id: jid }));
  return { id: jid };
}

async function feedGame(req, u) {
  if (!/^\d{1,20}$/.test(String(u))) throw fail(400, 'Bad game id.');
  const cfg = await db.get(`game:${u}`);
  if (!cfg || !safeEqual(req.headers['x-feed-token'] || '', cfg.feedToken)) throw fail(403, 'Bad feed token. Download the game script again.');
  return cfg;
}

const OPEN = new Set(['session', 'login', 'oauth/start', 'oauth/callback', 'feed', 'feed/claim', 'feed/job', 'feed/job/result']);

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const route = url.searchParams.get('route') || url.pathname.replace(/^\/api\//, '');
  try {
    if (route === 'cron') {
      if (!isCron(req)) throw fail(401, 'Bad cron secret.');
      return send(res, 200, await tick({ fromCron: true }));
    }
    const fn = routes[`${req.method} ${route}`];
    if (!fn) throw fail(404, 'Not found.');
    if (!db.storeReady && route !== 'session') throw fail(503, 'No database connected. Add Upstash Redis in Vercel (see README).');
    const uid = sessionUser(req);
    if (!OPEN.has(route) && !uid) throw fail(401, 'Log in first.');
    // Same-origin check on browser writes, on top of the SameSite cookie. Game servers send no Origin.
    if (req.method === 'POST' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw fail(403, 'Bad origin.');
    const body = req.method === 'POST' ? await readBody(req) : {};
    const out = await fn(req, res, body, url.searchParams, uid);
    if (!res.writableEnded) send(res, 200, out ?? { ok: true });
  } catch (e) {
    // A Roblox 401/403 is about the game's credentials, not this site's login, so it must not look like one.
    const status = e instanceof rbx.RobloxError ? (e.status === 404 ? 404 : 502)
      : e.status >= 400 && e.status < 600 ? e.status : 500;
    if (status === 500) console.error(e);
    if (route === 'oauth/callback') return redirect(res, `/#error=${encodeURIComponent(status === 500 ? 'Sign-in failed.' : e.message)}`);
    send(res, status, { error: status === 500 ? 'Something went wrong on the server.' : e.message });
  }
}
