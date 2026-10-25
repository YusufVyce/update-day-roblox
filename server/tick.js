// The "cloud" part, run every minute by the cron (and by any open dashboard as a backup):
// countdown icons, release autopilot, Discord posts, sales and the stats sampler.
import * as db from './store.js';
import * as rbx from './roblox.js';
import * as discord from './discord.js';
import { authFor, keepAlive } from './creds.js';
import { decrypt } from './auth.js';
import { stepTimes, dueStep, salePrice, taggedTitle, dueAnnouncements, fillTemplate, shortDuration } from '../lib.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;

export function log(cfg, text, ok = true) {
  cfg.log = [{ at: Date.now(), text, ok }, ...(cfg.log || [])].slice(0, 80);
}

const iconOf = (cfg, key) => db.get(`icon:${cfg.universeId}:${key === 'back' ? 'base' : key}`);

async function countdown(cfg, auth, now) {
  const cd = cfg.countdown;
  if (!cd.active || !cd.target || !cd.icons) return false;
  const steps = stepTimes(cd.target, cd.steps);
  const due = dueStep(steps, now);
  if (!due || cd.applied === due.key) return false;
  try {
    const img = await iconOf(cfg, due.key);
    if (!img) throw new Error('no icon saved for this step, press Start again');
    await rbx.setIcon(auth(), cfg.universeId, cfg.language || 'en', Buffer.from(img, 'base64'));
    Object.assign(cd, { applied: due.key, appliedAt: now, error: null });
    log(cfg, `Icon changed to "${due.label}"`);
  } catch (e) {
    if (cd.error?.key !== due.key) log(cfg, `Icon "${due.label}" failed: ${e.message}`, false);
    cd.error = { key: due.key, message: e.message };
  }
  return true;
}

// Things that happen once at release (title tag, server restart) and later (title back to normal).
async function autopilot(cfg, auth, now) {
  const cd = cfg.countdown;
  const ap = cfg.autopilot;
  const st = ap.state;
  if (!cd.active || !cd.target || now < cd.target) return false;
  let changed = false;
  const step = async (name, fn) => {
    changed = true;
    try { await fn(); } catch (e) { log(cfg, `${name} failed: ${e.message}`, false); }
  };

  if (ap.titleTag && !st.titleSet && now - cd.target < DAY) {
    st.titleSet = true;
    await step('Title tag', async () => {
      const place = await rbx.getPlace(auth(), cfg.universeId, cfg.placeId);
      st.titleOriginal = place.displayName;
      st.titleTagged = taggedTitle(place.displayName, ap.titleTag);
      await rbx.setPlace(auth(), cfg.universeId, cfg.placeId, { displayName: st.titleTagged });
      log(cfg, `Title set to "${st.titleTagged}"`);
    });
  }
  if (st.titleTagged && !st.titleRestored && now >= cd.target + ap.titleDays * DAY) {
    st.titleRestored = true;
    await step('Title restore', async () => {
      const place = await rbx.getPlace(auth(), cfg.universeId, cfg.placeId);
      if (place.displayName !== st.titleTagged) return log(cfg, 'Title was changed by hand, left as is');
      await rbx.setPlace(auth(), cfg.universeId, cfg.placeId, { displayName: st.titleOriginal });
      log(cfg, `Title back to "${st.titleOriginal}"`);
    });
  }
  if (ap.restart && !st.restarted && now - cd.target < 30 * 60000) {
    st.restarted = true;
    await step('Server restart', async () => {
      await rbx.restartServers(auth(), cfg.universeId, ap.bleedMinutes);
      log(cfg, ap.bleedMinutes ? `Servers migrating to the update over ${ap.bleedMinutes} min` : 'Servers restarted');
    });
  }
  return changed;
}

async function announce(cfg, now) {
  const cd = cfg.countdown;
  const ap = cfg.autopilot;
  if (!cd.active || !cd.target || !ap.discordUrl) return false;
  const due = dueAnnouncements(stepTimes(cd.target), ap.discordSteps, ap.state.sent, now);
  if (!due.length) return false;
  const s = due.at(-1); // several due after downtime: only the newest is news
  ap.state.sent.push(...due.map((d) => d.key));
  const vars = { game: cfg.name, time: shortDuration(cd.target - now), link: `https://www.roblox.com/games/${cfg.placeId}` };
  const live = s.key === 'now';
  try {
    await discord.post(decrypt(ap.discordUrl), {
      content: [ap.mention, fillTemplate(live ? ap.discordLive : ap.discordBefore, vars)].filter(Boolean).join(' '),
      title: cfg.name, link: vars.link,
      jpeg: cd.icons ? await iconOf(cfg, s.key).then((b) => b && Buffer.from(b, 'base64')) : null,
    });
    log(cfg, `Discord: posted "${s.label}"`);
  } catch (e) {
    log(cfg, `Discord post failed: ${e.message}`, false);
  }
  return true;
}

export async function prices(cfg, auth, sale, toSale) {
  for (const item of sale.items) {
    try {
      await rbx.setPrice(auth, cfg.universeId, item, toSale ? item.salePrice : item.price);
    } catch (e) {
      sale.errors = [...(sale.errors || []), `${item.name}: ${e.message}`].slice(-20);
    }
    await wait(400); // product updates are limited to 3 per second
  }
}

async function sales(cfg, auth, now) {
  let changed = false;
  for (const s of cfg.sales || []) {
    if (s.status === 'planned' && s.start <= now) {
      changed = true;
      if (s.end <= now) {
        s.status = 'missed';
        log(cfg, `Sale ${s.pct}% was missed, the cron was not running`, false);
        continue;
      }
      await prices(cfg, auth(), s, true);
      s.status = 'live';
      log(cfg, `Sale started: ${s.pct}% off ${s.items.length} items`, !s.errors?.length);
    } else if (s.status === 'live' && s.end <= now) {
      changed = true;
      await prices(cfg, auth(), s, false);
      s.status = 'ended';
      log(cfg, 'Sale ended, prices restored', !s.errors?.length);
    }
  }
  return changed;
}

// One sample per game per minute: [time, playing, visits, favorites, upVotes, downVotes].
async function sample(ids, now) {
  if (!ids.length || !(await db.lock('stats:lock', 55))) return;
  const day = new Date(now).toISOString().slice(0, 10);
  for (let i = 0; i < ids.length; i += 50) {
    const stats = await rbx.statsFor(ids.slice(i, i + 50)).catch(() => ({}));
    for (const [u, s] of Object.entries(stats)) {
      await db.push(`stats:${u}:${day}`, [now, s.playing, s.visits, s.favorites, s.up, s.down], 35 * 86400);
    }
  }
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));

export async function tick({ fromCron = false } = {}) {
  const now = Date.now();
  if (fromCron) await db.set('tick:last', now);
  const ids = (await db.get('games')) || [];
  await sample(ids, now);
  if (!(await db.lock('tick:lock', 55))) return { skipped: 'another tick is running' };
  const done = [];
  const members = new Set();
  try {
    for (const u of ids) {
      const cfg = await db.get(`game:${u}`);
      if (!cfg) continue;
      cfg.members?.forEach((m) => members.add(m));
      let headers = null;
      let authError = null;
      try { headers = await authFor(cfg); } catch (e) { authError = e; }
      // Each Roblox call goes through auth(), so a game with no working sign-in fails loudly per action.
      const auth = () => { if (!headers) throw authError; return headers; };
      const a = await countdown(cfg, auth, now);
      const b = await autopilot(cfg, auth, now);
      const c = await announce(cfg, now);
      const d = await sales(cfg, auth, now);
      if (!(a || b || c || d)) continue;
      // The owner may have edited the game while Roblox calls were running: write back onto a fresh copy.
      const fresh = await db.get(`game:${u}`);
      if (!fresh) continue;
      if (fresh.countdown.target === cfg.countdown.target) {
        Object.assign(fresh.countdown, pick(cfg.countdown, ['applied', 'appliedAt', 'error']));
        fresh.autopilot.state = cfg.autopilot.state;
      }
      for (const s of fresh.sales) {
        const t = cfg.sales.find((x) => x.id === s.id);
        if (t && s.status !== 'cancelled') Object.assign(s, pick(t, ['status', 'errors']));
      }
      fresh.log = [...cfg.log.filter((l) => l.at >= now), ...fresh.log].slice(0, 80);
      await db.set(`game:${u}`, fresh);
      done.push(u);
    }
    await keepAlive([...members]);
  } finally {
    await db.del('tick:lock');
  }
  return { ok: true, changed: done };
}
