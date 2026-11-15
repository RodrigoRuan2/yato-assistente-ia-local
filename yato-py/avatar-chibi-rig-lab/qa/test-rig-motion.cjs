'use strict';
const assert=require('node:assert/strict');
const Motion=require('../motion.js');
const tick=(motion,seconds,{min=-10000,max=10000,blocked=false}={})=>{
  let result;for(let n=0;n<Math.ceil(seconds*120);n++)result=motion.step(1/120,min,max,blocked);return result;
};
const finite=s=>{
  assert.ok(Number.isFinite(s.x)&&Number.isFinite(s.velocity));
  for(const name of ['near','far']){
    const f=s.rig[name];assert.ok(Number.isFinite(f.x)&&Number.isFinite(f.lift)&&Number.isFinite(f.angle));
    assert.ok(f.lift>=-1e-6&&f.lift<18);assert.ok(Math.abs(f.x)<75,'feet remain within two-bone leg reach');
    if(f.grounded)assert.ok(Math.abs(f.lift)<1e-8);
  }
};
let checks=0;
for(const scale of [.43,.645,.86,1.075]){
  const motion=new Motion(100);motion.configure({scale,walking:true,wandering:true});
  let previous=motion.snapshot(),lockedSamples=0,footfalls=0;
  for(let n=0;n<1200;n++){
    const current=motion.step(1/120,-10000,10000);finite(current);
    for(const name of ['near','far']){
      if(previous.rig[name].grounded&&current.rig[name].grounded){
        const a=previous.x+previous.rig[name].x*scale,b=current.x+current.rig[name].x*scale;
        assert.ok(Math.abs(a-b)<1e-7,'a stance foot must stay fixed in screen space');lockedSamples++;
      }
      if(!previous.rig[name].grounded&&current.rig[name].grounded)footfalls++;
    }
    previous=current;
  }
  assert.ok(lockedSamples>500&&footfalls>20);assert.ok(previous.x>100);checks++;
}
// Stop at every phase, including anticipation and either swing leg.
for(const elapsed of [.05,.22,.39,.52,.71,1.05,1.31]){
  const motion=new Motion();motion.configure({walking:true,wandering:true,scale:.645});tick(motion,elapsed);
  const start=motion.snapshot();motion.configure({walking:false,wandering:false});
  let previous=start,groundContacts=0;
  for(let n=0;n<180;n++){
    const s=motion.step(1/120,-1000,1000);finite(s);
    for(const name of ['near','far'])if(previous.rig[name].grounded&&s.rig[name].grounded){
      assert.ok(Math.abs((previous.x+previous.rig[name].x*.645)-(s.x+s.rig[name].x*.645))<1e-7);groundContacts++;
    }
    previous=s;
  }
  assert.ok(previous.rig.settled);assert.equal(previous.mode,'idle');assert.equal(previous.velocity,0);
  assert.ok(previous.rig.near.grounded&&previous.rig.far.grounded);assert.ok(groundContacts>100);
  assert.ok(previous.x-start.x<40,'stopping completes only the current step and a short accommodation');
  const stoppedX=previous.x;assert.equal(tick(motion,1).x,stoppedX);
}
checks++;
{
  const motion=new Motion(500);motion.configure({walking:true,wandering:true,scale:.645});tick(motion,1);
  let s=tick(motion,1,{blocked:true});assert.ok(s.rig.settled);const x=s.x;
  s=tick(motion,1,{blocked:true});assert.equal(s.x,x);
  s=tick(motion,.1);assert.equal(s.mode,'anticipating');assert.equal(s.x,x);
  s=tick(motion,1);assert.ok(s.x>x);checks++;
}
{
  const motion=new Motion(250);motion.configure({walking:true,wandering:true});tick(motion,.8);
  motion.face(-1);let previous=motion.snapshot(),changed=false,sawTurn=false;
  for(let n=0;n<300;n++){
    const s=motion.step(1/120,0,1000);finite(s);
    if(s.mode==='turning'){sawTurn=true;assert.equal(s.velocity,0);assert.ok(s.rig.near.grounded&&s.rig.far.grounded);}
    if(s.direction!==previous.direction){changed=true;assert.ok(s.rig.near.grounded&&s.rig.far.grounded);assert.equal(s.velocity,0);}
    previous=s;
  }
  assert.ok(changed&&sawTurn);assert.equal(previous.direction,-1);assert.ok(previous.velocity<0);checks++;
}
{
  const motion=new Motion(70);motion.configure({walking:true,wandering:true,scale:.645});
  const directions=new Set();let turns=0;
  for(let n=0;n<12000;n++){
    const s=motion.step(1/120,0,200);finite(s);directions.add(s.direction);
    assert.ok(s.x>=0&&s.x<=200);if(s.mode==='turning')turns++;
  }
  assert.equal(directions.size,2);assert.ok(turns>100);checks++;
}
{
  const motion=new Motion(40);motion.configure({walking:true,wandering:false,scale:.645});
  const s=tick(motion,3);finite(s);assert.equal(s.x,40);assert.ok(s.pace>0);assert.equal(s.travelVelocity,0);
  motion.configure({walking:false});assert.ok(tick(motion,1.5).rig.settled);checks++;
}
{
  const motion=new Motion(40);motion.configure({walking:true,wandering:true,scale:.645});tick(motion,1.1);
  const before=motion.snapshot();motion.x+=60;motion.configure({scale:1.075});const after=motion.snapshot();
  for(const name of ['near','far'])assert.ok(Math.abs(before.rig[name].x-after.rig[name].x)<1e-8);
  finite(tick(motion,1));motion.place(99);assert.equal(motion.snapshot().x,99);assert.ok(motion.snapshot().rig.settled);
  motion.configure({walking:false});assert.equal(tick(motion,1).x,99);checks++;
}
{
  const motion=new Motion(25);motion.configure({walking:true,wandering:true});
  const s=tick(motion,3,{min:0,max:50});finite(s);assert.equal(s.x,25);assert.equal(s.travelVelocity,0);assert.ok(s.pace>0);
  motion.configure({walking:false});assert.ok(tick(motion,1.5,{min:0,max:50}).rig.settled);checks++;
}
{
  const motion=new Motion();motion.configure({walking:true,wandering:true,scale:.645,speed:1.5});tick(motion,.8);
  for(let n=0;n<800;n++){
    if(n%100===0)motion.configure({speed:n%200===0?.6:1.5});
    const s=motion.step(1/120,-10000,10000);finite(s);
    assert.ok(Math.abs(s.rig.near.x)<45&&Math.abs(s.rig.far.x)<45,'speed changes must not stretch one step');
  }
  checks++;
}
console.log(JSON.stringify({ok:true,checks,coverage:['stance foot lock at four sizes','stop at seven gait phases','hover stop and restart anticipation','turn only on double support','repeated bounded turns','in-place gait','resize and drag preserve finite pose','narrow stage treadmill','speed changes preserve short stride']}));
