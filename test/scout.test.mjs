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

test('board payload is ciphertext only and opens with the passphrase', async () => {
  const { boardData, seal, unseal } = await import('../lib/board.mjs');
  const cfg = { postal: '21201', radius: 75, flipCost: 1000, buy: { minPrice: 1500, maxPrice: 15000, minProfit: 2000, maxAgeHours: 72 } };
  const deals = [
    { id: '2', year: 2010, make: 'toyota', model: 'camry', miles: 120000, price: 4000, low: 6500, posted: 1, place: 'BOWIE', title: 'camry', url: 'javascript:alert(1)', image: 'https://evil.example/x.jpg', flags: [] },
    { id: '1', year: 2012, make: 'honda', model: 'accord', miles: 140000, price: 5000, low: 8500, posted: 2, dist: 12.4, place: 'Towson', title: 'SECRET-CAR', url: 'https://baltimore.craigslist.org/cto/d/x/1.html', image: 'https://images.craigslist.org/abc_600x450.jpg', flags: ['as-is'] },
  ];
  const data = boardData({ at: 123, deals, checked: 10412, cfg });
  assert.deepEqual(data.deals.map((d) => d.car), ['2012 Honda Accord', '2010 Toyota Camry'], 'ranked by profit');
  assert.equal(data.deals[0].profit, 2500, 'profit = value - asking - flip cost');
  assert.equal(data.deals[0].dist, 12);
  assert.equal(data.deals[1].place, 'Bowie');
  assert.equal(data.deals[1].url, null, 'only Craigslist links');
  assert.equal(data.deals[1].image, null, 'only Craigslist photos');

  const box = await seal(data, 'test pass', 1000);
  const text = JSON.stringify(box);
  for (const leak of ['SECRET-CAR', 'Accord', 'Towson', '10412', 'craigslist']) assert.ok(!text.includes(leak), `payload leaks ${leak}`);
  assert.deepEqual(Object.keys(box), ['v', 'kdf', 'hkdf', 'iv', 'ct']);
  assert.deepEqual(await unseal(box, 'test pass'), data);
  await assert.rejects(unseal(box, 'wrong pass'));
  assert.notEqual((await seal(data, 'test pass', 1000)).hkdf.salt, box.hkdf.salt, 'fresh salt every build');
});
