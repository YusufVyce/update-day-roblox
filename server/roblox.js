// Roblox web + Open Cloud calls. Open Cloud calls take `auth`: headers from creds.authFor()
// ({ 'x-api-key': ... } or { authorization: 'Bearer ...' }).
const OC = 'https://apis.roblox.com';

export class RobloxError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function request(url, { auth, method = 'GET', json, form } = {}) {
  const headers = { accept: 'application/json', ...auth };
  let body = form;
  if (json) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(json);
  }
  const r = await fetch(url, { method, headers, body });
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 200) }; }
  if (!r.ok) {
    const msg = data.message || data.errors?.[0]?.message || data.error || `HTTP ${r.status}`;
    throw new RobloxError(r.status, r.status === 401 || r.status === 403
      ? `Roblox said no (${msg}). Reconnect the game in Settings, or check the API key's permissions.`
      : `Roblox: ${msg}`);
  }
  return data;
}

const oc = (auth, path, opts) => request(OC + path, { ...opts, auth });

/* ---------- public, no auth ---------- */

export async function universeOf(placeId) {
  const { universeId } = await request(`${OC}/universes/v1/places/${placeId}/universe`);
  if (!universeId) throw new RobloxError(404, 'No game found for that place ID.');
  return String(universeId);
}

export async function publicGame(universeId) {
  const [games, icons, votes, media, lang] = await Promise.all([
    request(`https://games.roblox.com/v1/games?universeIds=${universeId}`),
    request(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&size=512x512&format=Png`).catch(() => null),
    request(`https://games.roblox.com/v1/games/votes?universeIds=${universeId}`).catch(() => null),
    request(`https://games.roblox.com/v2/games/${universeId}/media`).catch(() => null),
    request(`https://gameinternationalization.roblox.com/v1/source-language/games/${universeId}`).catch(() => null),
  ]);
  const g = games.data?.[0];
  if (!g) throw new RobloxError(404, 'No game found for that place ID.');
  const v = votes?.data?.[0];
  const images = (media?.data || []).filter((m) => m.assetType === 'Image' && m.approved);
  const shots = images.length
    ? await request(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${universeId}&countPerUniverse=1&size=768x432&format=Png`).catch(() => null)
    : null;
  return {
    universeId: String(universeId),
    placeId: String(g.rootPlaceId),
    name: g.name,
    description: g.description || '',
    creator: g.creator?.name,
    creatorType: g.creator?.type,
    creatorId: String(g.creator?.id ?? ''),
    playing: g.playing,
    visits: g.visits,
    favorites: g.favoritedCount,
    maxPlayers: g.maxPlayers,
    genre: g.genre_l1 || g.genre,
    updated: g.updated,
    icon: icons?.data?.[0]?.imageUrl || null,
    thumb: shots?.data?.[0]?.thumbnails?.[0]?.imageUrl || null,
    thumbnails: images.length,
    firstImageId: images[0]?.imageId || null,
    liked: v && v.upVotes + v.downVotes ? Math.round((v.upVotes / (v.upVotes + v.downVotes)) * 1000) / 10 : null,
    language: lang?.languageCode || 'en',
    url: `https://www.roblox.com/games/${g.rootPlaceId}`,
  };
}

// One request per API for many games: what the stats sampler stores every minute.
export async function statsFor(universeIds) {
  const ids = universeIds.join(',');
  const [games, votes] = await Promise.all([
    request(`https://games.roblox.com/v1/games?universeIds=${ids}`),
    request(`https://games.roblox.com/v1/games/votes?universeIds=${ids}`).catch(() => ({ data: [] })),
  ]);
  return Object.fromEntries((games.data || []).map((g) => {
    const v = votes.data?.find((x) => x.id === g.id);
    return [String(g.id), { playing: g.playing, visits: g.visits, favorites: g.favoritedCount, up: v?.upVotes ?? 0, down: v?.downVotes ?? 0 }];
  }));
}

export async function findUser(name) {
  const r = await request('https://users.roblox.com/v1/usernames/users', {
    method: 'POST', json: { usernames: [name], excludeBannedUsers: false },
  });
  const u = r.data?.[0];
  if (!u) throw new RobloxError(404, `No Roblox user called "${name}".`);
  const t = await request(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${u.id}&size=150x150&format=Png`).catch(() => null);
  return { id: String(u.id), name: u.name, displayName: u.displayName, avatar: t?.data?.[0]?.imageUrl || null };
}

/* ---------- Open Cloud ---------- */

export const universeInfo = (auth, u) => oc(auth, `/cloud/v2/universes/${u}`);

// EXPERIMENTAL endpoint. Changes the icon for the game's source language, which is the one players see by default.
export function setIcon(auth, u, lang, jpeg) {
  const form = new FormData();
  form.append('Files', new Blob([jpeg], { type: 'image/jpeg' }), 'icon.jpg');
  return oc(auth, `/legacy-game-internationalization/v1/game-icon/games/${u}/language-codes/${lang}`, { method: 'POST', form });
}

export const getPlace = (auth, u, p) => oc(auth, `/cloud/v2/universes/${u}/places/${p}`);
export const setPlace = (auth, u, p, fields) => oc(auth, `/cloud/v2/universes/${u}/places/${p}?updateMask=${Object.keys(fields).join(',')}`, { method: 'PATCH', json: fields });

async function all(auth, path, field) {
  const out = [];
  let page = '';
  do {
    const r = await oc(auth, `${path}?pageSize=100${page ? '&pageToken=' + encodeURIComponent(page) : ''}`);
    out.push(...(r[field] || []));
    page = r.nextPageToken;
  } while (page && out.length < 1000);
  return out;
}

export async function listItems(auth, u) {
  const [passes, products] = await Promise.all([
    all(auth, `/game-passes/v1/universes/${u}/game-passes/creator`, 'gamePasses'),
    all(auth, `/developer-products/v2/universes/${u}/developer-products/creator`, 'developerProducts'),
  ]);
  const map = (kind, idField) => (x) => ({
    kind, id: String(x[idField]), name: x.name, forSale: x.isForSale, price: x.priceInformation?.defaultPriceInRobux ?? null,
  });
  return [...passes.map(map('pass', 'gamePassId')), ...products.map(map('product', 'productId'))]
    .filter((x) => x.price != null);
}

export function setPrice(auth, u, item, price) {
  const form = new FormData();
  form.append('price', String(price));
  const path = item.kind === 'pass'
    ? `/game-passes/v1/universes/${u}/game-passes/${item.id}`
    : `/developer-products/v2/universes/${u}/developer-products/${item.id}`;
  return oc(auth, path, { method: 'PATCH', form });
}

export async function listEvents(auth, u) {
  const r = await oc(auth, `/virtual-events/v3/universes/${u}/game-events?pageSize=50&reverse=true`);
  return r.gameEvents || [];
}

export const createEvent = (auth, u, body) => oc(auth, `/virtual-events/v3/universes/${u}/game-events`, { method: 'POST', json: body });
export const deleteEvent = (auth, id) => oc(auth, `/virtual-events/v3/game-events/${id}`, { method: 'DELETE' });

const entry = (u, store, id) => `/cloud/v2/universes/${u}/data-stores/${encodeURIComponent(store)}/entries/${encodeURIComponent(id)}`;

export async function dsGet(auth, u, store, id) {
  try {
    const r = await oc(auth, entry(u, store, id));
    return { value: r.value ?? null, etag: r.etag };
  } catch (e) {
    if (e.status === 404) return { value: null, etag: null };
    throw e;
  }
}

export function dsSet(auth, u, store, id, value, etag) {
  return oc(auth, entry(u, store, id) + '?allowMissing=true', { method: 'PATCH', json: etag ? { value, etag } : { value } });
}

export const publish = (auth, u, topic, message) => oc(auth, `/cloud/v2/universes/${u}:publishMessage`, { method: 'POST', json: { topic, message } });

// bleedOff: stop matchmaking into old servers and let them empty out over `minutes`, instead of kicking everyone.
export const restartServers = (auth, u, minutes = 0) => oc(auth, `/cloud/v2/universes/${u}:restartServers`, {
  method: 'POST', json: minutes ? { bleedOffServers: true, bleedOffDurationMinutes: minutes } : {},
});
