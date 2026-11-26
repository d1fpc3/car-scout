#!/usr/bin/env node
// Car market tracker. Pulls every finished Bring a Trailer auction for the makes in market/makes.json
// (real hammer prices, sold or bid-to), keeps two years per make in market/sales/<make>.json, and
// writes the numbers the dashboard reads:
// Data files go to the orphan market-data branch (market.yml), never main:
//   market/summary.json         every make: sales, median, range, sell-through, 90-day change, monthly line
//   market/models/<make>.json   every model of that make: same, plus price by year, trims, recent sales
//   market/local.json           local Craigslist asking prices by model (aggregates only, from the scout pool)
//
//   node market.mjs                 update every make (first run backfills two years)
//   node market.mjs mclaren ferrari only these
//
// Everything here is public on GitHub, so local data is medians and counts only: no listings, links or deals.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resultsPage, parseItem } from './lib/bat.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const M = path.join(ROOT, 'market');
const DAY = 86400;
const KEEP_DAYS = 730, WINDOW_DAYS = 365, MAX_PAGES = 250;
const now = Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v)); };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------- stats ----------
function q(sorted, p) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo));
}
const monthOf = (t) => new Date(t * 1000).toISOString().slice(0, 7);

function stats(sales) {
  const win = sales.filter((s) => s.t >= now - WINDOW_DAYS * DAY);
  const sold = win.filter((s) => s.sold).map((s) => s.price).sort((a, b) => a - b);
  const recent = sales.filter((s) => s.sold && s.t >= now - 90 * DAY).map((s) => s.price).sort((a, b) => a - b);
  const prior = sales.filter((s) => s.sold && s.t < now - 90 * DAY && s.t >= now - 180 * DAY).map((s) => s.price).sort((a, b) => a - b);
  const m90 = q(recent, 0.5), mPrior = q(prior, 0.5);
  // Monthly median over the last 24 months (sold only).
  const byMonth = new Map();
  for (const s of sales) if (s.sold) { const m = monthOf(s.t); if (!byMonth.has(m)) byMonth.set(m, []); byMonth.get(m).push(s.price); }
  const monthly = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-24)
    .map(([m, ps]) => ({ m, median: q(ps.sort((a, b) => a - b), 0.5), n: ps.length }));
  return {
    n: win.length,
    sold: sold.length,
    sellThrough: win.length ? Math.round((sold.length / win.length) * 100) : null,
    median: q(sold, 0.5), mean: sold.length ? Math.round(sold.reduce((a, b) => a + b, 0) / sold.length) : null,
    p25: q(sold, 0.25), p75: q(sold, 0.75), low: sold[0] ?? null, high: sold[sold.length - 1] ?? null,
    median90: m90, change90: m90 && mPrior && recent.length >= 3 && prior.length >= 3 ? Math.round(((m90 - mPrior) / mPrior) * 1000) / 10 : null,
    monthly,
  };
}

const slim = (s) => ({ t: s.t, price: s.price, sold: s.sold, year: s.year, miles: s.miles, title: s.title, url: s.url });

function modelDetail(name, sales) {
  const st = stats(sales);
  const byYear = new Map();
  for (const s of sales) if (s.sold && s.t >= now - WINDOW_DAYS * DAY) { if (!byYear.has(s.year)) byYear.set(s.year, []); byYear.get(s.year).push(s.price); }
  const trims = new Map();
  for (const s of sales) if (s.sold && s.t >= now - WINDOW_DAYS * DAY) { const k = s.trim || '(base)'; if (!trims.has(k)) trims.set(k, []); trims.get(k).push(s.price); }
  return {
    key: slug(name), name, ...st,
    byYear: [...byYear.entries()].sort(([a], [b]) => a - b).map(([year, ps]) => ({ year, median: q(ps.sort((a, b) => a - b), 0.5), n: ps.length })),
    trims: [...trims.entries()].map(([trim, ps]) => ({ trim, n: ps.length, median: q(ps.sort((a, b) => a - b), 0.5) }))
      .sort((a, b) => b.n - a.n).slice(0, 12),
    points: sales.filter((s) => s.sold).slice(0, 600).map((s) => [s.year, s.price, s.t, s.miles]),
    recent: sales.slice(0, 12).map(slim),
    top: sales.filter((s) => s.sold && s.t >= now - WINDOW_DAYS * DAY).sort((a, b) => b.price - a.price).slice(0, 3).map(slim),
  };
}

// ---------- fetch ----------
async function updateMake(mk) {
  const file = path.join(M, 'sales', `${mk.key}.json`);
  const have = readJson(file, []);
  const known = new Set(have.map((s) => s.id));
  const fresh = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await resultsPage(mk.name, page);
    await sleep(900);
    let newOnPage = 0, oldest = Infinity;
    for (const it of r.items) {
      const s = parseItem(it, mk.titles);
      const t = Number(it.sold_text_timestamp || it.timestamp_end) || now;
      oldest = Math.min(oldest, t);
      if (!s) continue;
      if (!known.has(s.id)) { known.add(s.id); fresh.push(s); newOnPage++; }
    }
    // Newest first: stop at a page with nothing new (after the first), past the window, or at the end.
    if (!r.items.length || page >= r.pages || oldest < now - KEEP_DAYS * DAY || (have.length && newOnPage === 0)) break;
  }
  const all = [...fresh, ...have].filter((s) => s.t >= now - KEEP_DAYS * DAY).sort((a, b) => b.t - a.t);
  writeJson(file, all);
  return { all, fresh: fresh.length };
}

function build(mk, all) {
  const groups = new Map();
  for (const s of all) { const k = slug(s.model); if (!groups.has(k)) groups.set(k, { name: s.model, sales: [] }); groups.get(k).sales.push(s); }
  const models = [...groups.values()].map((g) => modelDetail(g.name, g.sales))
    .filter((m) => m.n >= 2).sort((a, b) => b.n - a.n);
  writeJson(path.join(M, 'models', `${mk.key}.json`), { updated: now, make: mk.name, models });
  const st = stats(all);
  return {
    key: mk.key, name: mk.name, tier: mk.tier, ...st,
    models: models.length,
    topModels: models.slice(0, 6).map((m) => ({ key: m.key, name: m.name, n: m.n, median: m.median, change90: m.change90 })),
    topSale: all.filter((s) => s.sold && s.t >= now - WINDOW_DAYS * DAY).sort((a, b) => b.price - a.price).slice(0, 1).map(slim)[0] || null,
  };
}

// ---------- local asking prices (aggregates from the scout's comps pool) ----------
function local() {
  const state = readJson(path.join(ROOT, 'data', 'state.json'), null);
  if (!state?.listings) return null;
  const g = new Map();
  for (const l of Object.values(state.listings)) {
    if (!l.make || !l.model || l.hard || !l.price || l.price < 1000) continue;
    const k = `${l.make}|${l.model}`;
    if (!g.has(k)) g.set(k, { make: l.make, model: l.model, prices: [], miles: [], years: [] });
    const x = g.get(k); x.prices.push(l.price); if (l.miles) x.miles.push(l.miles); if (l.year) x.years.push(l.year);
  }
  const rows = [...g.values()].filter((x) => x.prices.length >= 5).map((x) => {
    const p = x.prices.sort((a, b) => a - b), mi = x.miles.sort((a, b) => a - b), yr = x.years.sort((a, b) => a - b);
    return { make: x.make, model: x.model, n: p.length, median: q(p, 0.5), p25: q(p, 0.25), p75: q(p, 0.75), medianMiles: q(mi, 0.5), medianYear: q(yr, 0.5) };
  }).sort((a, b) => b.n - a.n);
  return { updated: now, area: 'within 150 miles of Baltimore (Craigslist asking prices)', rows };
}

async function main() {
  const makes = readJson(path.join(M, 'makes.json'), []);
  const only = process.argv.slice(2).map((s) => s.toLowerCase());
  const prev = readJson(path.join(M, 'summary.json'), { makes: [] });
  const out = new Map(prev.makes.map((m) => [m.key, m]));
  for (const mk of makes) {
    if (only.length && !only.includes(mk.key)) continue;
    try {
      const { all, fresh } = await updateMake(mk);
      out.set(mk.key, build(mk, all));
      console.log(`${mk.name}: +${fresh} (${all.length} kept)`);
    } catch (e) { console.warn(`${mk.name}: ${e.message}`); }
  }
  const list = makes.map((mk) => out.get(mk.key)).filter(Boolean);
  writeJson(path.join(M, 'summary.json'), { updated: now, windowDays: WINDOW_DAYS, source: 'Bring a Trailer completed auctions', makes: list });
  // Every model of every make in one small file, for the dashboard's search.
  const index = [];
  for (const mk of makes) {
    const d = readJson(path.join(M, 'models', `${mk.key}.json`), null);
    for (const m of d?.models || []) index.push({ make: mk.key, makeName: mk.name, key: m.key, name: m.name, n: m.n, median: m.median, change90: m.change90 });
  }
  writeJson(path.join(M, 'index.json'), { updated: now, models: index });
  const loc = local();
  if (loc) writeJson(path.join(M, 'local.json'), loc);
  console.log(`summary: ${list.length} makes${loc ? `, local: ${loc.rows.length} models` : ''}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
