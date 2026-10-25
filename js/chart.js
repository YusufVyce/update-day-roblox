// Players-over-time chart: one series, so no legend; the title names it.
// 2px line, faint area, recessive grid, crosshair + tooltip on hover, optional release marker.
import { h, svg } from './ui.js';
import { compact } from '../lib.js';

const W = 720;

export function playersChart(samples, { release, tz, height = 220 } = {}) {
  const H = height;
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  if (samples.length < 2) {
    return h('div', { class: 'chart-empty' }, 'Collecting data. The cloud stores a sample every minute, so the chart fills in over time.');
  }
  const t0 = samples[0][0];
  const t1 = samples.at(-1)[0];
  const max = Math.max(...samples.map((s) => s[1])) * 1.1 || 1;
  const x = (t) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
  const y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const pts = samples.map((s) => `${x(s[0]).toFixed(1)},${y(s[1]).toFixed(1)}`);

  const grid = [0, 0.5, 1].map((f) => {
    const v = max * f / 1.1;
    return svg('g', {}, svg('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid' }),
      svg('text', { x: pad.l - 8, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, compact(Math.round(v))));
  });
  const span = t1 - t0;
  const fmt = new Intl.DateTimeFormat('en-US', span > 7 * 86400000 ? { timeZone: tz, month: 'short', day: 'numeric' }
    : span > 1.5 * 86400000 ? { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric' }
      : { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + span * f).map((t, i) => svg('text', {
    x: x(t), y: H - 6, class: 'axis', 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle',
  }, fmt.format(t)));

  const marker = release && release > t0 && release < t1 ? svg('g', {},
    svg('line', { x1: x(release), x2: x(release), y1: pad.t, y2: H - pad.b, class: 'release' }),
    svg('text', { x: x(release) + 6, y: pad.t + 10, class: 'release-label' }, 'Update')) : null;

  const cross = svg('line', { y1: pad.t, y2: H - pad.b, class: 'cross', visibility: 'hidden' });
  const dot = svg('circle', { r: 4.5, class: 'dot', visibility: 'hidden' });
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `Players online, ${samples.length} samples, peak ${compact(Math.round(max / 1.1))}` },
    grid, ticks,
    svg('path', { d: `M${pts[0]} L${pts.join(' L')} L${x(t1)},${H - pad.b} L${x(t0)},${H - pad.b} Z`, class: 'area' }),
    svg('polyline', { points: pts.join(' '), class: 'line' }),
    marker, cross, dot);

  const tip = h('div', { class: 'tip', hidden: true });
  const full = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const wrap = h('div', { class: 'chart-wrap' }, chart, tip);

  chart.addEventListener('pointermove', (e) => {
    const r = chart.getBoundingClientRect();
    const t = t0 + ((((e.clientX - r.left) / r.width) * W - pad.l) / (W - pad.l - pad.r)) * span;
    let best = samples[0];
    for (const s of samples) if (Math.abs(s[0] - t) < Math.abs(best[0] - t)) best = s;
    const px = x(best[0]);
    cross.setAttribute('x1', px);
    cross.setAttribute('x2', px);
    dot.setAttribute('cx', px);
    dot.setAttribute('cy', y(best[1]));
    cross.setAttribute('visibility', 'visible');
    dot.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.replaceChildren(h('b', {}, best[1].toLocaleString('en-US'), ' playing'), h('small', {}, full.format(best[0])));
    const left = (px / W) * r.width;
    tip.style.left = `${Math.min(Math.max(left, 70), r.width - 70)}px`;
  });
  chart.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });
  return wrap;
}

export function sparkline(values, w = 120, hgt = 32) {
  if (values.length < 2) return h('span', { class: 'spark-empty' });
  const max = Math.max(...values) || 1;
  const min = Math.min(...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(hgt - 3 - ((v - min) / (max - min || 1)) * (hgt - 6)).toFixed(1)}`);
  return svg('svg', { viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, class: 'spark', 'aria-hidden': 'true' },
    svg('polyline', { points: pts.join(' ') }));
}
