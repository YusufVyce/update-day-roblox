// App shell: sign-in, sidebar, home, game header, tabs and the ⌘K palette. URL hash is #/<universeId>/<tab>.
import { h, fill, $, api, toast, busy, state, zoneSelect, localZone, icon, copyButton, q } from './ui.js';
import { renderCountdown } from './countdown.js';
import * as T from './tabs.js';
import { sparkline } from './chart.js';
import { compact, shortDuration, parsePlaceId, stepTimes } from '../lib.js';

const TABS = [
  ['overview', 'Overview', 'overview', T.renderOverview],
  ['countdown', 'Countdown', 'hourglass', renderCountdown],
  ['analytics', 'Analytics', 'chart', T.renderAnalytics],
  ['events', 'Events', 'calendar', T.renderEvents],
  ['sale', 'Sale', 'tag', T.renderSale],
  ['players', 'Players', 'users', T.renderPlayers],
  ['timers', 'Timers', 'timer', T.renderTimers],
  ['game', 'Game page', 'globe', T.renderGamePage],
  ['settings', 'Settings', 'settings', T.renderSettings],
];

const app = $('#app');
const logo = () => h('span', { class: 'logo', 'aria-hidden': 'true' }, icon('hourglass', 16));
const brand = (big) => h('div', { class: big ? 'brand big' : 'brand' }, logo(), h('span', {}, 'Update Day'));
const robloxButton = (label = 'Continue with Roblox') => h('a', { class: 'button roblox big', href: `/api/oauth/start?tz=${q(localZone())}` }, icon('roblox', 18), label);

/* ---------- setup + login ---------- */

function setupScreen(s) {
  const step = (n, title, ...body) => h('li', {}, h('span', { class: 'num' }, n), h('div', {}, h('b', {}, title), ...body));
  fill(app, h('main', { class: 'center' }, h('div', { class: 'card setup' },
    brand(true),
    h('h2', {}, 'Finish setting up this site'),
    h('p', { class: 'muted' }, 'About five minutes, once. After that you and your team sign in with Roblox and pick games with one click.'),
    h('ol', { class: 'setup-steps' },
      s.storeReady ? null : step(1, 'Add a database', h('p', { class: 'muted' }, 'Vercel project → Storage → Create Database → Upstash for Redis → connect it to this project.')),
      step(2, 'Create a Roblox sign-in app',
        h('p', { class: 'muted' }, 'Creator Hub → ', h('a', { href: 'https://create.roblox.com/dashboard/credentials?activeTab=OAuthTab', target: '_blank', rel: 'noopener' }, 'OAuth 2.0 Apps'), ' → Create App. Then in the app:'),
        h('div', { class: 'copyrow' }, h('small', {}, 'Redirect URL'), h('code', {}, s.redirectUri), copyButton(s.redirectUri)),
        h('div', { class: 'copyrow' }, h('small', {}, 'Scopes (tick these)'), h('code', { class: 'wrap' }, s.scopes), copyButton(s.scopes))),
      step(3, 'Add environment variables', h('p', { class: 'muted' }, 'Vercel → Settings → Environment Variables:'),
        h('ul', { class: 'envs' },
          h('li', {}, h('code', {}, 'ROBLOX_CLIENT_ID'), ' and ', h('code', {}, 'ROBLOX_CLIENT_SECRET'), ' from step 2'),
          h('li', {}, h('code', {}, 'APP_SECRET'), ' any 32 random characters ', copyButton(randomSecret(), 'Copy one')),
          h('li', {}, h('code', {}, 'CRON_SECRET'), ' another 32 random characters ', copyButton(randomSecret(), 'Copy one')))),
      step(4, 'Redeploy', h('p', { class: 'muted' }, 'Deployments → ⋯ → Redeploy, then reload this page.'))),
    h('p', { class: 'muted small-note' }, 'No Roblox app? Set ADMIN_PASSWORD instead and add games with API keys.'))));
}

function randomSecret() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function loginScreen(s) {
  const pw = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password', required: true });
  const err = new URLSearchParams(location.hash.slice(1)).get('error');
  fill(app, h('main', { class: 'center login' }, h('div', { class: 'login-card' },
    brand(true),
    h('h1', {}, 'Run your update day on autopilot.'),
    h('p', { class: 'muted' }, 'Countdown icons, title tags, server restarts, sales, Discord posts and live stats. Set it once, then go play your own update.'),
    err ? h('p', { class: 'banner bad' }, icon('alert', 16), err) : null,
    s.oauthReady ? robloxButton() : null,
    s.passwordLogin ? h('form', {
      class: 'pw',
      onsubmit: (e) => {
        e.preventDefault();
        busy(e.submitter, async () => {
          await api('login', { password: pw.value });
          location.hash = '#/';
          boot();
        });
      },
    }, s.oauthReady ? h('small', { class: 'muted or' }, 'or with the site password') : null, pw, h('button', { class: s.oauthReady ? 'ghost' : 'primary', type: 'submit' }, 'Log in')) : null)));
}

/* ---------- add game ---------- */

function addGameDialog() {
  const s = state.session;
  const link = h('input', { placeholder: 'https://www.roblox.com/games/123456/My-Game', required: true });
  const key = h('input', { type: 'password', placeholder: 'Open Cloud API key', autocomplete: 'off' });
  const preview = h('div');
  let tz = localZone();
  let timer;
  link.oninput = () => {
    clearTimeout(timer);
    fill(preview);
    if (!parsePlaceId(link.value)) return;
    timer = setTimeout(async () => {
      try {
        const g = await api(`game?link=${encodeURIComponent(link.value.trim())}`);
        fill(preview, h('div', { class: 'mini-game' }, h('img', { src: g.icon || '', alt: '', width: 48, height: 48 }),
          h('div', {}, h('b', {}, g.name), h('small', { class: 'muted block' }, `${g.creatorType === 'Group' ? 'Group' : 'User'} game by ${g.creator} · ${compact(g.playing)} playing`))));
      } catch (e) { fill(preview, h('small', { class: 'bad' }, e.message)); }
    }, 400);
  };
  const viaRoblox = s.oauthReady && s.user?.uid !== 'admin';
  const dlg = h('dialog', { class: 'dialog' },
    h('h2', {}, 'Add a game'),
    viaRoblox ? h('div', { class: 'oauth-box' },
      h('p', {}, 'Roblox shows your games and groups. Tick the ones you want here; group games work too.'),
      robloxButton('Pick games on Roblox')) : null,
    h('details', { class: 'help', open: !viaRoblox },
      h('summary', {}, viaRoblox ? 'Or add one by link' : 'Add by link and API key'),
      h('form', {
        class: 'stack',
        onsubmit: (e) => {
          e.preventDefault();
          busy(e.submitter, async () => {
            const cfg = await api('games/add', { link: link.value, apiKey: key.value || undefined, timezone: tz });
            dlg.close();
            toast(`${cfg.name} added`);
            location.hash = `#/${cfg.universeId}/countdown`;
            boot();
          });
        },
      },
      h('label', {}, 'Game link or place ID', link), preview,
      h('label', {}, viaRoblox ? 'API key (only if your Roblox sign-in does not cover this game)' : 'API key', key),
      h('details', { class: 'help' }, h('summary', {}, 'How to make an API key'), T.keyHelp()),
      h('label', {}, 'Update time zone', zoneSelect(tz, (e) => { tz = e.target.value; })),
      h('div', { class: 'row end gap' }, h('button', { class: 'primary', type: 'submit' }, 'Add game')))),
    h('div', { class: 'row end' }, h('button', { class: 'link', type: 'button', onclick: () => dlg.close() }, 'Close')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

/* ---------- ⌘K palette ---------- */

function palette() {
  if ($('.palette')) return;
  const input = h('input', { placeholder: 'Jump to a game or tab…', 'aria-label': 'Search' });
  const list = h('ul');
  const all = [
    ...state.games.map((g) => ({ label: g.name, sub: 'Game', href: `#/${g.universeId}/${state.tab}` })),
    ...(state.cfg ? TABS.map(([id, label]) => ({ label, sub: state.cfg.name, href: `#/${state.cfg.universeId}/${id}` })) : []),
    { label: 'Home', sub: 'All games', href: '#/' },
  ];
  let sel = 0;
  const go = (it) => { location.hash = it.href; dlg.close(); };
  const draw = () => {
    const f = all.filter((i) => `${i.label} ${i.sub}`.toLowerCase().includes(input.value.toLowerCase())).slice(0, 8);
    sel = Math.min(sel, Math.max(0, f.length - 1));
    fill(list, f.map((it, i) => h('li', { class: i === sel ? 'on' : '', onclick: () => go(it) }, h('b', {}, it.label), h('small', {}, it.sub))));
    return f;
  };
  input.oninput = () => { sel = 0; draw(); };
  input.onkeydown = (e) => {
    const f = draw();
    if (e.key === 'ArrowDown') sel = Math.min(sel + 1, f.length - 1);
    else if (e.key === 'ArrowUp') sel = Math.max(sel - 1, 0);
    else if (e.key === 'Enter' && f[sel]) return go(f[sel]);
    else return;
    e.preventDefault();
    draw();
  };
  const dlg = h('dialog', { class: 'palette' }, h('div', { class: 'search' }, icon('search'), input), list);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
  document.body.append(dlg);
  dlg.showModal();
  draw();
}

addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && state.session?.authed) {
    e.preventDefault();
    palette();
  }
});

/* ---------- layout ---------- */

function route() {
  const [, u, tab] = location.hash.split('/');
  return { u: u || null, tab: TABS.some((t) => t[0] === tab) ? tab : 'overview' };
}

function nextUp(cfg) {
  const cd = cfg.countdown;
  const now = Date.now();
  if (!cd.target) return { text: 'No update planned', kind: 'idle' };
  if (!cd.active) return { text: cd.target > now ? 'Countdown not started' : 'Update released', kind: 'idle' };
  if (cd.target > now) {
    const next = stepTimes(cd.target, cd.steps).find((s) => s.at > now);
    return { text: `Live in ${shortDuration(cd.target - now)}${next && cd.icons ? ` · icon → ${next.label} in ${shortDuration(next.at - now)}` : ''}`, kind: 'soon' };
  }
  return { text: `Released ${shortDuration(now - cd.target)} ago`, kind: 'live' };
}

function cloudOk() {
  const s = state.session;
  return s.lastCron && Date.now() - s.lastCron < 180000;
}

function sidebar() {
  const u = state.session.user;
  return h('aside', { class: 'side' },
    h('a', { href: '#/', class: 'brand-link' }, brand()),
    h('button', { class: 'search-btn', onclick: palette }, icon('search', 15), h('span', {}, 'Search'), h('kbd', {}, 'Ctrl K')),
    h('a', { class: state.cfg ? 'nav' : 'nav on', href: '#/' }, icon('home', 16), 'Home'),
    h('small', { class: 'side-label' }, 'Games'),
    h('nav', { class: 'games' }, state.games.map((g) => {
      const n = nextUp(g);
      return h('a', { class: g.universeId === state.cfg?.universeId ? 'game on' : 'game', href: `#/${g.universeId}/${state.tab}` },
        h('img', { src: g.icon || '', alt: '', width: 34, height: 34 }),
        h('span', { class: 'grow' }, h('b', {}, g.name), h('small', { class: n.kind }, n.text)));
    })),
    h('button', { class: 'add', onclick: addGameDialog }, icon('plus', 15), 'Add game'),
    h('div', { class: 'grow' }),
    h('div', { class: cloudOk() ? 'cloud-status ok' : 'cloud-status' }, icon('cloud', 15), cloudOk() ? 'Cloud running' : 'Cloud offline'),
    u ? h('div', { class: 'me' },
      u.picture ? h('img', { src: u.picture, alt: '', width: 30, height: 30 }) : h('span', { class: 'avatar' }, (u.displayName || '?')[0]),
      h('span', { class: 'grow' }, h('b', {}, u.displayName), u.uid !== 'admin' ? h('small', {}, `@${u.name}`) : null),
      h('button', { class: 'icon-btn', title: 'Log out', 'aria-label': 'Log out', onclick: async () => { await api('logout', {}); location.hash = ''; location.reload(); } }, icon('logout', 16)))
      : null);
}

const content = h('div', { class: 'content' });
const header = h('header', { class: 'game-head' });

function drawHeader() {
  const cfg = state.cfg;
  const p = state.pub?.universeId === cfg.universeId ? state.pub : null;
  const n = nextUp(cfg);
  fill(header,
    h('img', { class: 'gicon', src: cfg.icon || '', alt: '', width: 64, height: 64 }),
    h('div', { class: 'grow' },
      h('h1', {}, cfg.name),
      h('div', { class: 'chips meta' },
        h('span', { class: 'chip-static' }, cfg.groupId ? 'Group game' : 'User game'),
        p ? h('span', { class: 'chip-static live' }, h('i', { class: 'pulse' }), `${compact(p.playing)} playing`) : null,
        p ? h('span', { class: 'chip-static' }, `${p.liked ?? '–'}% liked`) : null,
        p ? h('span', { class: 'chip-static' }, `${compact(p.visits)} visits`) : null,
        h('a', { class: 'chip-static', href: `https://www.roblox.com/games/${cfg.placeId}`, target: '_blank', rel: 'noopener' }, 'Open on Roblox ', icon('external', 12)))),
    h('div', { class: `next ${n.kind}` }, h('small', {}, 'Next up'), h('b', {}, n.text)));
}

function tabsBar() {
  return h('nav', { class: 'tabs', role: 'tablist' }, TABS.map(([id, label, ic]) => h('a', {
    role: 'tab', 'aria-selected': String(id === state.tab), class: id === state.tab ? 'on' : '', href: `#/${state.cfg.universeId}/${id}`,
  }, icon(ic, 15), label)));
}

const ctx = {
  get cfg() { return state.cfg; },
  update(cfg) {
    state.games = state.games.map((g) => (g.universeId === cfg.universeId ? cfg : g));
    state.cfg = cfg;
    render();
  },
  rerender: () => renderTab(),
  reload: async () => (await api('games')).find((g) => g.universeId === state.cfg.universeId),
};

function renderTab() {
  const tab = TABS.find((t) => t[0] === state.tab);
  Promise.resolve(tab[3](content, ctx)).catch((e) => toast(e.message, true));
}

async function home(main) {
  if (!state.games.length) {
    fill(main, h('div', { class: 'hero-empty' },
      h('div', { class: 'glow' }),
      h('h1', {}, 'Add your first game'),
      h('p', { class: 'muted' }, state.session.oauthReady && state.session.user?.uid !== 'admin'
        ? 'Pick your games on Roblox. Group games work too, as long as you can edit them.'
        : 'Paste the game link and an Open Cloud API key.'),
      state.session.oauthReady && state.session.user?.uid !== 'admin' ? robloxButton('Pick games on Roblox') : h('button', { class: 'primary big', onclick: addGameDialog }, 'Add game')));
    return;
  }
  const cards = state.games.map((g) => {
    const n = nextUp(g);
    const spark = h('div', { class: 'spark-slot' });
    T.loadStats(g.universeId, 1).then((s) => fill(spark, sparkline(s.slice(-240).map((x) => x[1]), 220, 44))).catch(() => {});
    const last = g.log[0];
    return h('a', { class: 'gcard', href: `#/${g.universeId}/overview` },
      h('div', { class: 'gcard-top' }, h('img', { src: g.icon || '', alt: '', width: 52, height: 52 }),
        h('div', { class: 'grow' }, h('b', {}, g.name), h('small', { class: 'muted' }, g.creator))),
      spark,
      h('div', { class: `next ${n.kind}` }, h('small', {}, 'Next up'), h('b', {}, n.text)),
      last ? h('small', { class: 'muted' }, `${last.text} · ${shortDuration(Date.now() - last.at)} ago`) : null);
  });
  fill(main,
    h('div', { class: 'home-head' }, h('div', {}, h('h1', {}, `Hi ${state.session.user?.displayName || ''}`.trim()),
      h('p', { class: 'muted' }, `${state.games.length} game${state.games.length > 1 ? 's' : ''} · ${cloudOk() ? 'the cloud is running' : 'the cloud is not running yet, see Settings'}`)),
    h('button', { class: 'primary', onclick: addGameDialog }, icon('plus', 15), 'Add game')),
    h('div', { class: 'gcards' }, cards));
}

function render() {
  const { u, tab } = route();
  state.tab = tab;
  state.cfg = u ? state.games.find((g) => g.universeId === u) || null : null;
  const main = h('main', { class: 'main' });
  fill(app, h('div', { class: 'layout' }, sidebar(), main));
  if (!state.cfg) return home(main);
  if (state.pub?.universeId !== state.cfg.universeId) {
    state.pub = null;
    api(`game?u=${state.cfg.universeId}`).then((g) => {
      state.pub = g;
      drawHeader();
      if (['countdown', 'overview'].includes(state.tab)) renderTab();
    }).catch(() => {});
  }
  drawHeader();
  fill(main, header, tabsBar(), content);
  renderTab();
}

addEventListener('hashchange', () => {
  if (!state.session?.authed) return;
  render();
  scrollTo(0, 0);
});

// Backup for the cron: while a dashboard is open it runs the same job every minute.
setInterval(async () => {
  if (!state.session?.authed || document.hidden) return;
  try {
    const r = await api('tick', {});
    state.session = await api('session');
    if (r.changed?.length) {
      state.games = await api('games');
      if (['countdown', 'sale', 'overview'].includes(state.tab) || !state.cfg) render();
    } else if (state.cfg) drawHeader();
  } catch { /* offline for a moment */ }
}, 60000);

async function boot() {
  try {
    state.session = await api('session');
  } catch (e) {
    fill(app, h('main', { class: 'center' }, h('div', { class: 'card' }, e.message)));
    return;
  }
  const s = state.session;
  if (!s.authReady || !s.storeReady) return setupScreen(s);
  if (!s.authed) return loginScreen(s);
  if (location.hash.startsWith('#error=')) {
    toast(decodeURIComponent(location.hash.slice(7)), true);
    location.hash = '#/';
  }
  state.games = await api('games');
  render();
}

boot();
