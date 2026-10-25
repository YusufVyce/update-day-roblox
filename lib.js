// Pure helpers shared by the browser, the server and the tests. No DOM, no network.

export const STEPS = [
  { key: 'h24', label: '24 HOURS', min: 1440 },
  { key: 'h12', label: '12 HOURS', min: 720 },
  { key: 'h6', label: '6 HOURS', min: 360 },
  { key: 'h3', label: '3 HOURS', min: 180 },
  { key: 'h2', label: '2 HOURS', min: 120 },
  { key: 'h1', label: '1 HOUR', min: 60 },
  { key: 'm45', label: '45 MINS', min: 45 },
  { key: 'm30', label: '30 MINS', min: 30 },
  { key: 'm15', label: '15 MINS', min: 15 },
  { key: 'm10', label: '10 MINS', min: 10 },
  { key: 'm5', label: '5 MINS', min: 5 },
  { key: 'now', label: 'NOW!', min: 0 },
  { key: 'back', label: 'Normal icon', min: -120 }, // put the real icon back 2h after release
];

// Steps that are switched on, with the time each one fires.
export function stepTimes(target, enabled = STEPS.map((s) => s.key)) {
  return STEPS.filter((s) => enabled.includes(s.key)).map((s) => ({ ...s, at: target - s.min * 60000 }));
}

// The newest step whose time has come, or null if none has.
export function dueStep(steps, now) {
  let due = null;
  for (const s of steps) if (s.at <= now) due = s;
  return due;
}

export function stepStatus(steps, now) {
  const due = dueStep(steps, now);
  return Object.fromEntries(steps.map((s) => [s.key, s.at > now ? 'upcoming' : s === due ? 'live' : 'done']));
}

/* ---------- time zones ---------- */

// Minutes the zone is ahead of UTC at instant `ms`.
export function tzOffset(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(ms).map((x) => [x.type, +x.value]));
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000) / 60000;
}

// "2026-10-24T18:00" read as wall-clock time in `tz` -> epoch ms.
export function zonedToUtc(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local || '');
  if (!m) return NaN;
  const guess = Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5]);
  const first = guess - tzOffset(guess, tz) * 60000;
  return guess - tzOffset(first, tz) * 60000; // second pass settles DST edges
}

// epoch ms -> "2026-10-24T18:00" in `tz`, for <input type="datetime-local">.
export function utcToZoned(ms, tz) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms + tzOffset(ms, tz) * 60000).toISOString().slice(0, 16);
}

export function fmtZoned(ms, tz, withDay = true) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, ...(withDay && { weekday: 'short', month: 'short', day: 'numeric' }), hour: 'numeric', minute: '2-digit',
  }).format(ms);
}

export const cityOf = (tz) => (tz || 'UTC').split('/').pop().replace(/_/g, ' ');

// Next start of a weekly slot (0 = Sunday) in `tz`, at or after `now`.
export function nextWeekly(day, time, tz, now) {
  const today = utcToZoned(now, tz).slice(0, 10);
  for (let i = 0; i < 8; i++) {
    const d = new Date(Date.parse(today + 'T00:00Z') + i * 86400000);
    if (d.getUTCDay() !== day) continue;
    const at = zonedToUtc(d.toISOString().slice(0, 10) + 'T' + time, tz);
    if (at > now) return at;
  }
  return NaN;
}

/* ---------- formatting ---------- */

export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const hms = [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
  return d ? `${d}d ${hms}` : hms;
}

export function shortDuration(ms) {
  const abs = Math.abs(ms);
  if (abs < 60000) return Math.round(abs / 1000) + 's';
  if (abs < 3600000) return Math.round(abs / 60000) + 'm';
  if (abs < 86400000) return Math.floor(abs / 3600000) + 'h ' + Math.round((abs % 3600000) / 60000) + 'm';
  return Math.floor(abs / 86400000) + 'd ' + Math.round((abs % 86400000) / 3600000) + 'h';
}

export function compact(n) {
  return n == null ? '–' : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/* ---------- roblox ---------- */

// Accepts a bare place id or any roblox.com/games/<id>/... link.
export function parsePlaceId(input) {
  const s = String(input || '').trim();
  if (/^\d{1,20}$/.test(s)) return s;
  const m = s.match(/roblox\.com\/(?:[a-z-]+\/)?games\/(\d{1,20})/i);
  return m ? m[1] : null;
}

export const salePrice = (price, pct) => Math.max(1, Math.round(price * (1 - pct / 100)));

// What to fix on the game page before/after an update. `game` is the /api/game payload.
export function gameChecks(game, { now, target, events = [] }) {
  const out = [];
  const shots = game.thumbnails ?? 0;
  if (shots < 3) out.push({ level: 'warn', title: `Only ${shots} thumbnail${shots === 1 ? '' : 's'}`, detail: 'Games usually show 3 or more; the first one is the one most players see.' });
  const updated = Date.parse(game.updated);
  if (now - updated < 86400000) out.push({ level: 'info', title: 'Last update today' });
  else out.push({ level: 'info', title: `Last update ${shortDuration(now - updated)} ago` });
  if (target) {
    const ev = events.find((e) => Math.abs(Date.parse(e.startTime) - target) < 6 * 3600000);
    out.push(ev ? { level: 'ok', title: `Event for the update: ${ev.title}` }
      : { level: 'warn', title: 'No event for the update', detail: 'Roblox events show on your game page and remind players who RSVP.' });
  }
  if (!/^\s*\[[^\]]*\]|update|\bnew\b/i.test(game.name)) {
    out.push({ level: 'info', title: 'Title has no update tag', detail: 'Many games put [UPDATE] or an emoji in the title while the update is fresh.' });
  }
  if (!game.description?.trim()) out.push({ level: 'warn', title: 'Description is empty' });
  return out;
}

/* ---------- autopilot ---------- */

// "[🎃] Adopt Me!" + "[UPDATE]" -> "[UPDATE] Adopt Me!". Replaces a leading [tag], else prepends. Roblox names max out at 50.
export function taggedTitle(original, tag) {
  const bare = original.replace(/^\s*\[[^\]]*\]\s*/, '');
  return `${tag.trim()} ${bare}`.slice(0, 50).trim();
}

// Discord posts due now: chosen steps whose time passed less than 15 minutes ago (older ones are stale news).
export function dueAnnouncements(steps, chosen, sent, now) {
  return steps.filter((s) => chosen.includes(s.key) && !sent.includes(s.key) && s.at <= now && now - s.at < 15 * 60000);
}

export function fillTemplate(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/* ---------- stats ---------- */
// A sample is [time, playing, visits, favorites, upVotes, downVotes].

// At most `max` points: peak players per bucket (spikes matter), latest counters.
export function downsample(samples, max) {
  if (samples.length <= max) return samples;
  const size = Math.ceil(samples.length / max);
  const out = [];
  for (let i = 0; i < samples.length; i += size) {
    const bucket = samples.slice(i, i + size);
    const last = bucket.at(-1);
    out.push([last[0], Math.max(...bucket.map((s) => s[1])), last[2], last[3], last[4], last[5]]);
  }
  return out;
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const likeRatio = (s) => (s && s[4] + s[5] ? (s[4] / (s[4] + s[5])) * 100 : null);

// Before/after numbers around a release. Needs samples on both sides.
export function launchReport(samples, release) {
  const before = samples.filter((s) => s[0] < release && s[0] >= release - 86400000);
  const after = samples.filter((s) => s[0] >= release);
  if (!before.length || !after.length) return null;
  const base = avg(before.map((s) => s[1]));
  const peak = after.reduce((p, s) => (s[1] > p[1] ? s : p));
  const first = before.at(-1);
  const last = after.at(-1);
  return {
    avgBefore: Math.round(base),
    peak: peak[1],
    peakAt: peak[0],
    lift: base ? Math.round(((peak[1] - base) / base) * 100) : null,
    visits: last[2] - first[2],
    favorites: last[3] - first[3],
    likeBefore: likeRatio(first),
    likeNow: likeRatio(last),
  };
}

// Change in players versus the closest sample about `ago` ms earlier.
export function deltaPlaying(samples, ago = 86400000) {
  const last = samples.at(-1);
  if (!last) return null;
  const then = samples.findLast((s) => s[0] <= last[0] - ago);
  return then && then[1] ? Math.round(((last[1] - then[1]) / then[1]) * 100) : null;
}

/* ---------- gifts ---------- */

// Settings text like "Pet: Apollo, Zeus" (one category per line) -> { Pet: ['Apollo', 'Zeus'] }
export function parseCatalog(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const items = line.slice(i + 1).split(',').map((s) => s.trim()).filter(Boolean);
    if (items.length) out[line.slice(0, i).trim()] = items;
  }
  return out;
}
