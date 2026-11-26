// Generations: "Porsche 911" is eight different cars. market/generations.json lists them per model;
// a chassis code in the title wins ("2012 Porsche 911 GT3 RS 4.0 997.2"), otherwise the model year decides.

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function compileGens(json) {
  const out = {};
  for (const [make, models] of Object.entries(json || {})) {
    if (make === '_') continue;
    out[make] = {};
    for (const [model, gens] of Object.entries(models)) {
      out[make][model] = gens.map((g) => ({ ...g, key: slug(g.name), re: g.match ? new RegExp(g.match, 'i') : null }));
    }
  }
  return out;
}

// gens: the compiled list for one model (or undefined). Returns the generation key, or null.
export function genOf(gens, year, title) {
  if (!gens?.length) return null;
  const t = String(title || '');
  for (const g of gens) if (g.re && g.re.test(t)) return g.key;
  for (const g of gens) if (year >= g.from && year <= g.to && !g.matchOnly) return g.key;
  return null;
}
