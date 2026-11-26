// Year / make / model out of a free-text listing title.

const MAKES = {
  acura: 'acura', 'alfa romeo': 'alfa romeo', audi: 'audi', bmw: 'bmw', buick: 'buick',
  cadillac: 'cadillac', chevrolet: 'chevrolet', chevy: 'chevrolet', chev: 'chevrolet',
  chrysler: 'chrysler', dodge: 'dodge', fiat: 'fiat', ford: 'ford', genesis: 'genesis',
  gmc: 'gmc', honda: 'honda', hummer: 'hummer', hyundai: 'hyundai', infiniti: 'infiniti',
  isuzu: 'isuzu', jaguar: 'jaguar', jeep: 'jeep', kia: 'kia', 'land rover': 'land rover',
  landrover: 'land rover', lexus: 'lexus', lincoln: 'lincoln', mazda: 'mazda',
  'mercedes-benz': 'mercedes', 'mercedes benz': 'mercedes', mercedes: 'mercedes', benz: 'mercedes',
  mercury: 'mercury', mini: 'mini', mitsubishi: 'mitsubishi', nissan: 'nissan',
  pontiac: 'pontiac', porsche: 'porsche', ram: 'ram', saab: 'saab', saturn: 'saturn',
  scion: 'scion', subaru: 'subaru', suzuki: 'suzuki', tesla: 'tesla', toyota: 'toyota',
  volkswagen: 'volkswagen', vw: 'volkswagen', volvo: 'volvo',
};
const MAKE_KEYS = Object.keys(MAKES).sort((a, b) => b.length - a.length);

// Models whose first word means nothing alone.
const TWO_WORD = new Set(['grand', 'town', 'range', 'santa', 'model', 'land', 'monte', 'el', 'pt', 'transit', 'park', 'new', 'crown']);
const MODEL_ALIAS = {
  'f-150': 'f150', 'f-250': 'f250', 'f-350': 'f350', 'cr-v': 'crv', 'hr-v': 'hrv', 'rav-4': 'rav4',
  'cx-5': 'cx5', 'cx-9': 'cx9', 'cx-30': 'cx30', 'mx-5': 'mx5', 'e-150': 'e150', 'e-250': 'e250',
  'c-class': 'c', 'e-class': 'e', 's-class': 's', 'g-class': 'g', '3-series': '3', '5-series': '5',
  silverado: 'silverado', sierra: 'sierra',
};
const NOT_MODEL = new Set(['', 'for', 'sale', 'the', 'with', 'and', 'clean', 'low', 'miles', 'runs', 'great', 'excellent', 'awd', '4x4', '4wd', 'auto', 'automatic', 'manual']);

const thisYear = new Date().getFullYear();

export function parseTitle(raw) {
  const t = ` ${String(raw).toLowerCase().replace(/[|,!*()]+/g, ' ').replace(/\s+/g, ' ')} `;

  let year = null;
  const y4 = t.match(/(?:^|[^\d])(19[6-9]\d|20[0-3]\d)(?=[^\d]|$)/);
  if (y4 && Number(y4[1]) <= thisYear + 1) year = Number(y4[1]);

  let make = null, rest = '';
  for (const k of MAKE_KEYS) {
    const i = t.search(new RegExp(`[\\s\\d]${k.replace(/[-]/g, '\\-')}(?=[\\s-])`));
    if (i >= 0) { make = MAKES[k]; rest = t.slice(i + 1 + k.length).trim(); break; }
  }
  if (!year && make) {
    const y2 = t.match(/(?:^|\s)'?(\d{2})\s+[a-z]/);
    if (y2) { const n = Number(y2[1]); year = n <= (thisYear % 100) + 1 ? 2000 + n : n >= 60 ? 1900 + n : null; }
  }
  if (!make) return { year, make: null, model: null };

  const words = rest.split(' ').filter(Boolean);
  let model = words[0] || '';
  // Spelled-out hyphen models: "f 150", "cr v", "rav 4", "cx 5"
  if (/^(f|e|cx|cr|hr|rav|mx)$/.test(model) && /^\d+|^v$/.test(words[1] || '')) model = `${model}${words[1]}`;
  else if (TWO_WORD.has(model) && words[1]) model = `${model} ${words[1]}`;
  model = MODEL_ALIAS[model] || model.replace(/[^a-z0-9 ]/g, '');
  if (make === 'dodge' && model === 'ram') { make = 'ram'; model = (words[1] || '').replace(/[^a-z0-9]/g, '') || 'ram'; }
  // BMW 328i/335xi -> 3 series, Mercedes c300 -> c
  if (make === 'bmw' && /^[1-8]\d\d/.test(model)) model = model[0];
  if (make === 'mercedes' && /^[a-z]{1,3}\d{3}/.test(model)) model = model.match(/^[a-z]+/)[0];
  if (NOT_MODEL.has(model)) model = null;
  return { year, make, model };
}

// Words that explain a low price. Hard = never a flip candidate. Soft = mentioned in the alert.
const HARD = /\b(salvage|rebuilt|rebuildable|reconstructed|flood|branded|junk|parts? only|for parts|parting out|no title|lost title|bill of sale only|not running|non[- ]?running|does ?n[o']?t run|won'?t (start|run|crank)|blown|seized|needs? (a )?(new )?(engine|motor|transmission|trans|head gasket)|bad (engine|motor|transmission|trans)|mechanic'?s? special|project car|tow it|down ?payment|per month|financing|buy here pay here|bhph|lease (takeover|transfer)|trade only|escrow|ebay motors|deployed|shipping (is )?included|free shipping|email me at|gift card)\b|\$\d+ ?down\b|\/mo\b/i;
const SOFT = /\b(check engine|cel on|as[- ]is|knock|tick(ing)?|overheat|leak(s|ing)?|slipping|needs (some )?work|needs tlc|minor issue|inspection needed|needs inspection|rust)\b/i;

export const hardFlag = (text) => text.match(HARD)?.[0] || null;
export const softFlags = (text) => [...new Set((text.match(new RegExp(SOFT.source, 'gi')) || []).map((s) => s.toLowerCase()))];
