// Key/value storage. Upstash Redis over its REST API when configured (the Vercel Marketplace
// integration sets KV_REST_API_* or UPSTASH_REDIS_REST_*), otherwise a JSON file for local dev.
import { readFile, writeFile } from 'node:fs/promises';

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// On Vercel the file system is read-only, so a database is required there.
export const storeReady = Boolean(url && token) || !process.env.VERCEL;

async function redis(...cmd) {
  const r = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error('Database error: ' + j.error);
  return j.result;
}

const FILE = new URL('../.data.json', import.meta.url);
let mem;
async function file() {
  if (!mem) {
    try { mem = JSON.parse(await readFile(FILE, 'utf8')); } catch { mem = {}; }
  }
  return mem;
}
const flush = () => writeFile(FILE, JSON.stringify(mem));

export async function get(key) {
  if (url) {
    const v = await redis('GET', key);
    return v == null ? null : JSON.parse(v);
  }
  // A copy, like Redis would return: callers mutate what they get.
  const v = (await file())[key];
  return v == null ? null : structuredClone(v);
}

export async function set(key, value, seconds) {
  if (url) return seconds ? redis('SET', key, JSON.stringify(value), 'EX', seconds) : redis('SET', key, JSON.stringify(value));
  (await file())[key] = structuredClone(value); // ponytail: no expiry locally
  await flush();
}

export async function del(key) {
  if (url) return redis('DEL', key);
  delete (await file())[key];
  await flush();
}

// Read and delete in one step, so two game servers can't both claim the same gifts.
export async function take(key) {
  if (url) {
    const v = await redis('GETDEL', key);
    return v == null ? null : JSON.parse(v);
  }
  const v = (await file())[key] ?? null;
  delete mem[key];
  await flush();
  return v;
}

// Append-only lists for stats samples.
export async function push(key, value, seconds) {
  if (url) {
    await redis('RPUSH', key, JSON.stringify(value));
    if (seconds) await redis('EXPIRE', key, seconds);
    return;
  }
  ((await file())[key] ||= []).push(value);
  await flush();
}

export async function range(key) {
  if (url) return ((await redis('LRANGE', key, 0, -1)) || []).map((s) => JSON.parse(s));
  return (await file())[key] || [];
}

// Returns false if someone else holds the lock. ponytail: always true locally, one dev server is one process.
export async function lock(key, seconds) {
  if (!url) return true;
  return (await redis('SET', key, '1', 'NX', 'EX', seconds)) === 'OK';
}

export async function hit(key, seconds) {
  if (!url) return 1;
  const n = await redis('INCR', key);
  if (n === 1) await redis('EXPIRE', key, seconds);
  return n;
}
