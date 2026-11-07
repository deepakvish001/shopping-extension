const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseHTML } = require('linkedom');
const { extract } = require('../extension/src/shared/extract.js');

const load = (name) => parseHTML(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')).document;

test('Amazon: price, MRP, title, hi-res image, stock', () => {
  const p = extract(load('amazon.html'), 'https://www.amazon.in/boAt/dp/B0TEST1234?ref=x');
  assert.equal(p.key, 'amazon:B0TEST1234');
  assert.equal(p.price, 1299);
  assert.equal(p.mrp, 3990);
  assert.equal(p.title, 'boAt Rockerz 450 Bluetooth On Ear Headphones');
  assert.equal(p.image, 'https://m.media-amazon.com/images/I/large.jpg');
  assert.equal(p.inStock, null);
});

test('Amazon: builds the price from whole/fraction parts and reads out-of-stock', () => {
  const p = extract(load('amazon-parts.html'), 'https://www.amazon.in/dp/B0LAPTOP01');
  assert.equal(p.price, 54999.5);
  assert.equal(p.mrp, null);
  assert.equal(p.inStock, false);
});

test('Amazon: no price while the page still shows another variant', () => {
  const p = extract(load('amazon.html'), 'https://www.amazon.in/dp/B0OTHER999');
  assert.equal(p.key, 'amazon:B0OTHER999');
  assert.equal(p.price, null);
});

test('Flipkart: JSON-LD first, MRP from the page', () => {
  const p = extract(load('flipkart.html'), 'https://www.flipkart.com/samsung-galaxy-m35/p/itm123abc?pid=MOBGZ12345');
  assert.equal(p.price, 13999);
  assert.equal(p.mrp, 24499);
  assert.equal(p.title, 'SAMSUNG Galaxy M35 5G (Moonlight Blue, 128 GB)');
  assert.equal(p.image, 'https://rukminim2.flixcart.com/image/416/416/phone.jpeg');
  assert.equal(p.inStock, true);
});

test('Flipkart: falls back to known selectors without JSON-LD', () => {
  const p = extract(load('flipkart-no-jsonld.html'), 'https://www.flipkart.com/puma/p/itmshoe1?pid=SHOEPUMA1');
  assert.equal(p.price, 2199);
  assert.equal(p.mrp, 4999);
  assert.equal(p.title, 'Puma Running Shoes For Men');
  assert.equal(p.image, 'https://rukminim2.flixcart.com/image/shoe.jpeg');
  assert.equal(p.inStock, false);
});

test('Myntra: reads embedded page state', () => {
  const p = extract(load('myntra.html'), 'https://www.myntra.com/tshirts/roadster/x/1234567/buy');
  assert.equal(p.price, 449);
  assert.equal(p.mrp, 999);
  assert.equal(p.title, 'Roadster Men Black Solid Round Neck T-shirt');
  assert.equal(p.image, 'https://assets.myntassets.com/images/1234567/1.jpg');
  assert.equal(p.inStock, true);
});

test('Myntra: ignores stale page state after in-app navigation', () => {
  const p = extract(load('myntra-spa.html'), 'https://www.myntra.com/shorts/hrx/y/7654321/buy');
  assert.equal(p.price, 699);
  assert.equal(p.mrp, 1399);
  assert.equal(p.title, 'HRX by Hrithik Roshan Men Running Shorts');
  assert.equal(p.image, 'https://assets.myntassets.com/images/7654321/1.jpg');
});

test('returns null for non-product pages', () => {
  assert.equal(extract(load('amazon.html'), 'https://www.amazon.in/s?k=x'), null);
});
