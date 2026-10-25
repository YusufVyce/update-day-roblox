// Countdown tab: builds the icon for every step and hands them to the cloud, which swaps them on time.
// Also holds the release autopilot: title tag, server restart and Discord announcements.
import { h, fill, api, toast, busy, pill, state, icon, card } from './ui.js';
import { STEPS, stepTimes, zonedToUtc, utcToZoned, fmtZoned, cityOf, clock, compact } from '../lib.js';

const S = 512;
let base = null; // the plain game icon, as a canvas
let baseFor = null;
const cache = new Map(); // step key -> jpeg data URL of the rendered icon

const GLASS = new Path2D('M27 16 C27 38 45 44 45 50 C45 56 27 62 27 84 L73 84 C73 62 55 56 55 50 C55 44 73 38 73 16 Z');
const SAND = new Path2D('M34 26 L66 26 C62 38 54 43 50 46 C46 43 38 38 34 26 Z M33 84 C38 72 46 68 50 66 C54 68 62 72 67 84 Z');

function toCanvas(img) {
  const c = h('canvas', { width: S, height: S });
  const k = Math.max(S / img.width, S / img.height);
  c.getContext('2d').drawImage(img, (S - img.width * k) / 2, (S - img.height * k) / 2, img.width * k, img.height * k);
  return c;
}

const loadImage = (src) => new Promise((ok, bad) => {
  const i = new Image();
  i.onload = () => ok(i);
  i.onerror = () => bad(new Error('Could not read that image.'));
  i.src = src;
});

function setBase(canvas) {
  base = canvas;
  cache.clear();
}

async function loadSavedBase(cfg) {
  if (baseFor === cfg.universeId) return;
  baseFor = cfg.universeId;
  setBase(null);
  try {
    const { data } = cfg.countdown.saved.includes('base')
      ? await api(`icon?u=${cfg.universeId}&step=base`)
      : await api(`baseicon?u=${cfg.universeId}`).then((r) => ({ data: r.data, type: r.type }));
    setBase(toCanvas(await loadImage(`data:image/png;base64,${data}`)));
  } catch { /* no icon yet: placeholder */ }
}

export function drawStep(step) {
  const c = h('canvas', { width: S, height: S });
  const ctx = c.getContext('2d');
  if (base) ctx.drawImage(base, 0, 0);
  else {
    ctx.fillStyle = '#232634';
    ctx.fillRect(0, 0, S, S);
  }
  if (step.key === 'back') return c;

  const fade = ctx.createLinearGradient(0, S * 0.4, 0, S);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, S, S);

  ctx.save();
  ctx.translate(S / 2 - 110, 40);
  ctx.scale(2.2, 2.2);
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fill(GLASS);
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#fff';
  ctx.lineJoin = 'round';
  ctx.stroke(GLASS);
  ctx.fillStyle = '#fff';
  ctx.fill(SAND);
  ctx.beginPath();
  ctx.roundRect(18, 7, 64, 10, 4);
  ctx.roundRect(18, 83, 64, 10, 4);
  ctx.fill();
  ctx.restore();

  let size = 120;
  const font = () => `900 ${size}px Geist, "Arial Black", sans-serif`;
  ctx.font = font();
  while (ctx.measureText(step.label).width > S - 40 && size > 30) {
    size -= 4;
    ctx.font = font();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size / 5;
  ctx.strokeStyle = 'rgba(0,0,0,.85)';
  ctx.strokeText(step.label, S / 2, 410);
  ctx.fillStyle = '#fff';
  ctx.fillText(step.label, S / 2, 410);
  return c;
}

export function iconUrl(step) {
  if (!cache.has(step.key)) cache.set(step.key, drawStep(step).toDataURL('image/jpeg', 0.9));
  return cache.get(step.key);
}

/* ---------- tab ---------- */

let timer = null;

export async function renderCountdown(root, ctx) {
  const { cfg } = ctx;
  const cd = cfg.countdown;
  const tz = cfg.timezone;
  await document.fonts.load('900 100px Geist').catch(() => {});
  await loadSavedBase(cfg);

  const steps = cd.target ? stepTimes(cd.target, cd.steps) : [];
  const enabled = new Set(cd.steps);
  const appliedIdx = steps.findIndex((s) => s.key === cd.applied);
  const now = Date.now();

  const statusOf = (s, i) => {
    if (!cd.icons) return null;
    if (cd.error?.key === s.key) return h('span', { class: 'pill failed', title: cd.error.message }, 'Failed');
    if (!cd.active && !cd.applied) return pill('off', 'Not started');
    if (s.key === cd.applied) return pill('live');
    if (i < appliedIdx) return pill('done');
    if (s.at <= now && cd.active) return h('span', { class: 'pill pending', title: 'Waiting for the cloud to run' }, 'Due');
    return pill('upcoming');
  };

  const rows = (steps.length ? steps : STEPS).map((s, i) => h('li', { class: `step${s.key === cd.applied ? ' current' : ''}${enabled.has(s.key) ? '' : ' off'}` },
    h('input', {
      type: 'checkbox', checked: enabled.has(s.key), disabled: cd.active, 'aria-label': `Use the ${s.label} step`,
      onchange: (e) => busy(e.target, async () => {
        const next = STEPS.map((x) => x.key).filter((k) => (k === s.key ? e.target.checked : enabled.has(k)));
        ctx.update(await api('countdown', { u: cfg.universeId, steps: next }));
      }),
    }),
    h('img', { src: iconUrl(s), alt: '', width: 40, height: 40 }),
    h('div', { class: 'grow' }, h('b', {}, s.label), h('small', {}, s.at ? fmtZoned(s.at, tz) : s.min > 0 ? `${s.label.toLowerCase()} before` : s.min === 0 ? 'at release' : '2 hours after release')),
    s.at && enabled.has(s.key) ? statusOf(s, i) : null,
  ));

  const shown = steps[appliedIdx] || steps.find((s) => s.at > now) || STEPS[0];

  const targetInput = h('input', {
    type: 'datetime-local', value: utcToZoned(cd.target, tz),
    onchange: (e) => busy(e.target, async () => {
      const t = zonedToUtc(e.target.value, tz);
      if (!Number.isFinite(t)) return;
      ctx.update(await api('countdown', { u: cfg.universeId, target: t }));
      toast(cd.active ? 'Update time moved, everything follows it' : 'Update time saved');
    }),
  });

  const file = h('input', {
    type: 'file', accept: 'image/png,image/jpeg', hidden: true,
    onchange: async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        setBase(toCanvas(await createImageBitmap(f)));
        ctx.rerender();
      } catch { toast('Could not read that image.', true); }
    },
  });

  const start = h('button', {
    class: cd.active ? 'danger' : 'primary big',
    onclick: (e) => {
      const btn = e.currentTarget;
      // Re-render afterwards either way, so a failed save doesn't leave "Saving icons…" on the button.
      busy(btn, () => startStop(btn)).then(() => btn.isConnected && ctx.rerender());
    },
  }, icon(cd.active ? 'alert' : 'bolt', 16), cd.active ? 'Stop countdown' : 'Start countdown');

  async function startStop(btn) {
    if (cd.active) {
      ctx.update(await api('countdown', { u: cfg.universeId, active: false }));
      return toast('Countdown stopped');
    }
    const t = zonedToUtc(targetInput.value, tz);
    if (!Number.isFinite(t) || t < Date.now() + 60000) throw new Error('Pick an update time in the future.');
    await api('countdown', { u: cfg.universeId, target: t });
    if (cd.icons) {
      if (!base) throw new Error('Pick the base icon first.');
      const todo = [...stepTimes(t, cd.steps).filter((s) => s.key !== 'back'), { key: 'base' }];
      for (const [i, s] of todo.entries()) {
        btn.textContent = `Saving icons ${i + 1}/${todo.length}…`;
        const canvas = s.key === 'base' ? base : drawStep(s);
        await api('icon', { u: cfg.universeId, step: s.key, data: canvas.toDataURL('image/jpeg', 0.9).split(',')[1] });
      }
    }
    ctx.update(await api('countdown', { u: cfg.universeId, active: true }));
    await api('tick', {}).catch(() => {});
    ctx.update(await ctx.reload());
    toast('Countdown started. The cloud takes it from here.');
  }

  const clockEl = h('b', { class: 'big-clock' });
  const bar = h('span');
  const label = h('small', { class: 'muted' });

  fill(root,
    h('div', { class: 'toolbar' },
      h('label', { class: 'field' }, `Update time (${cityOf(tz)})`, targetInput),
      h('div', { class: 'field' },
        h('span', { class: 'lbl' }, 'Base icon'),
        h('div', { class: 'row' },
          h('label', { class: 'button ghost small' }, 'Upload', file),
          h('button', {
            class: 'ghost small',
            onclick: (e) => busy(e.currentTarget, async () => {
              const { data } = await api(`baseicon?u=${cfg.universeId}`);
              setBase(toCanvas(await loadImage(`data:image/png;base64,${data}`)));
              ctx.rerender();
            }),
          }, 'Use live icon'))),
      h('label', { class: 'switch' },
        h('input', {
          type: 'checkbox', checked: cd.icons, disabled: cd.active,
          onchange: (e) => busy(e.target, async () => ctx.update(await api('countdown', { u: cfg.universeId, icons: e.target.checked }))),
        }), h('span', {}, 'Change the game icon')),
      h('div', { class: 'grow' }),
      start),
    cd.error ? h('p', { class: 'banner bad' }, icon('alert', 16), `Last icon change failed: ${cd.error.message}`) : null,
    h('div', { class: 'cd-grid' },
      h('section', { class: 'card flush' },
        h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, 'Steps'), h('small', { class: 'muted' }, `${enabled.size} of ${STEPS.length} on`)),
        h('ul', { class: 'steps' }, rows)),
      h('aside', { class: 'preview card' },
        h('small', { class: 'eyebrow' }, 'How players see it'),
        h('img', { class: 'big-icon', src: iconUrl(cd.icons ? shown : { key: 'back' }), alt: `Game icon showing ${shown.label}` }),
        h('div', { class: 'pv-name' }, cfg.name),
        h('div', { class: 'pv-meta' }, `${state.pub?.liked ?? '–'}% liked · ${compact(state.pub?.playing)} playing`),
        h('small', { class: 'eyebrow' }, cd.target && cd.target <= now ? 'Released' : 'Update in'),
        clockEl,
        label,
        h('div', { class: 'progress' }, bar))),
    autopilotPanel(ctx),
  );

  clearInterval(timer);
  const paint = () => {
    if (!root.isConnected) return clearInterval(timer);
    const t = Date.now();
    if (!cd.target) {
      clockEl.textContent = '--:--:--';
      label.textContent = 'Pick the update time';
      return;
    }
    clockEl.textContent = clock(Math.abs(cd.target - t));
    label.textContent = `${fmtZoned(cd.target, tz)} · ${cityOf(tz)}`;
    const first = steps[0]?.at ?? cd.target;
    bar.style.width = `${Math.min(100, Math.max(0, ((t - first) / (cd.target - first || 1)) * 100))}%`;
  };
  paint();
  timer = setInterval(paint, 1000);
}

/* ---------- autopilot ---------- */

function autopilotPanel(ctx) {
  const { cfg } = ctx;
  const ap = cfg.autopilot;
  const save = (patch, msg = 'Saved') => api('autopilot', { u: cfg.universeId, ...patch }).then((c) => { ctx.update(c); toast(msg); }, (e) => toast(e.message, true));
  const done = (flag) => (flag ? h('span', { class: 'pill done' }, 'Done') : null);

  const url = h('input', { type: 'password', placeholder: ap.hasDiscord ? 'Webhook saved. Paste a new one to replace it' : 'https://discord.com/api/webhooks/…', autocomplete: 'off' });

  return h('section', { class: 'autopilot' },
    h('div', { class: 'section-head' },
      h('h2', {}, icon('bolt', 18), 'Release autopilot'),
      h('p', { class: 'muted' }, 'Runs by itself when the countdown is on. Nothing here needs you at your computer at release time.')),
    h('div', { class: 'ap-grid' },
      card(null,
        h('div', { class: 'ap-head' }, h('b', {}, 'Update tag in the title'), done(ap.state.titleSet && !ap.state.titleRestored)),
        h('p', { class: 'muted' }, 'At release the title gets your tag, and after a few days it goes back to the old title.'),
        h('div', { class: 'two' },
          h('label', {}, 'Tag', h('input', { value: ap.titleTag, maxlength: 25, placeholder: '[🎃 UPDATE]', onchange: (e) => save({ titleTag: e.target.value }) })),
          h('label', {}, 'Remove after (days)', h('input', { type: 'number', min: 1, max: 30, value: ap.titleDays, onchange: (e) => save({ titleDays: +e.target.value }) }))),
        ap.state.titleTagged ? h('small', { class: 'muted' }, `Live title: ${ap.state.titleTagged}`) : null),
      card(null,
        h('div', { class: 'ap-head' }, h('b', {}, 'Move players to the update'), done(ap.state.restarted)),
        h('p', { class: 'muted' }, 'Restarts servers at release so nobody stays on the old version.'),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: ap.restart, onchange: (e) => save({ restart: e.target.checked }) }), h('span', {}, 'Restart servers at release')),
        h('label', {}, 'Soft migrate over (minutes, 0 = right away)',
          h('input', { type: 'number', min: 0, max: 60, value: ap.bleedMinutes, onchange: (e) => save({ bleedMinutes: +e.target.value }) }))),
      card(null,
        h('div', { class: 'ap-head' }, h('b', {}, 'Discord announcements'), ap.state.sent.length ? h('span', { class: 'pill done' }, `${ap.state.sent.length} sent`) : null),
        h('p', { class: 'muted' }, 'Posts with the countdown icon attached, at the steps you pick.'),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, url),
          h('button', { class: 'ghost', onclick: () => url.value.trim() && save({ discordUrl: url.value.trim() }, 'Webhook saved') }, 'Save'),
          ap.hasDiscord ? h('button', { class: 'ghost', onclick: (e) => busy(e.currentTarget, async () => { await api('discord/test', { u: cfg.universeId }); toast('Test message sent'); }) }, 'Test') : null),
        h('div', { class: 'chips' }, STEPS.filter((s) => s.min >= 0).map((s) => h('button', {
          class: ap.discordSteps.includes(s.key) ? 'chip on' : 'chip',
          onclick: () => save({ discordSteps: ap.discordSteps.includes(s.key) ? ap.discordSteps.filter((k) => k !== s.key) : [...ap.discordSteps, s.key] }),
        }, s.label))),
        h('div', { class: 'two' },
          h('label', {}, 'Before release', h('input', { value: ap.discordBefore, maxlength: 300, onchange: (e) => save({ discordBefore: e.target.value }) })),
          h('label', {}, 'At release', h('input', { value: ap.discordLive, maxlength: 300, onchange: (e) => save({ discordLive: e.target.value }) }))),
        h('div', { class: 'row' },
          h('small', { class: 'muted grow' }, '{game}, {time} and {link} are filled in.'),
          h('select', { onchange: (e) => save({ mention: e.target.value }), 'aria-label': 'Mention' },
            ['', '@everyone', '@here'].map((m) => h('option', { value: m, selected: m === ap.mention }, m || 'No mention')))))),
  );
}
