// Deals board data. Each run seals the current deals into an encrypted JSON payload that
// the workflow pushes to the `board-data` branch; d1fpc3.com/cars/deals/ fetches it and
// decrypts it in the browser with the passphrase (BOARD_PASSPHRASE secret).
//
// The repo is public, so nothing here is ever written in the clear:
//   device key = PBKDF2-SHA256(passphrase, kdf.salt, kdf.it rounds)    slow, stored per device
//   page key   = HKDF-SHA256(device key, random salt per build, info)   fresh every build
//   payload    = AES-256-GCM(page key, random iv, JSON of the deals)
//
// The browser keeps the device key (never the passphrase) so it asks once per device; a
// fresh salt + iv per build means no two builds share a key. The page reads the KDF params
// from the payload, so changing them here just makes devices ask for the passphrase again.

const ITERATIONS = 600000;
const KDF_SALT = 'car-scout board v1';
const INFO = 'car-scout board page';

export const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
export function cap(s) { return String(s || '').replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/^(Bmw|Gmc|Vw)$/, (m) => m.toUpperCase()); }

// Listing data comes from strangers: only Craigslist links and photos go on the board.
const safeUrl = (u, host) => { try { const x = new URL(u); return x.protocol === 'https:' && host.test(x.hostname) ? x.href : null; } catch { return null; } };
// Sellers type "BOWIE" or "martinsburg"; leave mixed case alone.
const placeCase = (s) => (s && (s === s.toLowerCase() || s === s.toUpperCase()) ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s || null);
const b64 = (buf) => Buffer.from(buf).toString('base64');

// What the page shows, best profit first. Plain data only: the page escapes and lays it out.
export function boardData({ at, deals, checked, cfg }) {
  const flipCost = cfg.flipCost ?? 0;
  const b = cfg.buy;
  return {
    at, checked, flipCost,
    filters: { postal: cfg.postal, radius: cfg.radius, minPrice: b.minPrice, maxPrice: b.maxPrice, minProfit: b.minProfit, maxAgeHours: b.maxAgeHours },
    deals: deals.map((d) => ({
      car: [d.year, cap(d.make), cap(d.model)].filter(Boolean).join(' '),
      price: d.price,
      value: d.low,
      profit: d.low - d.price - flipCost,
      miles: d.miles || null,
      estMiles: !!d.estMiles,
      dist: d.dist != null ? Math.round(d.dist) : null,
      place: placeCase(d.place || d.area),
      posted: d.posted,
      title: d.title,
      flags: d.flags || [],
      url: safeUrl(d.url, /(^|\.)craigslist\.org$/),
      image: safeUrl(d.image, /^images\.craigslist\.org$/),
    })).sort((x, y) => y.profit - x.profit),
  };
}

async function deviceKey(passphrase, salt, iterations) {
  const { subtle } = globalThis.crypto;
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations }, base, 256));
}

async function pageKey(raw, salt, info, usage) {
  const { subtle } = globalThis.crypto;
  const hk = await subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(info) }, hk, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

// The published payload: KDF params, salt, iv, ciphertext. Nothing readable without the passphrase.
export async function seal(data, passphrase, iterations = ITERATIONS) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await pageKey(await deviceKey(passphrase, KDF_SALT, iterations), salt, INFO, 'encrypt');
  const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  return {
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', it: iterations, salt: KDF_SALT },
    hkdf: { hash: 'SHA-256', info: INFO, salt: b64(salt) },
    iv: b64(iv),
    ct: b64(ct),
  };
}

// Same math as the page script; used by the tests.
export async function unseal(box, passphrase) {
  const raw = await deviceKey(passphrase, box.kdf.salt, box.kdf.it);
  const key = await pageKey(raw, Buffer.from(box.hkdf.salt, 'base64'), box.hkdf.info, 'decrypt');
  const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(box.iv, 'base64') }, key, Buffer.from(box.ct, 'base64'));
  return JSON.parse(new TextDecoder().decode(pt));
}
