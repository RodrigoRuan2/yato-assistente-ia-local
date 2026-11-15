'use strict';
const assert = require('node:assert/strict');
const YatoRoutine = require('../autonomy.js');

const completed = [];
function check(name, run) {
  run();
  completed.push(name);
}
function sequence(values) {
  let calls = 0;
  const random = () => {
    assert.ok(calls < values.length, 'Unexpected random draw');
    return values[calls++];
  };
  random.calls = () => calls;
  return random;
}
function tick(routine, count, blocked=false) {
  let result;
  for (let i=0; i<count; i++) result = routine.step(.1, blocked);
  return result;
}
function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} differs from ${expected}`);
}

check('initial rest and independent snapshots', () => {
  const random = sequence([.5]);
  const routine = new YatoRoutine({random});
  assert.deepEqual(routine.snapshot(), {phase:'idle', remaining:12, blocked:false});
  const snapshot = routine.snapshot();
  snapshot.phase = 'walking';
  snapshot.remaining = 0;
  assert.deepEqual(routine.step(0), {
    phase:'idle', remaining:12, blocked:false, startedWalking:false, direction:null,
  });
  assert.equal(random.calls(), 1);
});

check('complete cycles, duration endpoints and one-tick direction events', () => {
  const random = sequence([0, 0, 0, 1, 1, 1, .5]);
  const routine = new YatoRoutine({random});
  assert.equal(routine.snapshot().remaining, 8);
  let result = tick(routine, 79);
  assert.equal(result.phase, 'idle');
  assert.equal(result.startedWalking, false);
  near(result.remaining, .1);
  result = routine.step(.1);
  assert.deepEqual(result, {
    phase:'walking', remaining:3, blocked:false, startedWalking:true, direction:-1,
  });
  assert.equal(random.calls(), 3);
  result = routine.step(.1);
  assert.equal(result.startedWalking, false);
  assert.equal(result.direction, null);
  near(result.remaining, 2.9);
  result = tick(routine, 29);
  assert.deepEqual(result, {
    phase:'idle', remaining:16, blocked:false, startedWalking:false, direction:null,
  });
  assert.equal(random.calls(), 4);
  result = tick(routine, 159);
  assert.equal(result.phase, 'idle');
  result = routine.step(.1);
  assert.deepEqual(result, {
    phase:'walking', remaining:6, blocked:false, startedWalking:true, direction:1,
  });
  result = tick(routine, 60);
  assert.deepEqual(result, {
    phase:'idle', remaining:12, blocked:false, startedWalking:false, direction:null,
  });
  assert.equal(random.calls(), 7);
});

check('custom ranges and intermediate sampled durations', () => {
  const random = sequence([.25, .75, .5, .5]);
  const routine = new YatoRoutine({random, idle:[2, 6], walk:[1, 3]});
  assert.equal(routine.snapshot().remaining, 3);
  const start = tick(routine, 30);
  assert.equal(start.remaining, 2.5);
  assert.equal(start.direction, 1);
  assert.equal(tick(routine, 25).remaining, 4);
  assert.equal(random.calls(), 4);
});

check('walking interruption resets once and waits a full rest after release', () => {
  const random = sequence([0, 0, 0, .5, 1, 1]);
  const routine = new YatoRoutine({random});
  assert.equal(tick(routine, 80).phase, 'walking');
  const interrupted = routine.step(.1, true);
  assert.deepEqual(interrupted, {
    phase:'idle', remaining:12, blocked:true, startedWalking:false, direction:null,
  });
  assert.equal(random.calls(), 4);
  assert.deepEqual(tick(routine, 500, true), interrupted);
  assert.equal(random.calls(), 4, 'Sustained blocking sampled another rest');
  assert.deepEqual(routine.step(0, false), {...interrupted, blocked:false});
  const waiting = tick(routine, 119);
  assert.equal(waiting.phase, 'idle');
  assert.equal(waiting.startedWalking, false);
  near(waiting.remaining, .1);
  assert.deepEqual(routine.step(.1), {
    phase:'walking', remaining:6, blocked:false, startedWalking:true, direction:1,
  });
  assert.equal(random.calls(), 6);
});

check('idle interruption and repeated block entries each restart once', () => {
  const random = sequence([0, .25, .75]);
  const routine = new YatoRoutine({random});
  tick(routine, 30);
  assert.equal(routine.step(.1, true).remaining, 10);
  assert.equal(tick(routine, 100, true).remaining, 10);
  assert.equal(random.calls(), 2);
  near(routine.step(.1, false).remaining, 9.9);
  assert.equal(routine.step(.1, true).remaining, 14);
  assert.equal(random.calls(), 3);
});

check('invalid elapsed times are ignored and long pauses clamp to 100 ms', () => {
  const random = sequence([0]);
  const routine = new YatoRoutine({random});
  for (const dt of [NaN, Infinity, -Infinity, -1, '1', null, undefined, {}, []]) {
    const result = routine.step(dt);
    assert.equal(result.remaining, 8);
    assert.equal(result.phase, 'idle');
    assert.equal(result.startedWalking, false);
    assert.equal(result.direction, null);
  }
  near(routine.step(3600).remaining, 7.9);
  near(routine.step(.025).remaining, 7.875);
  assert.equal(random.calls(), 1);
});

check('explicit reset restores rest and clears blocking and transition events', () => {
  const random = sequence([0, 0, 0, .25, .5, .75]);
  const routine = new YatoRoutine({random});
  assert.equal(tick(routine, 80).startedWalking, true);
  assert.deepEqual(routine.reset(), {phase:'idle', remaining:10, blocked:false});
  assert.equal(routine.step(0).startedWalking, false);
  assert.equal(routine.step(0).direction, null);
  routine.step(.1, true);
  assert.deepEqual(routine.reset(), {phase:'idle', remaining:14, blocked:false});
  assert.deepEqual(routine.snapshot(), {phase:'idle', remaining:14, blocked:false});
  assert.equal(random.calls(), 6);
});

console.log(`PASS (${completed.length} groups): ${completed.join('; ')}`);
