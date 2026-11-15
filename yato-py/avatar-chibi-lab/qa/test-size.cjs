'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEFAULT_PERCENT, OPTIONS, validPercent, dimensions, resizeBounds,
  readPercent, savePercent,
} = require('../desktop-size.js');

const completed = [];
function check(name, run) {
  run();
  completed.push(name);
}
function assertContained(bounds, work) {
  assert.ok(bounds.width > 0 && bounds.height > 0, 'Window must remain visible');
  assert.ok(bounds.x >= work.x && bounds.y >= work.y, 'Window crosses left/top edge');
  assert.ok(bounds.x + bounds.width <= work.x + work.width, 'Window crosses right edge');
  assert.ok(bounds.y + bounds.height <= work.y + work.height, 'Window crosses bottom edge');
}

check('valid sizes and rejected input', () => {
  assert.equal(DEFAULT_PERCENT, 75);
  assert.deepEqual(OPTIONS.map(option => option.percent), [50, 75, 100, 125]);
  assert.deepEqual(dimensions(50), {width:150, height:250});
  assert.deepEqual(dimensions(75), {width:225, height:375});
  assert.deepEqual(dimensions(100), {width:300, height:500});
  assert.deepEqual(dimensions(125), {width:375, height:625});
  assert.equal(validPercent(87), true);
  for (const invalid of [49, 126, 75.5, NaN, Infinity, -Infinity, '75', null, undefined, true, {}, []]) {
    assert.equal(validPercent(invalid), false);
    assert.throws(() => dimensions(invalid), RangeError);
  }
});

check('center and base anchors when shrinking and growing', () => {
  const work = Object.freeze({x:0, y:0, width:1920, height:1080});
  const current = Object.freeze({x:700, y:200, width:300, height:500});
  for (const percent of [50, 75, 100, 125]) {
    const result = resizeBounds(current, work, percent);
    assert.deepEqual({width:result.width, height:result.height}, dimensions(percent));
    assert.ok(Math.abs(result.x + result.width / 2 - 850) <= 0.5, 'Horizontal center moved');
    assert.equal(result.y + result.height, 700, 'Bottom anchor moved');
    assertContained(result, work);
  }
});

check('negative monitor origins and all four edge clamps', () => {
  const work = {x:-1920, y:-1080, width:1920, height:1080};
  const central = resizeBounds({x:-1000, y:-700, width:300, height:500}, work, 125);
  assert.ok(Math.abs(central.x + central.width / 2 + 850) <= 0.5);
  assert.equal(central.y + central.height, -200);
  assertContained(central, work);
  const corners = [
    {x:-1920, y:-1080, expectedX:-1920, expectedY:-1080},
    {x:-150, y:-1080, expectedX:-375, expectedY:-1080},
    {x:-1920, y:-250, expectedX:-1920, expectedY:-625},
    {x:-150, y:-250, expectedX:-375, expectedY:-625},
  ];
  for (const corner of corners) {
    const result = resizeBounds({x:corner.x, y:corner.y, width:150, height:250}, work, 125);
    assert.equal(result.x, corner.expectedX);
    assert.equal(result.y, corner.expectedY);
    assertContained(result, work);
  }
  // Recover a window after its former monitor has been removed.
  const primary = {x:0, y:40, width:1280, height:680};
  assertContained(resizeBounds({x:-1800, y:-900, width:300, height:500}, primary, 125), primary);
});

check('proportional fit on short work areas', () => {
  const current = {x:-500, y:-500, width:300, height:500};
  const short = {x:-800, y:-550, width:800, height:550};
  const fitted = resizeBounds(current, short, 125);
  assert.deepEqual({width:fitted.width, height:fitted.height}, {width:330, height:550});
  assertContained(fitted, short);
  for (const percent of [50, 75, 100, 125]) {
    const work = {x:100, y:75, width:800, height:533};
    const result = resizeBounds(current, work, percent);
    assertContained(result, work);
    assert.ok(Math.abs(result.width - result.height * 3 / 5) <= 1, 'Aspect ratio was distorted');
  }
});

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yato-size-test-'));
try {
  const file = path.join(temporaryRoot, 'nested', 'settings.json');
  check('missing config, persistence and unrelated settings', () => {
    assert.equal(readPercent(file), DEFAULT_PERCENT);
    savePercent(file, 50);
    assert.equal(readPercent(file), 50);
    const unrelated = {theme:'violet', conversation:{muted:false}, positions:[-120, 45]};
    fs.writeFileSync(file, JSON.stringify({...unrelated, sizePercent:'broken'}));
    assert.equal(readPercent(file), DEFAULT_PERCENT);
    savePercent(file, 125);
    assert.equal(readPercent(file), 125);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {...unrelated, sizePercent:125});
    savePercent(file, 75);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {...unrelated, sizePercent:75});
    const previous = fs.readFileSync(file, 'utf8');
    for (const invalid of [49, 126, 75.5, '75', NaN, undefined]) {
      assert.throws(() => savePercent(file, invalid), RangeError);
      assert.equal(fs.readFileSync(file, 'utf8'), previous, 'Invalid input changed saved settings');
    }
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json'], 'Temporary config leaked');
  });
  check('malformed and invalid config recovery', () => {
    for (const content of ['', '{broken', 'null', '[]', '42', '"75"', '{"sizePercent":49}', '{"sizePercent":126}', '{"sizePercent":75.5}', '{"sizePercent":"75"}']) {
      fs.writeFileSync(file, content);
      assert.equal(readPercent(file), DEFAULT_PERCENT);
      savePercent(file, 100);
      assert.equal(readPercent(file), 100);
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {sizePercent:100});
    }
  });
} finally {
  // Only remove the unique directory created by this test.
  fs.rmSync(temporaryRoot, {recursive:true, force:true});
}

console.log(`PASS (${completed.length} groups): ${completed.join('; ')}`);
