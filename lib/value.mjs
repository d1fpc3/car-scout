// Market value from comparable listings: per make+model, fit
//   log(price) = a + b*age + c*(miles / 10k)
// on recent asking prices, trim outliers, refit. No external price guide needed.

const thisYear = new Date().getFullYear();
const MIN_COMPS = 12;

function solve3(A, y) {
  // Gaussian elimination on a 3x3 system.
  const m = A.map((row, i) => [...row, y[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-9) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[3] / row[i]);
}

function fit(rows) {
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], y = [0, 0, 0];
  for (const r of rows) {
    const x = [1, r.age, r.m10];
    for (let i = 0; i < 3; i++) { y[i] += x[i] * r.lp; for (let j = 0; j < 3; j++) A[i][j] += x[i] * x[j]; }
  }
  const beta = solve3(A, y);
  if (!beta || beta.some((b) => !Number.isFinite(b))) return null;
  const res = rows.map((r) => r.lp - (beta[0] + beta[1] * r.age + beta[2] * r.m10));
  const sigma = Math.sqrt(res.reduce((s, e) => s + e * e, 0) / Math.max(1, rows.length - 3));
  return { beta, sigma, res };
}

export function buildModels(listings) {
  const groups = new Map();
  for (const l of listings) {
    if (!l.make || !l.model || !l.year || !l.miles || l.hard) continue;
    if (l.price < 1000 || l.price > 150000 || l.miles < 1000 || l.miles > 400000) continue;
    const key = `${l.make}|${l.model}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ age: thisYear - l.year, m10: l.miles / 10000, lp: Math.log(l.price), year: l.year, id: l.id });
  }
  const models = new Map();
  for (const [key, rows0] of groups) {
    if (rows0.length < MIN_COMPS) continue;
    let rows = rows0, f = fit(rows);
    if (!f) continue;
    const keep = rows.filter((_, i) => Math.abs(f.res[i]) <= 2.2 * f.sigma);
    if (keep.length >= MIN_COMPS && keep.length < rows.length) { rows = keep; f = fit(rows) || f; }
    // Prices must fall with age and miles, or the fit is noise.
    if (f.beta[1] > 0.02 || f.beta[2] > 0.02) continue;
    const years = rows.map((r) => r.year);
    models.set(key, { beta: f.beta, sigma: f.sigma, n: rows.length, minYear: Math.min(...years), maxYear: Math.max(...years) });
  }
  return models;
}

export function valueOf(models, { make, model, year, miles }) {
  const m = models.get(`${make}|${model}`);
  if (!m || !year) return null;
  if (year < m.minYear - 1 || year > m.maxYear + 1) return null;
  const age = thisYear - year;
  const m10 = (miles || Math.max(1, age) * 12000) / 10000;
  const lp = m.beta[0] + m.beta[1] * age + m.beta[2] * m10;
  return {
    value: Math.round(Math.exp(lp) / 50) * 50,
    // A cautious value one-half sigma below the fit, so loose comps don't fake a deal.
    low: Math.round(Math.exp(lp - 0.5 * m.sigma) / 50) * 50,
    comps: m.n,
    sigma: m.sigma,
    estMiles: !miles,
  };
}
