// Bring a Trailer completed auctions: real hammer prices for the enthusiast and exotic market.
// Uses the same JSON endpoint as BaT's own "results" pages. Polite: one request at a time.

const API = 'https://bringatrailer.com/wp-json/bringatrailer/1.0/data/listings-filter';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function resultsPage(make, page, perPage = 60) {
  const q = new URLSearchParams({ page: String(page), per_page: String(perPage), get_items: '1', get_stats: '0', sort: 'td' });
  q.set('base_filter[keyword_s]', make);
  q.set('base_filter[items_type]', 'make');
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(`${API}?${q}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return { items: Array.isArray(j.items) ? j.items : [], pages: j.pages_total || 0, total: j.items_total || 0 };
    } catch (e) {
      if (i >= 3) throw new Error(`BaT ${make} p${page}: ${e.message}`);
      await sleep(3000 * i);
    }
  }
}

const TWO_WORD = new Set(['land', 'range', 'grand', 'model', 'monte', 'el', 'gran', 'super', 'town', 'santa', 'cj', 'new']);
const ALIAS = { 'mp4-12c': '12C', 'mp412c': '12C' };

// "5k-Mile 2017 McLaren 570GT" -> { year: 2017, model: "570GT", trim: "", miles: 5000 }
// Returns null for parts, memorabilia, or a car of another make that matched the keyword.
export function parseTitle(title, makeNames) {
  const t = String(title || '').replace(/&#8217;|&rsquo;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const y = t.match(/\b(19[0-9]{2}|20[0-3][0-9])\b/);
  if (!y) return null;
  const year = Number(y[1]);
  if (year > new Date().getFullYear() + 1) return null;
  const after = t.slice(y.index + y[0].length).replace(/^\.5\b/, '').trim(); // "1985.5 Porsche 944"
  const make = makeNames.find((m) => after.toLowerCase().startsWith(m.toLowerCase() + ' '));
  if (!make) return null;
  const rest = after.slice(make.length).trim().split(' ');
  if (!rest[0]) return null;
  let n = 1;
  if (TWO_WORD.has(rest[0].toLowerCase()) && rest[1]) n = 2;
  let model = rest.slice(0, n).join(' ').replace(/[,;:]$/, '');
  model = ALIAS[model.toLowerCase()] || model;
  const trim = rest.slice(n).join(' ').replace(/\s*\(.*$/, '').trim();
  const before = t.slice(0, y.index);
  const mm = before.match(/([\d][\d,.]*)\s*(k)?-Mile/i);
  const miles = mm ? Math.round(parseFloat(mm[1].replace(/,/g, '')) * (mm[2] ? 1000 : 1)) : null;
  return { year, model, trim, miles };
}

export function parseItem(it, makeNames) {
  if (it.active) return null;
  if (it.currency && it.currency !== 'USD') return null;
  const st = String(it.sold_text || '').replace(/<[^>]+>/g, '');
  const sold = /^\s*Sold for/i.test(st);
  if (!sold && !/^\s*Bid to/i.test(st)) return null;
  const pm = st.match(/\$([\d,]+)/);
  const price = pm ? Number(pm[1].replace(/,/g, '')) : Number(it.current_bid) || 0;
  if (!price || price < 1500) return null;
  const p = parseTitle(it.title, makeNames);
  if (!p) return null;
  return {
    id: Number(it.id) || it.url,
    t: Number(it.sold_text_timestamp || it.timestamp_end) || 0,
    price, sold, ...p,
    title: String(it.title || '').slice(0, 140),
    url: typeof it.url === 'string' && it.url.startsWith('https://bringatrailer.com/') ? it.url : null,
  };
}
