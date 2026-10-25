// Run: npm test
import assert from 'node:assert/strict';
import {
  stepTimes, dueStep, stepStatus, zonedToUtc, utcToZoned, nextWeekly, clock, parsePlaceId, salePrice, gameChecks, parseCatalog,
  taggedTitle, dueAnnouncements, fillTemplate, downsample, launchReport, deltaPlaying,
} from './lib.js';

const T = Date.parse('2026-10-24T16:00:00Z'); // 18:00 in Berlin (CEST)

// Countdown steps
const steps = stepTimes(T);
assert.equal(steps[0].at, T - 24 * 3600000);
assert.equal(dueStep(steps, T - 25 * 3600000), null);
assert.equal(dueStep(steps, T - 30 * 60000).key, 'm30');
assert.equal(dueStep(steps, T - 29 * 60000).key, 'm30');
assert.equal(dueStep(steps, T).key, 'now');
assert.equal(dueStep(steps, T + 3 * 3600000).key, 'back');
const st = stepStatus(steps, T - 20 * 60000);
assert.equal(st.m30, 'live');
assert.equal(st.h24, 'done');
assert.equal(st.m15, 'upcoming');
assert.deepEqual(stepTimes(T, ['h1', 'now']).map((s) => s.key), ['h1', 'now']);

// Time zones, including both DST edges
assert.equal(zonedToUtc('2026-10-24T18:00', 'Europe/Berlin'), T);
assert.equal(utcToZoned(T, 'Europe/Berlin'), '2026-10-24T18:00');
assert.equal(zonedToUtc('2026-10-25T18:00', 'Europe/Berlin'), Date.parse('2026-10-25T17:00:00Z')); // after DST ends
assert.equal(zonedToUtc('2026-03-29T12:00', 'Europe/Berlin'), Date.parse('2026-03-29T10:00:00Z')); // after DST starts
assert.equal(zonedToUtc('2026-10-24T18:00', 'America/New_York'), Date.parse('2026-10-24T22:00:00Z'));
assert.ok(Number.isNaN(zonedToUtc('nope', 'UTC')));

// Saturday 18:00 Berlin; from Friday it's the next day, from Saturday 19:00 it's next week
assert.equal(nextWeekly(6, '18:00', 'Europe/Berlin', Date.parse('2026-10-23T10:00:00Z')), T);
assert.equal(nextWeekly(6, '18:00', 'Europe/Berlin', T + 3600000), Date.parse('2026-10-31T17:00:00Z'));

assert.equal(clock(15 * 60000), '00:15:00');
assert.equal(clock(26 * 3600000 + 1000), '1d 02:00:01');

assert.equal(parsePlaceId('https://www.roblox.com/games/920587237/Adopt-Me'), '920587237');
assert.equal(parsePlaceId('https://www.roblox.com/tr/games/123/x'), '123');
assert.equal(parsePlaceId('12; drop'), null);

assert.equal(salePrice(99, 50), 50);
assert.equal(salePrice(25, 50), 13);
assert.equal(salePrice(1, 90), 1);

const checks = gameChecks(
  { name: '+1 Fishing', description: 'x', thumbnails: 2, updated: new Date(T - 3600000).toISOString() },
  { now: T, target: T, events: [{ title: 'W4 + HALLOWEEN EVENT', startTime: new Date(T).toISOString() }] },
);
assert.deepEqual(checks.map((c) => c.title), ['Only 2 thumbnails', 'Last update today', 'Event for the update: W4 + HALLOWEEN EVENT', 'Title has no update tag']);
assert.equal(gameChecks({ name: '[🎃] Game', description: 'x', thumbnails: 5, updated: '2026-01-01' }, { now: T }).length, 1);

assert.deepEqual(parseCatalog('Pet: Apollo, Zeus\nbad line\nEgg:  Gold Egg ,\nEmpty:'), { Pet: ['Apollo', 'Zeus'], Egg: ['Gold Egg'] });

// Autopilot
assert.equal(taggedTitle('[🎃] Adopt Me!', '[UPDATE]'), '[UPDATE] Adopt Me!');
assert.equal(taggedTitle('+1 Fishing', '[🎃 W4]'), '[🎃 W4] +1 Fishing');
assert.equal(taggedTitle('x'.repeat(60), '[NEW]').length, 50);
assert.deepEqual(dueAnnouncements(steps, ['h24', 'h1', 'now'], ['h24'], T - 61 * 60000).map((s) => s.key), []);
const due2 = dueAnnouncements(steps, ['h24', 'h1', 'now'], ['h24'], T - 55 * 60000);
assert.deepEqual(due2.map((s) => s.key), ['h1']);
assert.deepEqual(dueAnnouncements(steps, ['h24', 'h1'], [], T - 30 * 60000).map((s) => s.key), []); // h1 is 30 min stale
assert.equal(fillTemplate('{game} in {time} {x}', { game: 'G', time: '1h' }), 'G in 1h {x}');

// Stats
const S = (t, p, v = 0, f = 0, u = 0, d = 0) => [t, p, v, f, u, d];
const ds = downsample([S(1, 5), S(2, 9), S(3, 1), S(4, 2)], 2);
assert.deepEqual(ds.map((s) => [s[0], s[1]]), [[2, 9], [4, 2]]);
const H = 3600000;
const samples = [S(T - 20 * H, 100, 1000, 10, 80, 20), S(T - H, 200, 1100, 12, 80, 20), S(T + H, 600, 1500, 20, 90, 20), S(T + 2 * H, 400, 1700, 25, 95, 20)];
const rep = launchReport(samples, T);
assert.equal(rep.avgBefore, 150);
assert.equal(rep.peak, 600);
assert.equal(rep.lift, 300);
assert.equal(rep.visits, 600);
assert.equal(rep.favorites, 13);
assert.equal(rep.likeBefore, 80);
assert.equal(launchReport(samples.slice(0, 2), T), null);
assert.equal(deltaPlaying([S(0, 100), S(H, 150), S(25 * H, 150)]), 0);
assert.equal(deltaPlaying([S(0, 100), S(25 * H, 150)]), 50);

console.log('all tests passed');
