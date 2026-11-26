// What's for sale right now, nationwide: Craigslist asking prices for the market's main models.
// One Craigslist search only reaches the ~80 city sites nearest its zip, so the country is covered by
// regional hubs and the results are merged by listing id. Listings that vanish between daily runs are
// counted as gone (sold or pulled), which gives days-to-sell. Public repo: only hashed ids and aggregates
// are ever written, never links, titles or anything that points at one car.

import crypto from 'node:crypto';
import { search } from './craigslist.mjs';
import { isPart } from './bat.mjs';
import { genOf, slug } from './gens.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = 360;

// [zip, radius in miles, label]: each stays under the ~80-site cap and together they cover the lower 48.
export const HUBS = [
  ['10001', 300, 'New York'], ['28202', 300, 'Charlotte'], ['32801', 300, 'Orlando'], ['37203', 300, 'Nashville'],
  ['43215', 250, 'Columbus'], ['60601', 300, 'Chicago'], ['55401', 400, 'Minneapolis'], ['64105', 350, 'Kansas City'],
  ['75201', 300, 'Dallas'], ['80202', 500, 'Denver'], ['85004', 350, 'Phoenix'], ['90012', 250, 'Los Angeles'],
  ['94103', 300, 'San Francisco'], ['98101', 350, 'Seattle'],
];

// Names a seller would type. Model-only searches for names that only mean one car.
const QUERY = {
  'mx-5': 'miata|mx5|"mx-5"', 'e-type': '"e-type"|xke|"e type"', 'land-cruiser': '"land cruiser"', 'range-rover': '"range rover"',
  corvette: 'corvette', camaro: 'camaro', mustang: 'mustang', bronco: 'bronco', wrangler: 'wrangler', supra: 'supra', viper: 'viper',
  chevelle: 'chevelle', thunderbird: 'thunderbird', firebird: 'firebird', challenger: 'challenger', '4runner': '4runner',
  defender: '"land rover" defender', s2000: 's2000', skyline: 'skyline', cayenne: 'cayenne', boxster: 'boxster', cayman: 'cayman',
  panamera: 'panamera', gallardo: 'gallardo', huracan: 'huracan', urus: 'urus', 'grand-wagoneer': '"grand wagoneer"',
};
const MAKE_WORD = { 'mercedes-benz': 'mercedes', chevrolet: 'chevy|chevrolet', 'land-rover': '"land rover"', 'aston-martin': '"aston martin"', 'rolls-royce': '"rolls royce"|rolls-royce', 'alfa-romeo': '"alfa romeo"' };
// The title has to name the model itself.
const TOKEN = { 'mx-5': /\b(miata|mx-?5)\b/i, 'e-type': /\b(e-?type|xke)\b/i, '4runner': /\b4\s?runner\b/i };

// Work trucks, minibikes and names that match everything: their Craigslist asks aren't the BaT car.
const SKIP = new Set(['f-150', 'f-250', 'f-350', 'f-450', 'f-550', 'silverado', 'sierra', 'ram', 'tundra', 'sprinter', 'suburban', 'tahoe',
  'pickup', 'series', 'power-wagon', 'sport', 'm', 'v8', 'v12', 'gt', 'chevy', 'deluxe', 'super', 'acty', 'ct70', 'atc', 'z50a', 'model-a', 'model-t', 'c10', 'k5', '3100', 'k10', 'econoline', 'e-350', 'excursion', 'sambar']);

const JUNK = /\b(parts|part out|parting|wanted|wtb|iso|looking for|lease takeover|lease|for rent|rental|wheels|rims|tires|seats only|engine only|motor only|hood|bumper|headlights?|taillights?|shell only|roller only|trade only)\b/i;

const q = (s, p) => { if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return Math.round(s[lo] + (s[hi] - s[lo]) * (i - lo)); };
const med = (a) => q(a.slice().sort((x, y) => x - y), 0.5);
const hash = (id) => crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 12);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The model years that actually sell on BaT (5th to 95th percentile of last year's sales). A 2012 Impala
// commuter isn't the 1964 Impala the auctions price, so asking prices outside this span are left out.
function yearSpan(byYear) {
  const ys = (byYear || []).filter((b) => b.year && b.n).sort((a, b) => a.year - b.year);
  const total = ys.reduce((a, b) => a + b.n, 0);
  if (total < 10) return null;
  let acc = 0, lo = null, hi = null;
  for (const b of ys) { acc += b.n; if (lo == null && acc >= total * 0.05) lo = b.year; if (hi == null && acc >= total * 0.95) hi = b.year; }
  return [lo, hi];
}

export function targets(makes, modelsByMake, { minSales = 30, perMake = 5 } = {}) {
  const out = [];
  for (const mk of makes) {
    const models = (modelsByMake[mk.key] || []).filter((m) => m.n >= minSales && !SKIP.has(m.key)).slice(0, perMake);
    for (const m of models) {
      const word = MAKE_WORD[mk.key] || mk.name.toLowerCase();
      // Shelby's "Mustang" is the Shelby, not every Mustang.
      const shelby = mk.key === 'shelby';
      const query = shelby ? 'shelby' : QUERY[m.key] || `(${word}) "${m.name.toLowerCase()}"`;
      const token = shelby ? /\bshelby\b/i : TOKEN[m.key] || new RegExp(`\\b${esc(m.name).replace(/-/g, '[-\\s]?')}\\b`, 'i');
      out.push({ make: mk.key, makeName: mk.name, model: m.key, name: m.name, query, token, span: yearSpan(m.byYear) });
    }
  }
  return out;
}

// One hub, one model: split by price when a band overflows a page, at most `depth` levels deep.
async function hubSearch(zip, radius, query, lo = 1500, hi = 5000000, depth = 0) {
  const r = await search({ postal: zip, radius, path: 'cta', query, minPrice: lo, maxPrice: hi });
  await sleep(500);
  if (r.total <= PAGE) return { items: r.items, complete: true };
  if (depth >= 2) return { items: r.items, complete: false };
  const mid = depth === 0 ? Math.max(lo + 1, Math.min(hi - 1, 30000)) : Math.floor((lo + hi) / 2);
  const a = await hubSearch(zip, radius, query, lo, mid, depth + 1);
  const b = await hubSearch(zip, radius, query, mid + 1, hi, depth + 1);
  return { items: a.items.concat(b.items), complete: a.complete && b.complete };
}

export function keep(item, token, span) {
  const t = String(item.title || '');
  if (!item.price || item.price < 1500 || item.price > 6e6) return null;
  if (JUNK.test(t) || isPart(t) || !token.test(t)) return null;
  const y = t.match(/\b(19[2-9]\d|20[0-3]\d)\b/);
  const year = y ? Number(y[1]) : null;
  if (year && year > new Date().getFullYear() + 1) return null;
  if (span && (!year || year < span[0] || year > span[1])) return null;
  return { id: item.id, price: item.price, year, miles: item.miles || null, owner: !!item.owner, posted: item.posted, title: t };
}

function agg(list, now) {
  if (!list.length) return null;
  const p = list.map((l) => l.price).sort((a, b) => a - b);
  const mi = list.map((l) => l.miles).filter((x) => x > 100 && x < 999999);
  const yr = list.map((l) => l.year).filter(Boolean);
  return {
    n: list.length, owner: Math.round((list.filter((l) => l.owner).length / list.length) * 100),
    median: q(p, 0.5), p25: q(p, 0.25), p75: q(p, 0.75), low: p[0], high: p[p.length - 1],
    miles: mi.length ? med(mi) : null, year: yr.length ? med(yr) : null,
    age: med(list.map((l) => Math.max(0, (now - l.posted / 1000) / 86400))),
  };
}

// state: { since, last, ids: { hash: [firstSeen, lastSeen, price, key] }, gone: [[t, key, days, price]] }
export async function forSale({ makes, modelsByMake, gens, state, log = () => {} }) {
  const now = Math.floor(Date.now() / 1000);
  const st = state && state.ids ? state : { since: now, last: 0, ids: {}, gone: [] };
  const list = targets(makes, modelsByMake);
  const rows = [];
  const touchedKeys = new Set();
  // Three models at a time (about three requests a second overall), each walking the hubs in turn.
  const queue = list.slice();
  await Promise.all([1, 2, 3].map(async () => { for (let tg; (tg = queue.shift());) await one(tg); }));

  async function one(tg) {
    const seen = new Map();
    let complete = true, failed = 0;
    for (const [zip, radius] of HUBS) {
      try {
        const r = await hubSearch(zip, radius, tg.query);
        complete &&= r.complete;
        for (const it of r.items) if (!seen.has(it.id)) { const k = keep(it, tg.token, tg.span); if (k) seen.set(it.id, k); }
      } catch (e) { failed++; complete = false; log(`  ${tg.makeName} ${tg.name} @${zip}: ${e.message}`); }
    }
    if (failed === HUBS.length) return;
    // The same car reposted in several cities: one per title + price.
    const uniq = new Map();
    for (const l of seen.values()) { const k = l.title.toLowerCase().replace(/[^a-z0-9]/g, '') + '|' + l.price; if (!uniq.has(k)) uniq.set(k, l); }
    const cars = [...uniq.values()];
    const gl = gens?.[tg.make]?.[tg.model];
    for (const c of cars) c.gen = genOf(gl, c.year, c.title);
    const base = `${tg.make}|${tg.model}`;
    for (const c of cars) {
      const h = hash(c.id), key = `${base}|${c.gen || ''}`;
      const was = st.ids[h];
      st.ids[h] = [was ? was[0] : now, now, c.price, key];
    }
    if (complete) touchedKeys.add(base);
    if (!cars.length) return;
    const row = { make: tg.make, model: tg.model, name: tg.name, complete, span: tg.span, ...agg(cars, now) };
    if (gl) {
      row.gens = {};
      for (const g of gl) { const a = agg(cars.filter((c) => c.gen === g.key), now); if (a && a.n >= 3) row.gens[g.key] = a; }
    }
    rows.push(row);
    log(`${tg.makeName} ${tg.name}: ${cars.length} listed${complete ? '' : ' (sampled)'}`);
  }
  rows.sort((a, b) => list.findIndex((t) => t.make === a.make && t.model === a.model) - list.findIndex((t) => t.make === b.make && t.model === b.model));
  // Gone: seen last run, missing now, for models searched completely this run (a capped search would fake it).
  for (const [h, v] of Object.entries(st.ids)) {
    const base = v[3].split('|').slice(0, 2).join('|');
    if (v[1] === now) continue;
    if (touchedKeys.has(base) && st.last && v[1] >= st.last) {
      st.gone.push([now, v[3], Math.max(0, Math.round((v[1] - v[0]) / 86400)), v[2]]);
      delete st.ids[h];
    } else if (now - v[1] > 21 * 86400) delete st.ids[h]; // not seen for three weeks: forget it
  }
  st.gone = st.gone.filter((g) => now - g[0] <= 60 * 86400);
  const firstRun = !st.last;
  st.last = now;
  // Sell speed per model and generation over the last 30 days.
  const gone30 = st.gone.filter((g) => now - g[0] <= 30 * 86400);
  for (const r of rows) {
    const base = `${r.make}|${r.model}`;
    const mine = gone30.filter((g) => g[1].startsWith(base + '|'));
    r.gone30 = mine.length; r.goneDays = mine.length >= 3 ? med(mine.map((g) => g[2])) : null; r.goneAsk = mine.length >= 3 ? med(mine.map((g) => g[3])) : null;
    for (const [gk, a] of Object.entries(r.gens || {})) {
      const g = mine.filter((x) => x[1] === `${base}|${gk}`);
      a.gone30 = g.length; a.goneDays = g.length >= 3 ? med(g.map((x) => x[2])) : null;
    }
  }
  return {
    out: { updated: now, since: st.since, firstRun, hubs: HUBS.length, source: 'Craigslist asking prices, nationwide (14 regional searches merged)', models: rows },
    state: st,
  };
}

export { slug };
