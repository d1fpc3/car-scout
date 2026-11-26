import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTitle, parseItem } from '../lib/bat.mjs';

test('reads year, model, trim and miles from BaT titles', () => {
  assert.deepEqual(parseTitle('5k-Mile 2017 McLaren 570GT', ['McLaren']), { year: 2017, model: '570GT', trim: '', miles: 5000 });
  assert.deepEqual(parseTitle('4,500-Mile 2014 McLaren 12C Coupe 50th Anniversary Edition', ['McLaren']), { year: 2014, model: '12C', trim: 'Coupe 50th Anniversary Edition', miles: 4500 });
  assert.equal(parseTitle('9k-Mile 2012 McLaren MP4-12C', ['McLaren']).model, '12C');
  assert.equal(parseTitle('1985.5 Porsche 944 5-Speed', ['Porsche']).model, '944');
  assert.equal(parseTitle('2021 Toyota Land Cruiser Heritage Edition', ['Toyota']).model, 'Land Cruiser');
  assert.equal(parseTitle('2023 Mercedes-AMG G63', ['Mercedes-Benz', 'Mercedes-AMG']).model, 'G63');
});

test('skips parts, memorabilia and other makes that match the keyword', () => {
  assert.equal(parseTitle('19×8″ and 20×10″ Wheels for McLaren', ['McLaren']), null);
  assert.equal(parseTitle('Half-Scale McLaren MP4/4 Display Model', ['McLaren']), null);
  assert.equal(parseTitle('5k-Mile 2006 Mercedes-Benz SLR McLaren', ['McLaren']), null);
});

test('uses the final price, and keeps reserve-not-met results as bids', () => {
  const sold = parseItem({ id: 1, title: '2013 McLaren 12C Spider', current_bid: 91000, sold_text: 'Sold for USD $95,000 <span> on 11/14/2026 </span>', sold_text_timestamp: 1795000000, currency: 'USD', url: 'https://bringatrailer.com/listing/x/' }, ['McLaren']);
  assert.equal(sold.price, 95000); assert.equal(sold.sold, true);
  const bid = parseItem({ id: 2, title: '2025 McLaren GTS', current_bid: 153000, sold_text: 'Bid to USD $153,000 on 11/20/2026', currency: 'USD' }, ['McLaren']);
  assert.equal(bid.sold, false);
  assert.equal(parseItem({ id: 3, title: '2020 McLaren 600LT', active: true, sold_text: '' }, ['McLaren']), null);
});
