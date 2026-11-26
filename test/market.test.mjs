import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileGens, genOf } from '../lib/gens.mjs';
import { keep, targets } from '../lib/forsale.mjs';

const GENS = compileGens(JSON.parse(fs.readFileSync(new URL('../market/generations.json', import.meta.url), 'utf8')));

test('puts a car in its generation by chassis code first, then model year', () => {
  const g911 = GENS.porsche['911'];
  assert.equal(genOf(g911, 2003, '2003 Porsche 911 Carrera Coupe 6-Speed'), '996');
  assert.equal(genOf(g911, 2012, '2012 Porsche 911 GT3 RS 4.0 997.2'), '997');
  assert.equal(genOf(g911, 1987, '1987 Porsche 911 Carrera Coupe'), 'g-series');
  assert.equal(genOf(g911, 2024, '2024 Porsche 911 GT3 RS'), '992');
  assert.equal(genOf(GENS.chevrolet.corvette, 1965, '1965 Chevrolet Corvette Sting Ray'), 'c2');
});

test('chassis-only generations are never picked by year alone', () => {
  const rr = GENS['land-rover']['range-rover'];
  assert.equal(genOf(rr, 2015, '2015 Land Rover Range Rover Supercharged'), 'l405');
  assert.equal(genOf(rr, 2015, '2015 Land Rover Range Rover Sport HSE'), 'range-rover-sport');
  assert.equal(genOf(GENS.ford.bronco, 1985, '1985 Ford Bronco XLT'), 'full-size');
  assert.equal(genOf(GENS.ford.bronco, 1985, '1985 Ford Bronco II 4x4'), 'bronco-ii');
});

test('keeps real cars for sale and drops parts, wanted ads and other years', () => {
  const tok = /\bcorvette\b/i;
  const it = (title, price = 25000) => ({ id: 1, title, price, posted: Date.now() });
  assert.ok(keep(it('2002 Chevrolet Corvette Z06 6-speed'), tok, [1960, 2024]));
  assert.equal(keep(it('Corvette C5 wheels and tires'), tok, null), null);
  assert.equal(keep(it('WANTED: 1967 Corvette any condition'), tok, null), null);
  assert.equal(keep(it('2002 Chevrolet Corvette', 900), tok, null), null);
  assert.equal(keep(it('2014 Chevrolet Impala LT'), /\bimpala\b/i, [1959, 1996]), null);
  assert.equal(keep(it('Chevrolet Corvette convertible'), tok, [1960, 2024]), null); // no year, can't compare
});

test('Shelby searches the Shelby, not every Mustang', () => {
  const t = targets([{ key: 'shelby', name: 'Shelby', titles: ['Shelby'] }], { shelby: [{ key: 'mustang', name: 'Mustang', n: 57, byYear: [{ year: 1967, n: 20 }] }] });
  assert.equal(t[0].query, 'shelby');
  assert.ok(t[0].token.test('1967 Shelby GT500'));
  assert.ok(!t[0].token.test('1967 Ford Mustang'));
});
