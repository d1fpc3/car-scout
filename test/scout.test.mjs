import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTitle, hardFlag, softFlags } from '../lib/parse.mjs';
import { buildModels, valueOf } from '../lib/value.mjs';

test('parses year, make, model from messy titles', () => {
  const cases = {
    '2019 Ford F-150 XLT': [2019, 'ford', 'f150'],
    '08 Honda Accord EX-L': [2008, 'honda', 'accord'],
    '2015 Chevy Silverado 1500 LT 4x4': [2015, 'chevrolet', 'silverado'],
    '2012 BMW 328i xDrive': [2012, 'bmw', '3'],
    '2016 Jeep Grand Cherokee Limited': [2016, 'jeep', 'grand cherokee'],
    '2010 Dodge Ram 1500': [2010, 'ram', '1500'],
    '2011 Mercedes-Benz C300 4matic': [2011, 'mercedes', 'c'],
    '2013 Honda CR-V EX': [2013, 'honda', 'crv'],
  };
  for (const [title, [year, make, model]] of Object.entries(cases)) {
    assert.deepEqual(parseTitle(title), { year, make, model }, title);
  }
});

test('flags deal-killers hard and wear items soft', () => {
  assert.ok(hardFlag('2012 Camry salvage title'));
  assert.ok(hardFlag('runs but needs transmission'));
  assert.ok(hardFlag('$500 down drive today'));
  assert.equal(hardFlag('2014 Accord clean title one owner'), null);
  assert.deepEqual(softFlags('sold as-is, check engine light on'), ['as-is', 'check engine']);
});

test('values a car from comps and ignores junk prices', () => {
  const year = new Date().getFullYear();
  const listings = [];
  for (let i = 0; i < 30; i++) {
    const age = 3 + (i % 10), miles = 20000 + age * 12000 + (i % 3) * 5000;
    listings.push({ id: String(i), make: 'honda', model: 'civic', year: year - age, miles, price: Math.round(22000 * Math.exp(-0.09 * age - 0.02 * (miles / 10000))) });
  }
  listings.push({ id: 'typo', make: 'honda', model: 'civic', year: year - 4, miles: 60000, price: 1200 });
  const models = buildModels(listings);
  const v = valueOf(models, { make: 'honda', model: 'civic', year: year - 6, miles: 92000 });
  const truth = 22000 * Math.exp(-0.09 * 6 - 0.02 * 9.2);
  assert.ok(Math.abs(v.value - truth) / truth < 0.05, `${v.value} vs ${truth}`);
  assert.ok(v.low <= v.value);
  assert.equal(valueOf(models, { make: 'honda', model: 'civic', year: year - 30, miles: 90000 }), null, 'no extrapolating past comps');
  assert.equal(valueOf(models, { make: 'kia', model: 'soul', year: year - 5, miles: 60000 }), null);
});

test('board page holds only ciphertext and opens with the passphrase', async () => {
  const { renderBoard, boardContent, unseal } = await import('../lib/board.mjs');
  const cfg = { postal: '21201', radius: 75, flipCost: 1000, buy: { minPrice: 1500, maxPrice: 15000, minProfit: 2000, maxAgeHours: 72 } };
  const deals = [
    { id: '1', year: 2012, make: 'honda', model: 'accord', miles: 140000, price: 5000, low: 8500, posted: Date.now() - 3 * 3600e3, dist: 12.4, place: 'Towson', title: 'SECRET-CAR <script>alert(1)</script>', url: 'https://baltimore.craigslist.org/cto/d/x/1.html', image: 'https://images.craigslist.org/abc_600x450.jpg', flags: ['as-is'] },
    { id: '2', year: 2010, make: 'toyota', model: 'camry', miles: 120000, price: 4000, low: 6500, posted: Date.now(), title: 'camry', url: 'javascript:alert(1)', image: 'https://evil.example/x.jpg', flags: [] },
  ];
  const data = { at: Date.now(), deals, checked: 10412, cfg };

  const inner = boardContent(data);
  assert.ok(inner.indexOf('2012 Honda Accord') < inner.indexOf('2010 Toyota Camry'), 'ranked by profit');
  assert.match(inner, /\$2,500/, 'profit = value - asking - flip cost');
  assert.ok(!inner.includes('<script>'), 'listing text is escaped');
  assert.ok(!inner.includes('javascript:') && !inner.includes('evil.example'), 'only Craigslist links and photos');

  const page = await renderBoard(data, 'test pass', 1000);
  for (const leak of ['SECRET-CAR', 'Accord', 'accord', 'Towson', '10,412', 'craigslist.org/cto']) assert.ok(!page.includes(leak), `page leaks ${leak}`);
  assert.match(page, /noindex,nofollow/);
  const box = JSON.parse(page.match(/var BOX = (\{.*?\});/)[1]);
  assert.equal(await unseal(box, 'test pass'), inner);
  await assert.rejects(unseal(box, 'wrong pass'));
  const again = JSON.parse((await renderBoard(data, 'test pass', 1000)).match(/var BOX = (\{.*?\});/)[1]);
  assert.notEqual(again.salt, box.salt, 'fresh salt every build');
});
