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
