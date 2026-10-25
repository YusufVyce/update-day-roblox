// Discord webhook posts, with the current countdown icon attached.
const HOSTS = ['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com'];

export function validWebhook(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && HOSTS.includes(u.hostname) && /^\/api\/webhooks\/\d+\/[\w-]+$/.test(u.pathname);
  } catch {
    return false;
  }
}

export async function post(url, { content, title, link, jpeg }) {
  if (!validWebhook(url)) throw new Error('Not a Discord webhook URL.');
  const embed = { title, url: link, color: 0x6d5efc, ...(jpeg && { image: { url: 'attachment://icon.jpg' } }) };
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content, embeds: [embed], allowed_mentions: { parse: ['everyone', 'roles'] } }));
  if (jpeg) form.append('files[0]', new Blob([jpeg], { type: 'image/jpeg' }), 'icon.jpg');
  const r = await fetch(url, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`Discord said ${r.status}${r.status === 404 ? ' (webhook deleted?)' : ''}`);
}
