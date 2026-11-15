'use strict';
const assert = require('node:assert/strict');
const YatoEffects = require('../effects.js');

// Disabling a cosmetic layer must be a true no-op, including during a pulse.
const forbidden = new Proxy({}, {get() {throw new Error('Disabled effects touched the context');}});
const disabled = new YatoEffects({canvasFactory() {throw new Error('Disabled effects allocated a canvas');}});
disabled.triggerMaterialize();
disabled.render(forbidden, forbidden, 0, 0, 1, 1 / 60);
disabled.render(forbidden, forbidden, 0, 0, 1, 1 / 60, {enabled:false});
assert.equal(disabled.snapshot().buffers, 0);
assert.equal(disabled.snapshot().materializing, false);
console.log('PASS effects disabled is a no-op');

// Headless context checks allocation bounds and state preservation, not pixels.
function fakeContext() {
  const stack = [];
  let alpha = 1;
  return {
    fills:0, draws:0, rings:0, stack,
    globalCompositeOperation:'source-over', filter:'none', fillStyle:'#000',
    get globalAlpha() {return alpha;},
    set globalAlpha(value) {assert.ok(Number.isFinite(value) && value >= 0 && value <= 1); alpha=value;},
    save() {stack.push({alpha, composite:this.globalCompositeOperation});},
    restore() {const old=stack.pop(); assert.ok(old); alpha=old.alpha; this.globalCompositeOperation=old.composite;},
    clearRect() {}, translate() {}, scale() {},
    beginPath() {}, ellipse() {}, stroke() {this.rings++;},
    drawImage() {this.draws++;}, fillRect() {this.fills++;}
  };
}
let allocations = 0;
const effects = new YatoEffects({canvasFactory() {
  allocations++;
  const context=fakeContext();
  return {width:300, height:150, getContext() {return context;}};
}});
const context=fakeContext(), source={width:384,height:560};
context.globalAlpha=.73;
for(let i=0;i<600;i++) effects.render(context,source,0,0,.5,1/60,{enabled:true,poseKey:'still'});
assert.equal(allocations,2);
assert.equal(effects.snapshot().maskBuilds,1);
assert.equal(context.globalAlpha,.73);
assert.equal(context.stack.length,0);
effects.render(context,source,0,0,.5,1/60,{enabled:true,poseKey:'next'});
assert.equal(effects.snapshot().maskBuilds,2);
effects.triggerMaterialize();
const ambientRings=context.rings;
for(let i=0;i<90;i++) effects.render(context,source,0,0,.5,1/60,{enabled:true,poseKey:'next'});
assert.equal(ambientRings,0,'Ambient effects must not show a ring');
assert.ok(context.rings>0,'Explicit pulse must show a ring');
assert.equal(effects.snapshot().materializing,false);
assert.equal(allocations,2);
assert.equal(context.globalAlpha,.73);
assert.equal(context.stack.length,0);
console.log('PASS bounded buffers, explicit pulse expiry and context preservation');

effects.triggerMaterialize();
const fillsBefore=context.fills;
const ringsBefore=context.rings;
effects.render(context,source,0,0,.5,1/60,{enabled:true,reducedMotion:true,poseKey:'next'});
assert.equal(context.fills,fillsBefore);
assert.equal(context.rings,ringsBefore);
assert.equal(effects.snapshot().materializing,false);
assert.equal(effects.snapshot().reducedMotion,true);
effects.reset();
assert.equal(effects.snapshot().clock,0);
assert.equal(effects.snapshot().enabled,false);
console.log('PASS reduced motion suppresses particles and materialization');
