// The deals board: one static page, rebuilt every run and published to GitHub Pages.
//
// The repo and the Pages site are public, but the deals are not: the board content is
// encrypted here with AES-GCM and only the ciphertext is published. The page decrypts it in
// the browser with the passphrase (BOARD_PASSPHRASE secret).
//
//   device key = PBKDF2-SHA256(passphrase, KDF_SALT, 600k rounds)     slow, stored per device
//   page key   = HKDF-SHA256(device key, random salt per build)        fresh every build
//   page       = AES-256-GCM(page key, random iv, board html)
//
// The browser keeps the device key (never the passphrase) so it only asks once per device,
// and a fresh salt + iv per build means no two builds share a key.

const HOUR = 3600e3;
const ITERATIONS = 600000;
const KDF_SALT = 'car-scout board v1';
const INFO = 'car-scout board page';

export const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
export function cap(s) { return String(s || '').replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/^(Bmw|Gmc|Vw)$/, (m) => m.toUpperCase()); }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Listing data comes from strangers: only link to Craigslist itself.
const safeUrl = (u, host) => { try { const x = new URL(u); return x.protocol === 'https:' && host.test(x.hostname) ? x.href : null; } catch { return null; } };
const b64 = (buf) => Buffer.from(buf).toString('base64');

function ago(t, now) {
  const h = (now - t) / HOUR;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
}

// Sellers type "BOWIE" or "martinsburg"; leave mixed case alone.
const placeCase = (s) => (s && (s === s.toLowerCase() || s === s.toUpperCase()) ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);

function row(d, now) {
  const url = safeUrl(d.url, /(^|\.)craigslist\.org$/);
  const img = safeUrl(d.image, /^images\.craigslist\.org$/);
  const car = [d.year, cap(d.make), cap(d.model)].filter(Boolean).join(' ');
  const mi = d.miles ? `${Math.round(d.miles / 1000)}k mi${d.estMiles ? ' (est)' : ''}` : 'miles unknown';
  const meta = [mi, d.dist != null ? `${Math.round(d.dist)} mi away` : null, placeCase(d.place || d.area)].filter(Boolean).map(esc).join(' · ');
  return `
<a class="deal" ${url ? `href="${esc(url)}"` : ''} target="_blank" rel="noopener noreferrer">
  ${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="noimg"></span>'}
  <span class="body">
    <span class="top"><span class="car">${esc(car)}</span><span class="net">${money(d.net)}</span></span>
    <span class="nums">${money(d.price)} asking · ${money(d.low)} value</span>
    <span class="meta">${meta} · <span class="nowrap">listed <time data-t="${Number(d.posted) || 0}">${ago(d.posted, now)}</time></span></span>
    <span class="title">${esc(d.title)}</span>
    ${d.flags?.length ? `<span class="says">Says: ${esc(d.flags.join(', '))}</span>` : ''}
  </span>
</a>`;
}

// The secret part of the page: everything below the heading. Plain HTML, never written to disk.
export function boardContent({ at, deals, checked, cfg }) {
  const flip = cfg.flipCost ?? 0;
  const list = deals.map((d) => ({ ...d, net: d.low - d.price - flip })).sort((a, b) => b.net - a.net);
  const b = cfg.buy;
  const days = b.maxAgeHours % 24 === 0 ? `${b.maxAgeHours / 24} days` : `${b.maxAgeHours} hours`;
  const when = new Date(at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const count = list.length === 1 ? '1 deal' : `${list.length} deals`;
  return `<p class="sub">${count} · updated <time data-t="${at}">${esc(when)}</time> · ${Number(checked || 0).toLocaleString('en-US')} listings checked</p>
<p class="rule">Profit = value − asking − ${money(flip)} flip cost.</p>
<div class="list">
${list.length ? list.map((d) => row(d, at)).join('') : `<p class="empty">Nothing worth a look right now. The scout checks every 15 minutes.</p>`}
</div>
<footer>
<p>Value is what similar cars nearby are listed for (same model, similar year and miles), shaded down a little to stay cautious. Profit takes off ${money(flip)} for tax, tags, inspection and cleanup. Treat both as a starting point, not a quote.</p>
<p>Showing private sellers within ${esc(cfg.radius)} miles of ${esc(cfg.postal)}, ${money(b.minPrice)} to ${money(b.maxPrice)}, posted in the last ${days}, clean title, at least ${money(b.minProfit)} under value.</p>
<p><button type="button" id="forget">Forget the passphrase on this device</button></p>
</footer>`;
}

async function deviceKey(passphrase, iterations) {
  const { subtle } = globalThis.crypto;
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(KDF_SALT), iterations }, base, 256));
}

async function pageKey(raw, salt, usage) {
  const { subtle } = globalThis.crypto;
  const hk = await subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(INFO) }, hk, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

export async function seal(html, passphrase, iterations = ITERATIONS) {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await pageKey(await deviceKey(passphrase, iterations), salt, 'encrypt');
  const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(html));
  return { it: iterations, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

// Same math as the page script; used by the tests.
export async function unseal(box, passphrase) {
  const key = await pageKey(await deviceKey(passphrase, box.it), Buffer.from(box.salt, 'base64'), 'decrypt');
  const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(box.iv, 'base64') }, key, Buffer.from(box.ct, 'base64'));
  return new TextDecoder().decode(pt);
}

// The published page: ciphertext plus the script that opens it. No deal data in the clear.
export async function renderBoard(data, passphrase, iterations) {
  const box = await seal(boardContent(data), passphrase, iterations);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<title>Car deals</title>
<style>
  :root { --bg: #0f0f10; --ink: #ececec; --muted: #8b8b8f; --line: rgba(255,255,255,.09); --gold: #D4AF37; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  main { max-width: 720px; margin: 0 auto; padding: 28px 16px 48px; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 4px; letter-spacing: -.01em; }
  .sub, .rule, footer, .note { color: var(--muted); font-size: 13px; }
  .sub { margin: 0; }
  .rule { margin: 2px 0 18px; }
  .list { border-top: 1px solid var(--line); }
  .deal { display: flex; gap: 14px; padding: 14px 0; border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; }
  .deal:hover .car { text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px; }
  .deal img, .noimg { flex: none; width: 112px; height: 84px; object-fit: cover; border-radius: 3px; background: #1b1b1d; }
  .body { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 1px; }
  .top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .car { font-weight: 600; }
  .net { color: var(--gold); font-weight: 600; white-space: nowrap; }
  .nums, .net, .sub, .meta { font-variant-numeric: tabular-nums; }
  .nums { font-size: 14px; }
  .meta, .title, .says { color: var(--muted); font-size: 13px; }
  .nowrap { white-space: nowrap; }
  .title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .empty { color: var(--muted); padding: 20px 0; border-bottom: 1px solid var(--line); margin: 0; }
  footer { margin-top: 22px; }
  footer p { margin: 0 0 8px; }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
  #forget { color: var(--muted); text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px; }
  form { margin-top: 18px; max-width: 360px; }
  label { display: block; color: var(--muted); font-size: 13px; margin-bottom: 6px; }
  .field { display: flex; gap: 14px; align-items: baseline; border-bottom: 1px solid var(--line); }
  .field:focus-within { border-bottom-color: var(--gold); }
  input { flex: 1; min-width: 0; font: inherit; font-size: 16px; color: var(--ink); background: none; border: 0; outline: 0; padding: 8px 0; }
  form button { color: var(--gold); font-weight: 600; }
  .note { margin: 10px 0 0; min-height: 1.4em; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
<h1>Car deals</h1>
<form id="unlock" hidden>
  <label for="pass">Passphrase</label>
  <div class="field"><input id="pass" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" required><button type="submit">Open</button></div>
  <p class="note" id="note" role="status"></p>
</form>
<div id="board"></div>
<noscript><p class="note">This page needs JavaScript to open.</p></noscript>
</main>
<script>
(function () {
  var BOX = ${JSON.stringify(box)};
  var STORE = 'car-scout-board-key';
  var subtle = window.crypto && window.crypto.subtle;
  var te = new TextEncoder();
  var $ = function (id) { return document.getElementById(id); };
  var bytes = function (s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0); }); };
  var text = function (u) { return btoa(String.fromCharCode.apply(null, u)); };
  var get = function () { try { return localStorage.getItem(STORE); } catch (e) { return null; } };
  var put = function (v) { try { v ? localStorage.setItem(STORE, v) : localStorage.removeItem(STORE); } catch (e) {} };

  function deviceKey(pass) {
    return subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveBits']).then(function (base) {
      return subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode(${JSON.stringify(KDF_SALT)}), iterations: BOX.it }, base, 256);
    }).then(function (b) { return new Uint8Array(b); });
  }
  function open(raw) {
    return subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']).then(function (hk) {
      return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: bytes(BOX.salt), info: te.encode(${JSON.stringify(INFO)}) }, hk, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    }).then(function (key) {
      return subtle.decrypt({ name: 'AES-GCM', iv: bytes(BOX.iv) }, key, bytes(BOX.ct));
    }).then(function (pt) { return new TextDecoder().decode(pt); });
  }
  function show(html) {
    $('unlock').hidden = true;
    // Authenticated by AES-GCM: only a holder of the passphrase could have produced this.
    $('board').innerHTML = html;
    var now = Date.now();
    document.querySelectorAll('time[data-t]').forEach(function (el) {
      var h = (now - Number(el.dataset.t)) / 3600e3;
      if (!(h >= 0)) return;
      el.textContent = h < 1 ? Math.max(1, Math.round(h * 60)) + ' min ago' : h < 48 ? Math.round(h) + ' h ago' : Math.round(h / 24) + ' days ago';
    });
    var f = $('forget');
    if (f) f.onclick = function () { put(null); location.reload(); };
  }
  function ask(msg) { $('unlock').hidden = false; $('note').textContent = msg || ''; if (!msg) $('pass').focus(); }
  function tryPass(pass) {
    return deviceKey(pass).then(function (raw) {
      return open(raw).then(function (html) { put(text(raw)); show(html); });
    });
  }

  if (!subtle) { ask('This browser cannot open the board. Try a current Safari or Chrome.'); return; }

  // A #k=passphrase link (from the phone alert) opens straight in; drop it from the address bar.
  var fromLink = null;
  var m = location.hash.match(/^#k=(.+)$/);
  if (m) {
    try { fromLink = decodeURIComponent(m[1]); } catch (e) {}
    history.replaceState(null, '', location.pathname + location.search);
  }

  var saved = get();
  (saved ? open(bytes(saved)).then(show) : Promise.reject())
    .catch(function () {
      if (saved) put(null);
      if (!fromLink) return ask();
      return tryPass(fromLink).catch(function () { ask("That passphrase didn't work."); });
    });

  $('unlock').addEventListener('submit', function (e) {
    e.preventDefault();
    var pass = $('pass').value;
    if (!pass) return;
    $('note').textContent = 'Opening…';
    tryPass(pass).catch(function () { $('note').textContent = "That passphrase didn't work."; $('pass').select(); });
  });
})();
</script>
</body>
</html>
`;
}

export const ROBOTS = 'User-agent: *\nDisallow: /\n';
