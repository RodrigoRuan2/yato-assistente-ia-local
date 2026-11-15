const assert=require('node:assert/strict');
const Motion=require('../motion.js');
const dt=1/120;let checks=0;
const step=(m,n=1,min=-10000,max=10000,blocked=false)=>{let s;for(let i=0;i<n;i++)s=m.step(dt,min,max,blocked);return s;};
const make=(direction=1,speed=1)=>{const m=new Motion();m.face(direction);m.configure({walking:true,wandering:true,speed});step(m,160);return m;};
const atSupport=cycle=>Math.min(Math.abs(cycle),Math.abs(cycle-.5),Math.abs(cycle-1))<1e-8;
{
  const m=new Motion();m.configure({walking:true,wandering:true});
  let s=step(m);assert.equal(s.mode,'anticipating');assert.equal(s.x,0);
  for(let i=0;i<10;i++){s=step(m);assert.equal(s.velocity,0);assert.equal(s.x,0);}
  assert.ok(s.anticipation>0&&s.anticipation<1);
  step(m,70);assert.equal(m.velocity,110);
  const x=m.x,c=m.cycle;step(m,108);assert.ok(Math.abs(m.x-x-99)<1e-7);assert.ok(Math.abs(m.cycle-c)<1e-7);checks++;
}
for(const direction of [-1,1])for(const speed of [.6,1,1.5])for(const phase of [0,.01,.08,.22,.39,.49,.5,.61,.86,.99]){
  const m=make(direction,speed);m.cycle=phase;
  const x=m.x;let previousX=x,previousPace=Math.abs(m.velocity),elapsed=0,sawSettle=false;
  m.configure({walking:false,wandering:false});
  while(elapsed<1.2){
    const s=step(m);elapsed+=dt;
    assert.ok(direction*(s.x-previousX)>=-1e-9,'Travel cannot reverse while stopping');
    assert.ok(Math.abs(s.velocity)<=previousPace+1e-9,'Stop velocity must decrease');
    previousX=s.x;previousPace=Math.abs(s.velocity);
    if(s.mode==='settling'){sawSettle=true;assert.ok(atSupport(s.cycle));assert.equal(s.velocity,0);}
    if(s.mode==='idle')break;
  }
  assert.equal(m.mode,'idle');assert.ok(elapsed<=1.1);assert.ok(sawSettle);assert.ok(atSupport(m.cycle));
  assert.ok(direction*(m.x-x)>0,'Turning off both flags preserves final deceleration');
  const rest=m.x;step(m,120);assert.equal(m.x,rest);
}checks++;
for(const frameTime of [.016,1/60,.033,.05]){
  for(const speed of [.6,1,1.5])for(const phase of [.016,.02,.09,.26,.51,.78]){
    const m=make(1,speed);m.cycle=phase;m.configure({walking:false,wandering:false});let elapsed=0;
    while(elapsed<1.2){const s=m.step(frameTime);elapsed+=frameTime;if(s.mode==='idle')break;}
    assert.equal(m.mode,'idle');
    assert.ok(elapsed<=1.1+1e-8,'Finishing a half-step and settling must stay under 1.1 s at established speed');assert.ok(atSupport(m.cycle));
  }
}checks++;
{
  // Observable phase and displacement must slow together, not merely report
  // a decreasing velocity while the animation secretly accelerates.
  for(const direction of [-1,1])for(const speed of [.6,1,1.5])for(const phase of [.016,.02,.12,.25,.38,.48,.516,.72,.98]){
    const m=make(direction,speed);m.cycle=phase;
    let prior=m.snapshot(),priorRate=prior.pace/.9,elapsed=0;
    m.configure({walking:false,wandering:false});
    while(elapsed<1.2){
      const s=step(m);elapsed+=dt;
      const delta=s.cycle-prior.cycle;
      const advance=delta<-.5?delta+1:delta;
      assert.ok(advance>=-1e-9,'Phase cannot rewind during a stop');
      const rate=advance/dt;
      assert.ok(rate<=priorRate+1e-7,'The animation must never accelerate after stopping is requested');
      assert.ok(Math.abs((s.x-prior.x)-direction*99*advance)<1e-7,'Foot phase and body travel must share the same integral');
      assert.ok(Math.abs(s.velocity)<=Math.abs(prior.velocity)+1e-9);
      prior=s;priorRate=rate;
      if(s.mode==='idle')break;
    }
    assert.equal(m.mode,'idle');
  }
  checks++;
}
{
  // A near-contact snap has a deliberately limited exception: a stationary
  // support pose during at most 40 ms of braking, never another whole step.
  for(const direction of [-1,1])for(const phase of [.001,.014,.486,.499,.501,.999]){
    const m=make(direction,1.5);m.cycle=phase;const x=m.x;
    m.configure({walking:false,wandering:false});let elapsed=0;
    while(m.mode!=='idle'&&elapsed<.4){step(m);elapsed+=dt;}
    assert.equal(m.mode,'idle');assert.ok(elapsed<.25);assert.ok(atSupport(m.cycle));
    assert.ok(Math.abs(m.x-x)<=3.3+1e-8,'The contact-snap brake must not slide more than 3.3 px');
  }
  checks++;
}
{
  // An interruption during acceleration may take longer than a cruising
  // stop; advancing the feet faster just to meet the cruise deadline is wrong.
  for(const delay of [20,25,27,30,40,50]){
    const m=new Motion();m.configure({walking:true,wandering:true,speed:.6});step(m,delay);
    let prior=m.snapshot(),priorRate=prior.pace/.9,elapsed=0;
    const phase=prior.cycle%.5,nearContact=phase<.015||.5-phase<.015;
    m.configure({walking:false,wandering:false});
    while(elapsed<2){
      const s=step(m);elapsed+=dt;
      if(!nearContact){
        const raw=s.cycle-prior.cycle,advance=raw<-.5?raw+1:raw;
        assert.ok(advance/dt<=priorRate+1e-7,'Starting interruption must not accelerate the gait');
        priorRate=advance/dt;
      }
      prior=s;
      if(s.mode==='idle')break;
    }
    assert.equal(m.mode,'idle');assert.ok(atSupport(m.cycle));
  }
  checks++;
}
{
  const m=make();let s;
  for(let i=0;i<100;i++)s=step(m,1,-10000,10000,true);
  assert.equal(s.mode,'idle');assert.equal(s.blocked,true);assert.ok(atSupport(s.cycle));
  const x=s.x;step(m,120,-10000,10000,true);assert.equal(m.x,x);
  s=step(m,1,-10000,10000,false);assert.equal(s.mode,'anticipating');assert.equal(s.velocity,0);
  step(m,80);assert.ok(m.x>x);checks++;
}
{
  const m=make();m.cycle=.19;step(m,3,-10000,10000,true);
  let sawSettle=false,sawPrepare=false;
  for(let i=0;i<140;i++){const s=step(m);if(s.mode==='settling')sawSettle=true;if(s.mode==='anticipating'){assert.ok(sawSettle);sawPrepare=true;}}
  assert.ok(sawSettle&&sawPrepare);assert.equal(m.mode,'walking');checks++;
}
{
  const m=make();m.cycle=.21;m.face(-1);let turned=false,old=m.direction;
  for(let i=0;i<240;i++){
    const s=step(m);if(s.mode==='turning'){turned=true;assert.equal(s.velocity,0);assert.equal(s.travelVelocity,0);assert.ok(atSupport(s.cycle));}
    if(s.direction!==old){assert.ok(turned);assert.equal(s.velocity,0);}old=s.direction;
  }
  assert.ok(turned);assert.equal(m.direction,-1);assert.ok(m.velocity<0);checks++;
}
{
  const m=new Motion();m.configure({walking:true,wandering:true,speed:1.5});const directions=new Set(),modes=new Set();
  for(let i=0;i<9000;i++){const s=step(m,1,-60,60);assert.ok(s.x>=-60&&s.x<=60);assert.ok(Number.isFinite(s.x));directions.add(s.direction);modes.add(s.mode);}
  assert.equal(directions.size,2);assert.ok(modes.has('turning')&&modes.has('walking'));checks++;
}
{
  const m=new Motion();m.configure({walking:true,wandering:false});step(m,360);assert.equal(m.x,0);assert.equal(m.velocity,110);
  const t=make();const x=t.x;t.configure({wandering:false});let s=step(t);assert.ok(s.x>x);assert.ok(s.travelVelocity>0&&s.travelVelocity<110);
  step(t,100);assert.equal(t.travelVelocity,0);assert.equal(t.velocity,110);checks++;
}
{
  const m=new Motion();m.configure({walking:true,wandering:true});step(m,5);m.configure({walking:false});step(m,40);assert.equal(m.x,0);assert.equal(m.mode,'idle');
  m.configure({walking:true});step(m,100);m.place(12);assert.equal(m.mode,'idle');assert.equal(m.velocity,0);assert.ok(atSupport(m.cycle));
  let s=step(m,1,-5,5);assert.ok(s.x>=-5&&s.x<=5);
  for(let i=0;i<400;i++){s=step(m,1,0,0);assert.equal(s.x,0);assert.ok(Number.isFinite(s.velocity));}
  assert.equal(s.mode,'walking');checks++;
}
console.log(JSON.stringify({ok:true,checks,coverage:['120 ms anticipation','same .9s cycle and 110px/s','60 established-speed stop combinations under 1.1s','16/16.7/33/50 ms timer cadence','phase never accelerates while stopping','phase and travel share the same integral','near-contact slide capped at 3.3px','starting interruption preserves gait rate','hover pause and restart','support before reverse','repeated bounded turns','in-place gait and travel fade','drag/resize/narrow stage']}));
