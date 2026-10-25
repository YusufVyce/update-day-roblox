// Shared browser helpers: DOM builder, icons, API calls, toasts and app state.

export const state = { session: null, games: [], cfg: null, pub: null, tab: 'overview' };

// Always textContent, never innerHTML: names and descriptions come from Roblox and players.
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}

// replaceChildren that skips null/false, so "cond ? el : null" works like it does inside h().
export const fill = (root, ...kids) => root.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

export const $ = (sel, root = document) => root.querySelector(sel);

const SVG = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  el.append(...kids.flat().filter(Boolean));
  return el;
}

// Small stroke icons (24px grid, Lucide-style).
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  overview: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  hourglass: 'M6 2h12M6 22h12M7 2c0 6 10 6 10 10S7 16 7 22M17 2c0 6-10 6-10 10s10 4 10 10',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  calendar: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  timer: 'M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9z',
  cloud: 'M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  check: 'M20 6 9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 16v-4M12 8h.01',
  external: 'M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  copy: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  roblox: 'M5.2 2 2 18.8 18.8 22 22 5.2zM10 9.3l4.7.9-.9 4.7-4.7-.9z',
  key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4',
  discord: 'M8 12h.01M16 12h.01M7 17c-3 0-5-1-5-1 0-5 1.5-9 3-11 2-.8 4-1 4-1l.5 1.5c1.7-.3 3.3-.3 5 0L15 4s2 .2 4 1c1.5 2 3 6 3 11 0 0-2 1-5 1l-1-2',
};

export function icon(name, size = 18) {
  return svg('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'ico' },
    svg('path', { d: ICONS[name] || ICONS.info }));
}

export async function api(path, body) {
  const r = await fetch('/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({ error: 'The server sent a bad response.' }));
  if (r.status === 401 && path !== 'login') location.reload();
  if (!r.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

export function toast(text, bad = false) {
  const t = h('div', { class: bad ? 'toast bad' : 'toast', role: 'status' }, icon(bad ? 'alert' : 'check', 16), text);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), bad ? 6000 : 2800);
}

// Runs an async action from a button: disables it, shows errors as toasts.
export async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

export const q = (u) => encodeURIComponent(u);

export function zones() {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC', 'Europe/Berlin', 'Europe/Istanbul', 'Europe/London', 'America/New_York', 'America/Los_Angeles']; }
}

export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function zoneSelect(value, onchange) {
  return h('select', { onchange }, zones().map((z) => h('option', { value: z, selected: z === value }, z.replace(/_/g, ' '))));
}

export const empty = (text, ...extra) => h('div', { class: 'empty' }, text, ...extra);

export const pill = (status, text = status[0].toUpperCase() + status.slice(1)) => h('span', { class: `pill ${status}` }, text);

export function copyButton(text, label = 'Copy') {
  return h('button', {
    class: 'ghost small', type: 'button',
    onclick: async (e) => {
      const btn = e.currentTarget;
      await navigator.clipboard.writeText(text).catch(() => prompt('Copy this:', text));
      btn.lastChild.textContent = 'Copied';
    },
  }, icon('copy', 14), h('span', {}, label));
}

export const card = (title, ...kids) => h('section', { class: 'card' }, title ? h('h3', { class: 'card-title' }, title) : null, ...kids);
