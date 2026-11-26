#!/usr/bin/env node
// Car flip scout: watches Craigslist cars near you, values each one against comparable
// listings, and pushes the underpriced private-seller ones to your phone.
//
//   node scout.mjs            normal run (alerts on)
//   node scout.mjs --dry      no alerts, just print
//   node scout.mjs --full     force a full comps refresh

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { search, searchAll, details } from './lib/craigslist.mjs';
import { parseTitle, hardFlag, softFlags } from './lib/parse.mjs';
import { buildModels, valueOf } from './lib/value.mjs';
import { notify } from './lib/notify.mjs';
import { renderBoard, ROBOTS, money, cap } from './lib/board.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(ROOT, 'data', 'state.json');
const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const now = Date.now();
const HOUR = 3600e3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { listings: {}, alerted: {}, lastFull: 0 }; }
}

function merge(state, items) {
  let fresh = 0;
  for (const it of items) {
    const prev = state.listings[it.id];
    if (!prev) fresh++;
    const p = parseTitle(it.title);
    state.listings[it.id] = {
      ...prev, ...it, ...p,
      miles: realMiles(it.miles) ?? prev?.miles ?? null,
      hard: hardFlag(it.title),
      firstSeen: prev?.firstSeen ?? now,
      lastSeen: now,
      firstPrice: prev?.firstPrice ?? it.price,
    };
  }
  return fresh;
}

function miles(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 7918 * Math.asin(Math.sqrt(h));
}

// Sellers type 0 or 1 when they don't know; treat those as unknown.
const realMiles = (m) => (m && m >= 1000 ? m : null);

function dealMath(l, v) {
  const profit = v.low - l.price;
  const pct = l.price / v.value;
  // Below minPctOfValue it's almost always a scam, a typo, or a car with a story.
  return { profit, pct, ok: profit >= cfg.buy.minProfit && pct <= cfg.buy.maxPctOfValue && pct >= cfg.buy.minPctOfValue };
}

async function main() {
  const state = loadState();
  const area = { postal: cfg.postal, radius: cfg.radius };
  const full = args.has('--full') || now - (state.lastFull || 0) > cfg.fullRefreshHours * HOUR;

  // Newest listings every run (also gives the search center); the whole area once a day.
  const [newest, owners] = [
    await search({ ...area, path: 'cta', sort: 'date' }),
    await search({ ...area, path: 'cto', sort: 'date', minPrice: cfg.buy.minPrice, maxPrice: cfg.buy.maxPrice }),
  ];
  if (newest.center) state.center = newest.center;
  let fresh = merge(state, newest.items) + merge(state, owners.items);
  if (full) {
    // Comps come from a wider circle than you'd drive to buy: more cars, more models valued.
    const all = await searchAll({ ...area, radius: cfg.compsRadius, path: 'cta' });
    fresh += merge(state, all);
    state.lastFull = now;
    console.log(`full refresh: ${all.length} listings within ${cfg.compsRadius} mi`);
  } else {
    console.log(`incremental: ${newest.items.length + owners.items.length} listings (${newest.total} in area)`);
  }

  for (const [id, l] of Object.entries(state.listings)) {
    if (now - l.lastSeen > cfg.keepDays * 86400e3) delete state.listings[id];
  }
  for (const [id, a] of Object.entries(state.alerted)) {
    if (now - (a.at || 0) > cfg.keepDays * 86400e3) delete state.alerted[id];
  }

  const listings = Object.values(state.listings);
  const models = buildModels(listings);
  console.log(`${listings.length} listings in comps pool, ${models.size} models valued, ${fresh} new`);

  // Cheap screen on search data, best first.
  const screened = [];
  for (const l of listings) {
    if (cfg.buy.ownerOnly && !l.owner) continue;
    if (l.price < cfg.buy.minPrice || l.price > cfg.buy.maxPrice || l.hard || l.gone) continue;
    const dist = state.center && l.lat ? miles(state.center, l) : null;
    if (dist != null && dist > cfg.radius) continue;
    if (now - l.posted > cfg.buy.maxAgeHours * HOUR || now - l.lastSeen > 26 * HOUR) continue;
    const v = valueOf(models, l);
    if (!v) continue;
    const d = dealMath(l, v);
    if (d.ok) screened.push({ l, v, dist, ...d });
  }
  screened.sort((a, b) => b.profit - a.profit);

  // Confirm on the listing page: clean title, real odometer, no deal-killers in the text.
  const deals = [];
  for (const s of screened.slice(0, cfg.maxDetailChecks)) {
    const { l, dist } = s;
    if (!l.detail || now - l.detail.at > 12 * HOUR) {
      try { l.detail = { ...(await details(l.url)), at: now }; } catch (e) { console.warn(`details failed${process.env.QUIET ? '' : ` ${l.url}`}: ${e.message}`); continue; }
      await sleep(800);
    }
    const det = l.detail;
    if (det.gone) { l.gone = true; continue; }
    if (det.titleStatus && det.titleStatus !== 'clean') continue;
    const text = `${l.title}\n${det.body || ''}`;
    if (hardFlag(text)) continue;
    const miles = realMiles(det.miles) || l.miles;
    const v = valueOf(models, { ...l, miles, year: det.year || l.year });
    if (!v) continue;
    const d = dealMath({ ...l }, v);
    if (!d.ok) continue;
    deals.push({ ...l, dist, miles, value: v.value, low: v.low, comps: v.comps, estMiles: v.estMiles, profit: d.profit, pct: d.pct, flags: softFlags(text), condition: det.condition });
  }

  // Alert new deals, and old ones again only after a real price drop.
  // The same car crossposted in two towns counts once (same year/model/odometer).
  let sent = 0;
  // "All deals" button on each alert. The passphrase rides in the #fragment, which browsers never send to a server.
  const pass = process.env.BOARD_PASSPHRASE;
  const boardLink = pass && process.env.BOARD_URL ? `${process.env.BOARD_URL}#k=${encodeURIComponent(pass)}` : null;
  const carKey = (d) => `${d.year}|${d.make}|${d.model}|${d.miles ? Math.round(d.miles / 1000) : d.id}`;
  const alertedCars = new Set(Object.values(state.alerted).map((a) => a.car).filter(Boolean));
  for (const d of deals) {
    const prev = state.alerted[d.id];
    if (prev && d.price > prev.price - cfg.realertDrop) continue;
    if (!prev && alertedCars.has(carKey(d))) continue;
    if (sent >= cfg.maxAlertsPerRun) break;
    const dropped = prev ? ` (dropped from ${money(prev.price)})` : '';
    const title = `${money(d.profit - (cfg.flipCost || 0))} profit · ${d.year} ${cap(d.make)} ${cap(d.model)}`;
    const lines = [
      `${money(d.price)}${dropped} asking, worth about ${money(d.low)}`,
      `${d.miles ? `${Math.round(d.miles / 1000)}k mi${d.estMiles ? ' (est)' : ''}` : 'miles unknown'} · ${d.place || d.area || ''}`.trim(),
      d.title,
      d.flags.length ? `Says: ${d.flags.join(', ')}` : null,
      `${d.comps} comps · posted ${ago(d.posted)}`,
    ].filter(Boolean);
    if (DRY) console.log(`[dry] would alert: ${title}`);
    else {
      try { await notify({ title, message: lines.join('\n'), url: d.url, image: d.image, board: boardLink }); }
      catch (e) { console.warn(`alert failed: ${e.message}`); continue; }
      state.alerted[d.id] = { price: d.price, at: now, car: carKey(d) };
    }
    alertedCars.add(carKey(d));
    sent++;
  }

  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state));
  fs.writeFileSync(path.join(ROOT, 'data', 'deals.json'), JSON.stringify({ at: now, deals }, null, 1));

  // The board is published publicly, so it is only ever written encrypted.
  const site = path.join(ROOT, 'site');
  fs.rmSync(site, { recursive: true, force: true });
  if (pass) {
    fs.mkdirSync(site, { recursive: true });
    fs.writeFileSync(path.join(site, 'index.html'), await renderBoard({ at: now, deals: dedupe(deals, carKey), checked: listings.length, cfg }, pass));
    fs.writeFileSync(path.join(site, 'robots.txt'), ROBOTS);
    console.log('board: encrypted page written');
  } else {
    console.log('board: BOARD_PASSPHRASE not set, skipping');
  }

  // QUIET keeps the deal list out of public CI logs; the phone gets it instead.
  const table = process.env.QUIET ? '' : report(deals);
  console.log(`\n${deals.length} deals, ${sent} alert(s) ${DRY ? 'not sent (dry run)' : 'sent'}\n${table}`);
}

// One row per car: a crossposted car keeps its best-priced listing.
function dedupe(deals, key) {
  const best = new Map();
  for (const d of deals) { const k = key(d); if (!best.has(k) || best.get(k).price > d.price) best.set(k, d); }
  return [...best.values()];
}
function ago(t) { const h = (now - t) / HOUR; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`; }

function report(deals) {
  if (!deals.length) return '_none right now_';
  const rows = deals.map((d) => `| ${money(d.profit)} | ${money(d.price)} | ${money(d.value)} | ${d.year} ${cap(d.make)} ${cap(d.model)} | ${d.miles ? Math.round(d.miles / 1000) + 'k' : '?'} | ${d.place || d.area || ''} | ${d.flags.join(', ')} | [link](${d.url}) |`);
  return ['| Under | Ask | Worth | Car | Miles | Where | Says | |', '|--:|--:|--:|---|--:|---|---|---|', ...rows].join('\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
