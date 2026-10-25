// Every tab except Countdown. Each render(root, ctx) gets ctx = { cfg, update(cfg), rerender(), reload() }.
import { h, fill, api, toast, busy, pill, empty, zoneSelect, q, state, icon, card, copyButton, localZone } from './ui.js';
import { playersChart, sparkline } from './chart.js';
import {
  stepTimes, zonedToUtc, utcToZoned, fmtZoned, cityOf, compact, shortDuration, gameChecks, nextWeekly, salePrice,
  parseCatalog, launchReport, deltaPlaying,
} from '../lib.js';

const loading = () => h('div', { class: 'skeleton' }, h('span'), h('span'), h('span'));
const intro = (text, ...right) => h('div', { class: 'intro' }, h('p', {}, text), h('div', { class: 'row' }, ...right));

function failBox(root, e, retry) {
  fill(root, h('div', { class: 'empty bad' }, icon('alert'), h('span', {}, e.message), h('button', { class: 'ghost small', onclick: retry }, 'Try again')));
}

// datetime-local input that reads/writes epoch ms in the game's zone.
function when(tz, ms, label) {
  const input = h('input', { type: 'datetime-local', value: utcToZoned(ms, tz) });
  return { el: h('label', {}, label, input), get: () => zonedToUtc(input.value, tz), set: (v) => { input.value = utcToZoned(v, tz); } };
}

const stats = new Map(); // universeId -> { at, days, samples }
export async function loadStats(u, days = 1) {
  const c = stats.get(u);
  if (c && c.days >= days && Date.now() - c.at < 60000) return c.samples;
  const samples = await api(`stats?u=${u}&days=${days}`);
  stats.set(u, { at: Date.now(), days, samples });
  return samples;
}

/* ---------- Overview ---------- */

function timelineItems(cfg) {
  const cd = cfg.countdown;
  const ap = cfg.autopilot;
  const out = [];
  if (cd.target) {
    if (cd.icons) for (const s of stepTimes(cd.target, cd.steps)) out.push({ at: s.at, kind: 'icon', text: s.key === 'back' ? 'Icon back to normal' : `Icon → ${s.label}` });
    out.push({ at: cd.target, kind: 'release', text: 'Update goes live' });
    if (ap.titleTag) out.push({ at: cd.target, kind: 'auto', text: `Title gets "${ap.titleTag}"` }, { at: cd.target + ap.titleDays * 86400000, kind: 'auto', text: 'Title back to normal' });
    if (ap.restart) out.push({ at: cd.target, kind: 'auto', text: ap.bleedMinutes ? `Servers migrate over ${ap.bleedMinutes} min` : 'Servers restart' });
    if (ap.hasDiscord) for (const s of stepTimes(cd.target, ap.discordSteps)) out.push({ at: s.at, kind: 'discord', text: `Discord: ${s.label}` });
  }
  for (const s of cfg.sales) {
    if (!['planned', 'live'].includes(s.status)) continue;
    out.push({ at: s.start, kind: 'sale', text: `Sale ${s.pct}% starts` }, { at: s.end, kind: 'sale', text: `Sale ${s.pct}% ends` });
  }
  for (const t of cfg.timers) out.push({ at: t.endsAt, kind: 'timer', text: `Timer "${t.name}" ends` });
  return out.sort((a, b) => a.at - b.at);
}

function timeline(cfg) {
  const items = timelineItems(cfg);
  const now = Date.now();
  if (!items.length) return empty('Nothing planned yet. Set the update time in Countdown to see the whole launch here.');
  const from = Math.min(items[0].at, now - 3600000);
  const to = Math.max(items.at(-1).at, now + 3600000);
  const x = (t) => `${((t - from) / (to - from)) * 100}%`;
  const next = items.filter((i) => i.at > now).slice(0, 6);
  return h('div', {},
    h('div', { class: 'track' },
      h('div', { class: 'track-past', style: `width:${x(now)}` }),
      items.map((i) => h('span', { class: `tdot ${i.kind}${i.at <= now ? ' past' : ''}`, style: `left:${x(i.at)}`, title: `${i.text} · ${fmtZoned(i.at, cfg.timezone)}` })),
      h('span', { class: 'tnow', style: `left:${x(now)}` }, 'now')),
    h('div', { class: 'track-ends' }, h('small', {}, fmtZoned(from, cfg.timezone)), h('small', {}, fmtZoned(to, cfg.timezone))),
    next.length ? h('ul', { class: 'upnext' }, next.map((i) => h('li', {},
      h('span', { class: `tdot inline ${i.kind}` }),
      h('span', { class: 'grow' }, i.text),
      h('small', { class: 'muted' }, `in ${shortDuration(i.at - now)}`)))) : h('p', { class: 'muted' }, 'Everything planned has happened.'));
}

function reportCard(cfg, samples) {
  const r = cfg.countdown.target && cfg.countdown.target < Date.now() ? launchReport(samples, cfg.countdown.target) : null;
  if (!r) return null;
  const stat = (label, value, sub) => h('div', { class: 'rstat' }, h('small', {}, label), h('b', {}, value), sub ? h('span', { class: 'muted' }, sub) : null);
  return card('Launch report',
    h('div', { class: 'rgrid' },
      stat('Peak players', compact(r.peak), r.lift != null ? `${r.lift >= 0 ? '+' : ''}${r.lift}% vs the day before` : null),
      stat('Avg before', compact(r.avgBefore), 'last 24h before release'),
      stat('Visits since', `+${compact(r.visits)}`),
      stat('Favorites since', `+${compact(r.favorites)}`),
      stat('Like ratio', r.likeNow != null ? `${r.likeNow.toFixed(1)}%` : '–', r.likeBefore != null ? `was ${r.likeBefore.toFixed(1)}%` : null)));
}

export async function renderOverview(root, ctx) {
  const { cfg } = ctx;
  fill(root, loading());
  const samples = await loadStats(cfg.universeId, 7).catch(() => []);
  const p = state.pub;
  const last = samples.at(-1);
  const dayAgo = samples.findLast((s) => last && s[0] <= last[0] - 86400000);
  const d = deltaPlaying(samples);
  const kpi = (label, value, sub, extra) => h('div', { class: 'kpi' }, h('small', {}, label), h('b', {}, value), sub ? h('span', { class: sub.startsWith('-') ? 'down' : 'up' }, sub) : h('span', { class: 'muted' }, ' '), extra);
  const liked = last && last[4] + last[5] ? (last[4] / (last[4] + last[5])) * 100 : p?.liked;

  fill(root,
    h('div', { class: 'kpis' },
      kpi('Players now', compact(last?.[1] ?? p?.playing), d != null ? `${d >= 0 ? '+' : ''}${d}% vs yesterday` : null, sparkline(samples.slice(-180).map((s) => s[1]))),
      kpi('Visits', compact(last?.[2] ?? p?.visits), dayAgo ? `+${compact(last[2] - dayAgo[2])} today` : null),
      kpi('Favorites', compact(last?.[3] ?? p?.favorites), dayAgo ? `+${compact(last[3] - dayAgo[3])} today` : null),
      kpi('Liked', liked != null ? `${liked.toFixed(1)}%` : '–', null)),
    h('div', { class: 'ov-grid' },
      card('Launch timeline', timeline(cfg)),
      card('Activity', cfg.log.length
        ? h('ul', { class: 'log' }, cfg.log.slice(0, 8).map((l) => h('li', { class: l.ok ? '' : 'bad' },
          icon(l.ok ? 'check' : 'alert', 14), h('span', { class: 'grow' }, l.text), h('small', { class: 'muted' }, shortDuration(Date.now() - l.at)))))
        : empty('Nothing has happened yet.'))),
    reportCard(cfg, samples),
    cfg.connected ? null : h('p', { class: 'banner warn' }, icon('alert', 16), 'This game is not connected, so nothing can run. ',
      h('a', { href: `#/${cfg.universeId}/settings` }, 'Connect it in Settings')),
  );
}

/* ---------- Analytics ---------- */

export async function renderAnalytics(root, ctx, days = 1) {
  const { cfg } = ctx;
  fill(root, loading());
  let samples;
  try { samples = await loadStats(cfg.universeId, days); } catch (e) { return failBox(root, e, () => renderAnalytics(root, ctx, days)); }
  samples = samples.filter((s) => s[0] >= Date.now() - days * 86400000);
  const peak = samples.reduce((m, s) => (s[1] > m[1] ? s : m), samples[0] || [0, 0]);
  const avg = samples.length ? Math.round(samples.reduce((a, s) => a + s[1], 0) / samples.length) : null;
  const first = samples[0];
  const last = samples.at(-1);
  const hourly = samples.filter((s, i) => i % Math.max(1, Math.floor(samples.length / 48)) === 0);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: cfg.timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  fill(root,
    h('div', { class: 'intro' },
      h('p', {}, 'Live numbers from Roblox, sampled every minute by the cloud.'),
      h('div', { class: 'seg' }, [[1, '24h'], [7, '7 days'], [30, '30 days']].map(([n, l]) => h('button', {
        class: n === days ? 'on' : '', onclick: () => renderAnalytics(root, ctx, n),
      }, l)))),
    card('Players online', playersChart(samples, { release: cfg.countdown.target, tz: cfg.timezone })),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('small', {}, 'Peak'), h('b', {}, compact(peak[1])), h('span', { class: 'muted' }, peak[0] ? fmt.format(peak[0]) : ' ')),
      h('div', { class: 'kpi' }, h('small', {}, 'Average'), h('b', {}, compact(avg)), h('span', { class: 'muted' }, ' ')),
      h('div', { class: 'kpi' }, h('small', {}, 'Visits gained'), h('b', {}, first ? `+${compact(last[2] - first[2])}` : '–'), h('span', { class: 'muted' }, ' ')),
      h('div', { class: 'kpi' }, h('small', {}, 'Favorites gained'), h('b', {}, first ? `+${compact(last[3] - first[3])}` : '–'), h('span', { class: 'muted' }, ' '))),
    reportCard(cfg, samples),
    samples.length ? h('details', { class: 'help' }, h('summary', {}, 'Show as table'),
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['Time', 'Playing', 'Visits', 'Favorites'].map((t) => h('th', {}, t)))),
        h('tbody', {}, hourly.map((s) => h('tr', {}, h('td', {}, fmt.format(s[0])), h('td', {}, s[1].toLocaleString('en-US')), h('td', {}, s[2].toLocaleString('en-US')), h('td', {}, s[3].toLocaleString('en-US'))))))) : null,
  );
}

/* ---------- Timers ---------- */

export function renderTimers(root, { cfg, update }) {
  const tz = cfg.timezone;
  const rows = cfg.timers.map((t) => ({ ...t }));
  const list = h('ul', { class: 'list' });

  const draw = () => fill(list, rows.length ? rows.map((t, i) => {
    const w = when(tz, t.endsAt, 'Ends');
    w.el.addEventListener('change', () => { t.endsAt = w.get(); });
    return h('li', { class: 'row-card' },
      h('label', { class: 'grow' }, 'Name', h('input', { value: t.name, maxlength: 40, oninput: (e) => { t.name = e.target.value; } })),
      w.el,
      h('small', { class: 'muted left' }, t.endsAt > Date.now() ? `in ${shortDuration(t.endsAt - Date.now())}` : 'ended'),
      h('button', { class: 'link danger-text', onclick: () => { rows.splice(i, 1); draw(); } }, 'Remove'));
  }) : [empty('No timers yet.')]);
  draw();

  fill(root,
    intro('Countdowns inside your game: event ends, shop resets, the next update. Publishing reaches every running server in seconds.',
      h('a', { class: 'button ghost small', href: `#/${cfg.universeId}/settings` }, icon('download', 14), 'Game script')),
    list,
    h('div', { class: 'row gap' },
      h('button', { class: 'ghost', onclick: () => { rows.push({ name: `Timer${rows.length + 1}`, endsAt: Date.now() + 3600000 }); draw(); } }, icon('plus', 14), 'Add timer'),
      cfg.countdown.target ? h('button', {
        class: 'ghost',
        onclick: () => { if (!rows.some((r) => r.name === 'Update')) rows.push({ name: 'Update', endsAt: cfg.countdown.target }); draw(); },
      }, 'Add the update countdown') : null,
      h('div', { class: 'grow' }),
      h('button', {
        class: 'primary',
        onclick: (e) => busy(e.currentTarget, async () => {
          update(await api('timers', { u: cfg.universeId, timers: rows }));
          toast('Timers sent to the game');
        }),
      }, icon('send', 14), 'Publish to game')),
    h('details', { class: 'help' },
      h('summary', {}, 'Reading a timer in your game'),
      h('pre', {}, 'local t = game.ReplicatedStorage.UpdateDayTimers:WaitForChild("Update")\nlocal secondsLeft = t.Value - os.time()')),
  );
}

/* ---------- Events ---------- */

const CATEGORIES = ['newContent', 'contentUpdate', 'itemDrop', 'newSeason', 'newFeature', 'newMap', 'newLocation', 'moreLevels',
  'challenge', 'quest', 'festival', 'activity', 'earlyAccess', 'expansion', 'locationUpdate', 'systemUpdate'];
const nice = (c) => c.replace(/([A-Z])/g, ' $1').replace(/^./, (x) => x.toUpperCase());

export async function renderEvents(root, ctx) {
  const { cfg } = ctx;
  const tz = cfg.timezone;
  const list = h('ul', { class: 'list' }, loading());
  const form = eventForm(cfg, () => { form.hidden = true; load(); });
  form.hidden = true;

  fill(root,
    intro("Roblox events show on your game page and in players' calendars. Make one for every update so players get reminded.",
      h('button', { class: 'primary', onclick: () => { form.hidden = !form.hidden; } }, icon('plus', 14), 'New event')),
    form, list);

  async function load() {
    try {
      const events = await api(`events?u=${cfg.universeId}`);
      fill(list, events.length ? events.map((ev) => {
        const s = Date.parse(ev.startTime);
        const e = Date.parse(ev.endTime);
        const status = Date.now() < s ? 'upcoming' : Date.now() < e ? 'live' : 'ended';
        return h('li', { class: 'event' },
          h('div', { class: 'date' }, h('small', {}, new Intl.DateTimeFormat('en', { timeZone: tz, month: 'short' }).format(s)),
            h('b', {}, new Intl.DateTimeFormat('en', { timeZone: tz, day: 'numeric' }).format(s))),
          h('div', { class: 'grow' },
            h('div', { class: 'row' }, h('b', {}, ev.title), pill(status)),
            h('p', { class: 'muted' }, ev.subtitle || ev.description || ''),
            h('div', { class: 'tags' },
              h('span', { class: 'tag' }, `${fmtZoned(s, tz, false)} – ${fmtZoned(e, tz, false)}`),
              h('span', { class: 'tag' }, ev.visibility === 'public' ? 'Everyone' : nice(ev.visibility || 'private')),
              ...(ev.categories || []).map((c) => h('span', { class: 'tag accent' }, nice(c.category || c))))),
          h('button', {
            class: 'link danger-text',
            onclick: (b) => confirm(`Delete "${ev.title}"?`) && busy(b.currentTarget, async () => {
              await api('events/delete', { u: cfg.universeId, id: ev.id });
              toast('Event deleted');
              load();
            }),
          }, 'Delete'));
      }) : [empty('No events yet.')]);
    } catch (e) { failBox(list, e, load); }
  }
  load();
}

function eventForm(cfg, done) {
  const tz = cfg.timezone;
  const startAt = cfg.countdown.target && cfg.countdown.target > Date.now() ? cfg.countdown.target : Date.now() + 3600000;
  const start = when(tz, startAt, `Starts (${cityOf(tz)})`);
  const end = when(tz, startAt + 3600000, 'Ends');
  const title = h('input', { maxlength: 50, placeholder: 'W4 + HALLOWEEN EVENT', required: true });
  const subtitle = h('input', { maxlength: 50, placeholder: 'New world, new pets', required: true });
  const desc = h('textarea', { rows: 3, maxlength: 1000, placeholder: 'What players get (optional)' });
  const cat = h('select', {}, CATEGORIES.map((c) => h('option', { value: c }, nice(c))));
  return h('form', {
    class: 'card form-grid',
    onsubmit: (e) => {
      e.preventDefault();
      busy(e.submitter, async () => {
        await api('events/create', {
          u: cfg.universeId, title: title.value, subtitle: subtitle.value, description: desc.value,
          category: cat.value, start: start.get(), end: end.get(),
        });
        toast('Event created');
        e.target.reset();
        done();
      });
    },
  },
  h('label', {}, 'Title', title), h('label', {}, 'Subtitle', subtitle),
  h('label', { class: 'wide' }, 'Description', desc),
  h('label', {}, 'Category', cat), h('div'),
  start.el, end.el,
  h('div', { class: 'wide row end' }, h('button', { class: 'primary', type: 'submit' }, 'Create event')));
}

/* ---------- Game page ---------- */

export async function renderGamePage(root, { cfg }) {
  fill(root, loading());
  try {
    const [g, events] = await Promise.all([
      api(`game?u=${cfg.universeId}`),
      api(`events?u=${cfg.universeId}`).catch(() => []),
    ]);
    state.pub = g;
    const checks = gameChecks(g, { now: Date.now(), target: cfg.countdown.target, events });
    const toFix = checks.filter((c) => c.level === 'warn').length;
    const ic = { warn: 'alert', ok: 'check', info: 'info' };
    fill(root,
      intro('Your game page as players see it on Roblox, and what to fix before an update.',
        h('button', { class: 'ghost small', onclick: () => renderGamePage(root, { cfg }) }, 'Check again')),
      h('div', { class: 'gp-grid' },
        h('div', { class: 'card gp' },
          h('div', { class: 'gp-top' },
            g.thumb ? h('img', { class: 'gp-thumb', src: g.thumb, alt: 'First game thumbnail' }) : h('div', { class: 'gp-thumb none' }, 'No thumbnail'),
            h('div', { class: 'gp-side' },
              h('h2', {}, g.name),
              h('p', { class: 'by' }, 'By ', h('a', { href: g.url, target: '_blank', rel: 'noopener' }, g.creator || '?')),
              h('a', { class: 'play', href: g.url, target: '_blank', rel: 'noopener', 'aria-label': 'Open on Roblox' }, '▶'))),
          h('div', { class: 'gp-stats' },
            [['Active', compact(g.playing)], ['Favorites', compact(g.favorites)], ['Visits', compact(g.visits)],
              ['Server Size', g.maxPlayers], ['Genre', g.genre || 'All'], ['Updated', new Date(g.updated).toLocaleDateString('en-US')]]
              .map(([k, v]) => h('div', {}, h('small', {}, k), h('b', {}, String(v ?? '–'))))),
          h('h3', {}, 'Description'),
          h('p', { class: 'desc' }, g.description || '(empty)')),
        h('div', { class: 'card checks' },
          h('h3', { class: toFix ? 'warn-title' : 'ok-title' }, toFix ? `${toFix} thing${toFix > 1 ? 's' : ''} to look at` : 'Looks good'),
          h('ul', {}, checks.map((c) => h('li', {},
            h('span', { class: `ci ${c.level}` }, icon(ic[c.level], 12)),
            h('div', {}, h('b', {}, c.title), c.detail ? h('p', {}, c.detail) : null)))))),
    );
  } catch (e) { failBox(root, e, () => renderGamePage(root, { cfg })); }
}

/* ---------- Sale ---------- */

export async function renderSale(root, ctx) {
  const { cfg, update } = ctx;
  const tz = cfg.timezone;
  fill(root, loading());
  let items;
  try { items = await api(`items?u=${cfg.universeId}`); } catch (e) { return failBox(root, e, () => renderSale(root, ctx)); }

  const picked = new Set();
  let pct = 50;
  const list = h('ul', { class: 'items' });
  const hint = h('small', { class: 'hint' });
  const start = when(tz, null, 'Starts');
  const end = when(tz, null, 'Ends');
  const key = (it) => `${it.kind}:${it.id}`;
  const total = h('b');

  const draw = () => {
    fill(list, items.length ? items.map((it) => h('li', { class: picked.has(key(it)) ? 'on' : '' },
      h('label', {},
        h('input', { type: 'checkbox', checked: picked.has(key(it)), onchange: (e) => { e.target.checked ? picked.add(key(it)) : picked.delete(key(it)); draw(); } }),
        h('span', { class: 'kind' }, it.kind === 'pass' ? 'Pass' : 'Product'),
        h('span', { class: 'grow' }, it.name, it.forSale ? null : h('small', { class: 'muted' }, ' · off sale')),
        h('s', { class: 'muted' }, `R$ ${it.price}`),
        h('b', { class: 'green' }, `R$ ${salePrice(it.price, pct)}`)))) : [empty('No game passes or developer products with a price.')]);
    hint.textContent = picked.size ? `${picked.size} item${picked.size > 1 ? 's' : ''} at ${pct}% off` : 'Pick the items that go on sale.';
    hint.classList.toggle('warn', !picked.size);
  };

  const chips = h('div', { class: 'chips' });
  const other = h('input', { type: 'number', min: 1, max: 95, placeholder: 'Other %', class: 'other' });
  const drawChips = () => fill(chips, [10, 20, 25, 30, 40, 50, 75].map((p) => h('button', {
    class: p === pct ? 'chip on' : 'chip', onclick: () => { pct = p; other.value = ''; drawChips(); draw(); },
  }, `${p}%`)), other);
  other.oninput = () => { const v = +other.value; if (v >= 1 && v <= 95) { pct = v; drawChips(); draw(); } };
  drawChips();
  draw();

  const ah = cfg.adminHour;
  const sales = cfg.sales.filter((s) => s.status !== 'cancelled' || Date.now() - s.end < 86400000);

  fill(root,
    intro('Lower game pass and dev product prices for a while, like the admin-abuse hour. At the end every price goes back to what it was when you planned the sale.'),
    h('div', { class: 'sale-grid' },
      h('div', {},
        h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, `Items (${items.length})`),
          h('button', { class: 'link', onclick: () => { const all = picked.size < items.length; items.forEach((it) => (all ? picked.add(key(it)) : picked.delete(key(it)))); draw(); } }, 'Pick all')),
        list),
      card(null,
        h('h3', { class: 'card-title' }, 'Discount'), chips,
        h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, `When (${cityOf(tz)})`),
          ah ? h('button', {
            class: 'link',
            onclick: () => {
              const s = nextWeekly(ah.day, ah.time, tz, Date.now());
              start.set(s);
              end.set(s + ah.minutes * 60000);
            },
          }, 'Admin-abuse hour') : null),
        start.el, end.el,
        h('div', { class: 'footer-bar' }, hint, h('button', {
          class: 'primary',
          onclick: (e) => busy(e.currentTarget, async () => {
            if (!picked.size) throw new Error('Pick the items that go on sale.');
            update(await api('sales/create', {
              u: cfg.universeId, pct, start: start.get(), end: end.get(),
              items: items.filter((it) => picked.has(key(it))).map(({ kind, id }) => ({ kind, id })),
            }));
            toast('Sale planned');
          }),
        }, 'Plan sale')))),
    sales.length ? h('h3', { class: 'sec' }, 'Sales') : null,
    h('ul', { class: 'list' }, sales.map((s) => h('li', { class: 'row-card' },
      pill(s.status),
      h('div', { class: 'grow' },
        h('b', {}, `${s.pct}% off ${s.items.length} item${s.items.length > 1 ? 's' : ''}`),
        h('small', { class: 'muted block' }, `${fmtZoned(s.start, tz)} → ${fmtZoned(s.end, tz)}`),
        s.errors?.length ? h('small', { class: 'bad block' }, s.errors.join(' · ')) : null),
      ['planned', 'live'].includes(s.status) ? h('button', {
        class: 'link danger-text',
        onclick: (e) => confirm(s.status === 'live' ? 'End the sale now and restore prices?' : 'Cancel this sale?') && busy(e.currentTarget, async () => {
          update(await api('sales/cancel', { u: cfg.universeId, id: s.id }));
          toast(s.status === 'live' ? 'Sale ended, prices restored' : 'Sale cancelled');
        }),
      }, s.status === 'live' ? 'End now' : 'Cancel') : null))),
  );
}

/* ---------- Players: gifts + data ---------- */

export function renderPlayers(root, { cfg }) {
  const catalog = parseCatalog(cfg.catalog);
  const types = Object.keys(catalog);
  const tiers = cfg.tiers.split(',').map((s) => s.trim()).filter(Boolean);
  let player = null;
  let type = types[0];

  const name = h('input', { placeholder: 'Roblox username', maxlength: 20, autocomplete: 'off' });
  const who = h('div', { class: 'who' }, empty('Look up a player to send a gift or open their data.'));
  const what = h('select');
  const tier = h('select', {}, tiers.map((t) => h('option', {}, t)));
  const amount = h('input', { type: 'number', min: 1, max: 50, value: 1 });
  const chips = h('div', { class: 'chips' });
  const dataBox = h('div');

  const drawType = () => {
    fill(chips, types.map((t) => h('button', { class: t === type ? 'chip on' : 'chip', onclick: () => { type = t; drawType(); } }, t)));
    fill(what, (catalog[type] || []).map((i) => h('option', {}, i)));
  };
  drawType();

  const lookup = async (btn, withData = true) => busy(btn, async () => {
    const r = await api(`player?u=${cfg.universeId}&name=${q(name.value.trim())}`);
    player = r.user;
    fill(who, h('div', { class: 'player' },
      r.user.avatar ? h('img', { src: r.user.avatar, alt: '', width: 56, height: 56 }) : null,
      h('div', {}, h('b', {}, r.user.displayName), h('small', { class: 'muted block' }, `@${r.user.name} · ID ${r.user.id}`),
        h('small', { class: 'block' }, r.gifts.length ? `Waiting for them: ${r.gifts.map((g) => `${g.amount}× ${g.item}`).join(', ')}` : 'Gift box is empty.'))));
    if (withData) loadData(false);
  });

  // A running game server finds the DataStores and this player's keys, so nothing is typed here.
  async function job(path, body, status) {
    const { id } = await api(path, { u: cfg.universeId, userId: player.id, ...body });
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const r = await api(`data/result?u=${cfg.universeId}&id=${id}`);
      if (r.status === 'done') return r.result;
      status?.(r.status === 'working' ? 'A game server is reading your DataStores…' : 'Waiting for a game server…');
    }
    throw new Error('No game server answered. The game script must be installed and at least one server running.');
  }

  async function loadData(rescan) {
    const target = player;
    const line = h('p', { class: 'muted' }, 'Asking a game server…');
    fill(dataBox, card('Player data', line));
    try {
      const result = await job('data/read', { rescan }, (t) => { line.textContent = t; });
      if (player !== target) return;
      const found = result.filter((r) => r.found);
      const missing = result.filter((r) => !r.found && !r.error).map((r) => r.store);
      const errors = result.filter((r) => r.error);
      fill(dataBox,
        h('div', { class: 'card-head data-head' },
          h('h3', { class: 'card-title' }, `Player data · ${found.length} of ${result.length} DataStores have something for @${target.name}`),
          h('button', { class: 'link', onclick: () => loadData(true) }, 'Scan again')),
        found.length ? null : empty('No saved data found for this player.'),
        h('div', { class: 'data-grid' }, found.map((r) => {
          const text = h('textarea', { class: 'code', rows: 12, spellcheck: false });
          text.value = JSON.stringify(r.value, null, 2);
          return card(null,
            h('div', { class: 'ap-head' }, h('b', {}, r.store), h('code', {}, r.key)),
            text,
            h('div', { class: 'row end' }, h('button', {
              class: 'primary',
              onclick: (e) => busy(e.currentTarget, async () => {
                let value;
                try { value = JSON.parse(text.value); } catch { throw new Error('That is not valid JSON.'); }
                if (!confirm(`Overwrite ${r.store} / ${r.key}? If @${target.name} is in the game right now, their own save may overwrite this.`)) return;
                const out = await job('data/save', { store: r.store, key: r.key, value });
                if (!out.ok) throw new Error(`Save failed: ${out.error}`);
                toast('Saved. It applies the next time they join.');
              }),
            }, 'Save')));
        })),
        missing.length ? h('p', { class: 'muted small-note' }, `Nothing for this player in: ${missing.join(', ')}`) : null,
        errors.length ? h('p', { class: 'bad small-note' }, errors.map((r) => `${r.store}: ${r.error}`).join(' · ')) : null);
    } catch (e) {
      if (player === target) fill(dataBox, card('Player data', h('p', { class: 'bad' }, e.message), h('div', { class: 'row' }, h('button', { class: 'ghost small', onclick: () => loadData(rescan) }, 'Try again'))));
    }
  }

  fill(root,
    intro("Send a player anything from your gift list, and see or fix their saved data. Your game's DataStores are found automatically."),
    h('form', { class: 'search', onsubmit: (e) => { e.preventDefault(); lookup(e.submitter); } },
      icon('search'), name, h('button', { class: 'primary', type: 'submit' }, 'Look up')),
    h('div', { class: 'players-grid' },
      who,
      card('Send a gift',
        types.length ? null : h('p', { class: 'banner warn' }, icon('alert', 16), 'Add your gift list in Settings first, like "Pet: Apollo, Zeus".'),
        chips,
        h('div', { class: 'three' }, h('label', {}, 'What', what), h('label', {}, 'Tier', tier), h('label', {}, 'How many', amount)),
        h('div', { class: 'row end' }, h('button', {
          class: 'primary',
          onclick: (e) => busy(e.currentTarget, async () => {
            if (!player) throw new Error('Look up a player first.');
            const g = await api('gift', { u: cfg.universeId, userId: player.id, type, item: what.value, tier: tier.value, amount: +amount.value });
            toast(`Gift sent: ${g.amount}× ${g.item} to @${player.name}`);
            lookup(null, false);
          }),
        }, icon('send', 14), 'Send gift')))),
    dataBox,
  );
}

/* ---------- Settings ---------- */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function renderSettings(root, ctx) {
  const { cfg, update } = ctx;
  const saveField = (patch, msg = 'Saved') => api('settings', { u: cfg.universeId, ...patch }).then((c) => { update(c); toast(msg); }, (e) => toast(e.message, true));
  const field = (label, input, hint) => h('label', {}, label, input, hint ? h('small', { class: 'muted' }, hint) : null);
  const s = state.session;
  const cloudOk = s.lastCron && Date.now() - s.lastCron < 180000;
  const key = h('input', { type: 'password', placeholder: cfg.hasKey ? 'Key saved. Paste a new one to replace it' : 'Open Cloud API key (optional)', autocomplete: 'off' });
  const catalog = h('textarea', { rows: 5, placeholder: 'Pet: Apollo, Zeus\nEgg: Gold Egg, Rainbow Egg\nPotion: Luck, Speed' });
  catalog.value = cfg.catalog;

  fill(root, h('div', { class: 'settings-grid' },
    card('Connection',
      h('p', {}, cfg.connected ? h('span', { class: 'ok-text' }, icon('check', 14), ' Connected') : h('span', { class: 'bad' }, icon('alert', 14), ' Not connected'),
        ` · ${cfg.groupId ? 'group game' : 'user game'}${cfg.hasKey ? ' · API key' : ''}${cfg.members.length ? ` · ${cfg.members.length} team member${cfg.members.length > 1 ? 's' : ''}` : ''}`),
      s.oauthReady ? h('a', { class: 'button roblox', href: `/api/oauth/start?tz=${q(localZone())}` }, icon('roblox', 16), 'Connect with Roblox') : null,
      s.oauthReady ? h('small', { class: 'muted' }, 'Roblox asks which games and groups to share. Teammates connect the same way to work on this game together.') : null,
      h('details', { class: 'help', open: !s.oauthReady && !cfg.hasKey },
        h('summary', {}, s.oauthReady ? 'Use an API key instead' : 'API key'),
        h('div', { class: 'row gap' }, h('div', { class: 'grow' }, key),
          h('button', { class: 'ghost', onclick: (e) => busy(e.currentTarget, async () => { await saveField({ apiKey: key.value }, 'API key saved'); key.value = ''; }) }, 'Save'),
          cfg.hasKey ? h('button', { class: 'link danger-text', onclick: () => saveField({ apiKey: '' }, 'API key removed') }, 'Remove') : null),
        keyHelp())),

    card('Game script',
      h('p', { class: 'muted' }, 'Needed for Gifts, Timers and Player data. It finds your DataStores by itself and talks to this site over HTTP, so there is nothing to type and no extra Roblox permission.'),
      h('ol', { class: 'steps-list' },
        h('li', {}, 'Download the script and put it in a Script in ServerScriptService.'),
        h('li', {}, 'Game Settings → Security → turn on Allow HTTP Requests.'),
        h('li', {}, 'Publish. Gifts and timers now reach the game.')),
      h('div', { class: 'row gap' },
        h('a', { class: 'button primary', href: `/api/script?u=${cfg.universeId}` }, icon('download', 14), 'Download script'),
        h('button', {
          class: 'link muted',
          onclick: () => confirm('Make a new secret? The old script stops working until you replace it.') && saveField({ newFeedToken: true }, 'New secret made. Download the script again.'),
        }, 'Reset secret'))),

    card('Game',
      h('div', { class: 'two' },
        field('Time zone', zoneSelect(cfg.timezone, (e) => saveField({ timezone: e.target.value }))),
        field('Icon language', h('input', { value: cfg.language, maxlength: 10, onchange: (e) => saveField({ language: e.target.value }) }), "Your game's source language."))),

    card('Admin-abuse hour',
      h('div', { class: 'three' },
        field('Day', h('select', { onchange: (e) => saveField({ adminHour: { ...cfg.adminHour, day: +e.target.value } }) },
          DAYS.map((d, i) => h('option', { value: i, selected: i === cfg.adminHour.day }, d)))),
        field(`Starts (${cityOf(cfg.timezone)})`, h('input', { type: 'time', value: cfg.adminHour.time, onchange: (e) => saveField({ adminHour: { ...cfg.adminHour, time: e.target.value } }) })),
        field('Minutes', h('input', { type: 'number', min: 5, max: 1440, value: cfg.adminHour.minutes, onchange: (e) => saveField({ adminHour: { ...cfg.adminHour, minutes: +e.target.value } }) })))),

    card('Gift list',
      field('Items', catalog, 'One type per line: "Type: item, item, item".'),
      h('div', { class: 'row gap' },
        h('div', { class: 'grow' }, field('Tiers', h('input', { value: cfg.tiers, onchange: (e) => saveField({ tiers: e.target.value }) }))),
        h('button', { class: 'ghost', onclick: () => saveField({ catalog: catalog.value }, 'Gift list saved') }, 'Save list'))),

    card('Cloud',
      h('p', {}, cloudOk ? h('span', { class: 'ok-text' }, icon('check', 14), ` Running · last run ${shortDuration(Date.now() - s.lastCron)} ago`)
        : s.cronReady ? 'Waiting for the first cron call. Set up the every-minute cron from the README.'
          : 'Not set up yet. Icons, sales and Discord posts only run while a dashboard is open. Set CRON_SECRET and the cron from the README.')),

    card('Danger zone',
      h('div', { class: 'row gap' },
        h('button', {
          class: 'ghost',
          onclick: (e) => confirm('Restart all servers now? Players move to new servers on the latest version.') && busy(e.currentTarget, async () => {
            await api('restart', { u: cfg.universeId });
            toast('Servers restarting');
          }),
        }, 'Restart servers'),
        h('button', {
          class: 'danger',
          onclick: (e) => confirm(`Remove ${cfg.name} from your list? Nothing changes on Roblox.`) && busy(e.currentTarget, async () => {
            await api('games/remove', { u: cfg.universeId });
            location.hash = '#/';
            location.reload();
          }),
        }, 'Remove game'))),
  ));
}

export function keyHelp() {
  return h('div', { class: 'keyhelp' },
    h('ol', {},
      h('li', {}, 'Open ', h('a', { href: 'https://create.roblox.com/dashboard/credentials', target: '_blank', rel: 'noopener' }, 'Creator Hub → Open Cloud → API Keys'), '. Group game: switch to the group first (top left).'),
      h('li', {}, 'Create API Key, then under Access Permissions add these and pick your game for each:'),
      h('ul', { class: 'perm' },
        [['legacy-universe', 'icon'], ['universe', 'restart'], ['universe.place', 'title tag'], ['game-pass', 'sales'], ['developer-product', 'sales'],
          ['universe.event', 'events'], ['universe-messaging-service', 'gifts, timers, player data']]
          .map(([p, why]) => h('li', {}, h('code', {}, p), h('small', { class: 'muted' }, ` ${why}`)))),
      h('li', {}, 'Tick every operation each one offers. Accepted IP addresses: 0.0.0.0/0.'),
      h('li', {}, 'Save, copy the key, paste it here.')));
}

