// Craigslist search via the same JSON API the site's own search page uses.
// One call returns at most 360 results, so wide searches are split into price bands.

const API = 'https://sapi.craigslist.org/web/v8/postings/search/full';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const PAGE = 360;
const CAT_OWNER = 145; // cto; 146 = ctd (dealer)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      await sleep(1500 * i);
    }
  }
}

function field(item, tag) {
  const f = item.find((x) => Array.isArray(x) && x[0] === tag);
  return f ? f[1] : undefined;
}

function imageUrl(id) {
  // "3:00U0U_eAs0elKVFjQ_0CI0t2" -> https://images.craigslist.org/00U0U_eAs0elKVFjQ_0CI0t2_600x450.jpg
  if (typeof id !== 'string') return null;
  return `https://images.craigslist.org/${id.replace(/^\d+:/, '')}_600x450.jpg`;
}

function decodeItems(data) {
  const d = data.decode;
  if (!d || typeof d !== 'object') return [];
  return data.items.map((it) => {
    const [, latS, lonS] = String(it[4]).split('~');
    const locIdx = Number(String(it[4]).split(':')[0]);
    const loc = d.locations?.[locIdx];
    const host = Array.isArray(loc) ? loc[1] : null;
    const descIdx = Number(String(it[4]).split(':')[1]?.split('~')[0]);
    const firstImage = field(it, 4);
    const slug = field(it, 6);
    const viewId = field(it, 13);
    return {
      id: String(d.minPostingId + it[0]),
      posted: (d.minPostedDate + it[1]) * 1000,
      owner: it[2] === CAT_OWNER,
      price: it[3],
      title: it[it.length - 1],
      miles: field(it, 9) ?? null,
      lat: Number(latS) || null,
      lon: Number(lonS) || null,
      area: host,
      place: d.locationDescriptions?.[descIdx] || null,
      image: imageUrl(firstImage),
      url: slug && viewId ? `https://www.craigslist.org/view/d/${slug}/${viewId}` : null,
    };
  });
}

export async function search({ postal, radius, path = 'cta', minPrice, maxPrice, sort }) {
  const q = new URLSearchParams({
    batch: `1-0-${PAGE}-0-0`, cc: 'US', lang: 'en', searchPath: path,
    postal: String(postal), search_distance: String(radius),
  });
  if (minPrice != null) q.set('min_price', String(minPrice));
  if (maxPrice != null) q.set('max_price', String(maxPrice));
  if (sort) q.set('sort', sort);
  const json = await getJson(`${API}?${q}`);
  const loc = json.data.location;
  return { total: json.data.totalResultCount ?? 0, items: decodeItems(json.data), center: loc ? { lat: loc.lat, lon: loc.lon } : null };
}

// Every listing in range: bisect the price range until each band fits in one page.
export async function searchAll(opts, lo = 1, hi = 200000, depth = 0) {
  const r = await search({ ...opts, minPrice: lo, maxPrice: hi });
  await sleep(700);
  if (r.total <= PAGE || hi - lo < 50 || depth > 12) return r.items;
  const mid = Math.floor((lo + hi) / 2 / 50) * 50;
  const left = await searchAll(opts, lo, mid, depth + 1);
  const right = await searchAll(opts, mid + 1, hi, depth + 1);
  return left.concat(right);
}

// Structured fields from the listing page: title status, odometer, condition, body text.
export async function details(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return { gone: res.status === 404 || res.status === 410 };
  const html = await res.text();
  if (/This posting has been (deleted|flagged)|This posting has expired/i.test(html)) return { gone: true };
  const attr = (cls) => {
    const m = html.match(new RegExp(`class="attr ${cls}"[\\s\\S]*?class="valu"[^>]*>([\\s\\S]*?)</span>`));
    return m ? m[1].replace(/<[^>]+>/g, '').trim().toLowerCase() : null;
  };
  const mm = html.match(/class="valu makemodel"[^>]*>([\s\S]*?)<\/span>/);
  const body = (html.match(/<section id="postingbody">([\s\S]*?)<\/section>/)?.[1] || '')
    .replace(/<div class="print-information[\s\S]*?<\/div>\s*<\/div>/, '')
    .replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
  const odo = attr('auto_miles');
  return {
    gone: false,
    makemodel: mm ? mm[1].replace(/<[^>]+>/g, '').trim().toLowerCase() : null,
    year: Number(html.match(/class="valu year">(\d{4})</)?.[1]) || null,
    titleStatus: attr('auto_title_status'),
    condition: attr('condition'),
    miles: odo ? Number(odo.replace(/[^\d]/g, '')) || null : null,
    body,
  };
}
