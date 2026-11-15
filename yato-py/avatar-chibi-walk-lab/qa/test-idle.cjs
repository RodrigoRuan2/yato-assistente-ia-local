'use strict';
const assert=require('node:assert/strict');
const Idle=require('../idle.js');
const frame=1/60;
const advance=(idle,seconds,options)=>{let state=idle.snapshot();for(let t=0;t<seconds-1e-9;t+=frame)state=idle.step(Math.min(frame,seconds-t),options);return state;};
const finish=idle=>{let state=idle.snapshot();for(let n=0;n<600&&state.active;n++)state=idle.step(frame);assert.equal(state.active,false);return state;};
let checks=0;

{
  const idle=new Idle({random:()=>.5});
  assert.equal(idle.snapshot().nextIn,16);
  assert.equal(advance(idle,15.9).active,false);
  assert.equal(advance(idle,.2).active,true);
  const done=finish(idle);assert.equal(done.frameA,0);assert.equal(done.frameB,0);
  assert.equal(done.nextIn,16);assert.equal(advance(idle,15).active,false);checks++;
}

{
  const idle=new Idle({random:()=>0,showcase:true});
  assert.equal(advance(idle,.5).active,false);
  const seen=[];
  for(let n=0;n<2400&&seen.length<8;n++){
    const previous=idle.snapshot(),current=idle.step(frame);
    if(current.active&&!previous.active)seen.push(current.kind);
  }
  assert.deepEqual(seen,['weight','sleeve','pocket','look','weight','sleeve','pocket','look']);checks++;
}

for(const kind of ['weight','sleeve','pocket','look']){
  const idle=new Idle({random:()=>.5});
  assert.equal(idle.request(kind),true);
  let state=idle.step(0),visited=new Set(),previous=null;
  assert.equal(state.kind,kind);assert.equal(state.frameA,0);assert.equal(state.mix,0);
  assert.equal(idle.request('look'),false,'An active gesture must not queue a surprise follow-up');
  for(let n=0;n<600&&state.active;n++){
    visited.add(state.frameA);visited.add(state.frameB);
    assert.ok(Number.isInteger(state.frameA)&&state.frameA>=0&&state.frameA<=8);
    assert.ok(Number.isInteger(state.frameB)&&state.frameB>=0&&state.frameB<=8);
    assert.ok(state.mix>=0&&state.mix<=1);
    if(previous&&previous.frameA===state.frameA&&previous.frameB===state.frameB)assert.ok(state.mix>=previous.mix);
    previous=state;state=idle.step(frame);
  }
  assert.equal(state.active,false);assert.equal(state.frameA,0);assert.equal(state.frameB,0);
  assert.equal(state.pending,'');assert.ok(state.nextIn>=10&&state.nextIn<=22);
  const expected={weight:[0,1],sleeve:[0,3,4],pocket:[0,5,6],look:[0,7]}[kind];
  assert.deepEqual([...visited].sort((a,b)=>a-b),expected);checks++;
}

{
  let draws=0;const idle=new Idle({random:()=>{draws++;return .5;}});
  idle.request('pocket');advance(idle,1);
  let state=idle.step(frame,{available:false});
  assert.equal(state.active,false);assert.equal(state.frameA,0);assert.equal(state.blocked,true);
  const quiet=state.nextIn,drawsBefore=draws;
  assert.equal(idle.request('sleeve'),true);
  state=advance(idle,60,{available:false});
  assert.equal(draws,drawsBefore);assert.equal(state.nextIn,quiet);assert.equal(state.pending,'');
  state=idle.step(frame,{available:true});assert.equal(state.active,false);
  assert.ok(state.nextIn>15.9,'Resuming after speech/walking must retain a full quiet interval');checks++;
}

{
  const idle=new Idle({random:()=>0});idle.request('sleeve');idle.step(frame);
  let state=idle.step(frame,{reducedMotion:true});assert.equal(state.active,false);
  assert.equal(idle.request('weight'),false);
  state=advance(idle,30,{reducedMotion:true});assert.equal(state.active,false);
  idle.step(frame,{reducedMotion:false});idle.configure({enabled:false});
  assert.equal(idle.request('weight'),false);assert.equal(advance(idle,30).active,false);
  idle.configure({enabled:true});assert.equal(idle.request('weight'),true);assert.equal(idle.step(frame).active,true);
  idle.cancel();assert.equal(idle.snapshot().active,false);assert.equal(idle.snapshot().pending,'');checks++;
}

{
  const idle=new Idle({random:()=>0});
  for(const kind of ['weight','look']){
    const sides=[];
    for(let n=0;n<3;n++){idle.request(kind);sides.push(idle.step(0).side);finish(idle);}
    assert.deepEqual(sides,[-1,1,-1]);
  }
  let last='';
  for(let n=0;n<8;n++){
    let state=idle.snapshot();while(!state.active)state=idle.step(.1);
    assert.notEqual(state.kind,last);last=state.kind;finish(idle);
  }
  assert.equal(idle.request('invalid'),false);
  const before=idle.snapshot().nextIn;idle.step(NaN);idle.step(-2);assert.equal(idle.snapshot().nextIn,before);checks++;
}

console.log(JSON.stringify({ok:true,checks,coverage:['quiet intervals','showcase order','all four pose sequences return neutral','no queued interruption after walk/speech','reduced motion and disabled modes','alternating weight/gaze sides','no consecutive spontaneous repeats','bounded interpolation and invalid input']}));
