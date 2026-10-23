'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const icons = require('../icons.js');

// A deliberately small SVG grammar makes the asset boundary auditable without
// adding an XML parser or accepting URLs, styles, handlers or nested documents.
const attributes = new Set(['d','cx','cy','r','rx','ry','x','y','x1','y1','x2','y2','width','height','points','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin']);
const primitives = new Set(['path','circle','ellipse','rect','line','polyline','polygon']);
function assertSafeGeometry(markup, name) {
  assert.equal(typeof markup, 'string', name);
  assert.ok(markup.length > 0 && markup.length < 4096, name + ' stays a compact vector');
  const tags = markup.match(/<[^>]+>/g) || [];
  assert.ok(tags.length, name + ' contains vector primitives');
  assert.equal(markup.replace(/<[^>]+>/g, '').trim(), '', name + ' has no text or escaped payload');
  for (const tag of tags) {
    const shape = /^<([a-z]+)\b([\s\S]*?)\/>$/.exec(tag);
    assert.ok(shape, name + ' consists of self-contained primitives: ' + tag);
    assert.ok(primitives.has(shape[1]), name + ' uses a permitted SVG primitive');
    const seen = new Set();
    const remainder = shape[2].replace(/\s+([a-z][a-z-]*)=(?:"([^"]*)"|'([^']*)')/g, (_, key, double, single) => {
      const value = double ?? single;
      assert.ok(attributes.has(key), name + ' has a geometry-only attribute: ' + key);
      assert.ok(!seen.has(key), name + ' does not repeat attributes');
      seen.add(key);
      if (key === 'fill' || key === 'stroke') assert.match(value, /^(?:none|currentColor)$/);
      else if (key === 'stroke-linecap') assert.match(value, /^(?:round|butt|square)$/);
      else if (key === 'stroke-linejoin') assert.match(value, /^(?:round|miter|bevel)$/);
      else if (key === 'd') assert.match(value, /^[MmLlHhVvCcSsQqTtAaZz0-9.,+\-\s]+$/);
      else assert.match(value, /^[0-9.,+\-\s]+$/);
      return '';
    });
    assert.equal(remainder.trim(), '', name + ' contains no unparsed attributes');
  }
}

test('the original registry covers existing controls and eight distinctive shopping categories', () => {
  const original = ['home','search','bag','cart','heart','user','moon','sun','menu','close','arrow','check','plus','minus','info','warning','box','truck','shield','filter','compare','copy','external','refresh'];
  for (const name of [...original,'assistant','send','chevron']) assert.ok(Object.hasOwn(icons.paths, name), name);
  const categories = ['Fashion','Shoes','Electronics','Beauty','Accessories','Home','Sports','Lifestyle'];
  assert.deepEqual(Object.keys(icons.categories).sort(), categories.sort());
  assert.equal(new Set(Object.values(icons.categories)).size, categories.length, 'each category has a distinctive glyph');
  for (const name of Object.values(icons.categories)) assert.ok(Object.hasOwn(icons.paths, name), name);
});

test('every icon asset permits only compact, local SVG geometry', () => {
  for (const [name, markup] of Object.entries(icons.paths)) assertSafeGeometry(markup, name);
});

test('rendered symbols share accessible decorative markup and a scalable visual contract', () => {
  for (const name of Object.keys(icons.paths)) {
    const svg = icons.render(name);
    assert.match(svg, /^<svg\b/);
    assert.ok(svg.endsWith('</svg>'));
    for (const attribute of ['viewBox="0 0 24 24"','stroke="currentColor"','stroke-width="1.75"','aria-hidden="true"','focusable="false"','data-icon="'+name+'"']) assert.ok(svg.includes(attribute), name + ': ' + attribute);
    assert.equal((svg.match(/<svg\b/g)||[]).length, 1);
    assert.doesNotMatch(svg, /<(?:script|image|use|foreignObject|style|animate)\b|\b(?:href|src|on\w+)\s*=/i);
  }
});

test('unknown and prototype-property names safely resolve to the same information symbol', () => {
  const fallback = icons.render('info');
  for (const name of ['missing','__proto__','constructor','toString','hasOwnProperty','<img src=x onerror=alert(1)>','info" onload="alert(1)',null,undefined,{}]) {
    assert.equal(icons.render(name), fallback);
  }
});

test('extra classes cannot escape an attribute or inject active SVG content', () => {
  const cases = ['arrow icon-sm','arrow" onload="alert(1)','x\"><script>alert(1)</script><svg class="y',"icon-sm' onclick='alert(1)",'arrow bad:token another-token','<img src=x onerror=alert(1)>'];
  for (const extra of cases) {
    const svg = icons.render('search', extra);
    assert.doesNotMatch(svg, /<script|<img|\bon(?:load|error|click)\s*=/i);
    const opening = /^<svg\b[^>]*>/.exec(svg)?.[0];
    assert.ok(opening, 'renderer keeps one well-formed opening SVG tag');
    const classes = /\bclass="([^"]*)"/.exec(opening)?.[1].trim().split(/\s+/);
    assert.ok(classes?.includes('icon'));
    for (const name of classes) assert.match(name, /^[A-Za-z_][A-Za-z0-9_-]*$/);
    assert.equal((svg.match(/<svg\b/g)||[]).length, 1);
    assert.match(svg, /data-icon="search"/);
  }
  const ordinary = icons.render('arrow', 'arrow icon-sm');
  assert.match(ordinary, /class="[^"]*\barrow\b/);
  assert.match(ordinary, /class="[^"]*\bicon-sm\b/);
});

test('the browser export needs neither a DOM nor an external dependency', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../icons.js'), 'utf8'), context);
  assert.equal(typeof context.AnoXIcons?.render, 'function');
  assert.equal(context.AnoXIcons.render('cart'), icons.render('cart'));
  assert.deepEqual(Array.from(Object.keys(context.AnoXIcons.categories)).sort(), Object.keys(icons.categories).sort());
});
