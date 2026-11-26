// Phone push through ntfy.sh (free app, no account): set NTFY_TOPIC.
// Optional DISCORD_WEBHOOK posts the same alert to a channel.

// Tapping the alert opens the listing; `board` adds an "All deals" button.
export async function notify({ title, message, url, image, board }) {
  const topic = process.env.NTFY_TOPIC;
  const hook = process.env.DISCORD_WEBHOOK;
  if (!topic && !hook) throw new Error('set NTFY_TOPIC (or DISCORD_WEBHOOK) to get alerts');
  if (topic) {
    const res = await fetch(process.env.NTFY_SERVER || 'https://ntfy.sh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic, title, message, click: url, attach: image || undefined, tags: ['red_car'], priority: 4,
        actions: board ? [{ action: 'view', label: 'All deals', url: board }] : undefined,
      }),
    });
    if (!res.ok) throw new Error(`ntfy HTTP ${res.status}: ${await res.text()}`);
  }
  if (hook) {
    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [{ title, description: message, url, image: image ? { url: image } : undefined, color: 0xc9a227 }] }),
    });
    if (!res.ok) throw new Error(`discord HTTP ${res.status}`);
  }
}
