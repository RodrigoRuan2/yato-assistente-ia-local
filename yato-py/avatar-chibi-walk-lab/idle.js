/* Timing and pose selection for the isolated idle experiment. No DOM or drawing. */
(function(root){
  'use strict';
  const KINDS=['weight','sleeve','pocket','look'];
  const smooth=t=>t*t*(3-2*t);
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

  class YatoIdle {
    constructor({random=Math.random,enabled=true,showcase=false}={}) {
      if(typeof random!=='function')throw new TypeError('random must be a function');
      this.random=random;
      this.enabled=Boolean(enabled);this.showcase=Boolean(showcase);
      this.available=true;this.reducedMotion=false;this.blocked=false;
      this.lastKind='';this.pending='';this.kind='';
      this.nextWeightSide=-1;this.nextLookSide=-1;this.showcaseIndex=0;
      this.segments=[];this.segmentIndex=0;this.segmentAge=0;this.elapsed=0;this.side=0;
      this.nextIn=this.showcase?.6:this.range(10,22);
    }

    range(min,max) {
      const value=Number(this.random());
      return min+(max-min)*(Number.isFinite(value)?clamp(value,0,1):.5);
    }

    configure(options={}) {
      const nextEnabled=options.enabled===undefined?this.enabled:Boolean(options.enabled);
      const nextShowcase=options.showcase===undefined?this.showcase:Boolean(options.showcase);
      const changed=nextEnabled!==this.enabled||nextShowcase!==this.showcase;
      this.enabled=nextEnabled;this.showcase=nextShowcase;
      if(changed){
        this.cancel();this.showcaseIndex=0;
        if(this.enabled&&this.showcase)this.nextIn=.6;
      }
      return this.snapshot();
    }

    // A request lasts only until the next available step, never through a walk
    // or conversation. Explicit requests also respect the enabled/reduced mode.
    request(kind) {
      if(!KINDS.includes(kind)||!this.enabled||this.reducedMotion||this.kind)return false;
      this.pending=kind;
      return true;
    }

    clearGesture() {
      this.kind='';this.pending='';this.segments=[];this.segmentIndex=0;
      this.segmentAge=0;this.elapsed=0;this.side=0;
    }

    scheduleQuiet() {this.nextIn=this.showcase?this.range(2,3):this.range(10,22);}

    cancel() {
      this.clearGesture();this.scheduleQuiet();
      return this.snapshot();
    }

    chooseKind() {
      if(this.showcase){
        let kind;
        do {kind=KINDS[this.showcaseIndex%KINDS.length];this.showcaseIndex++;} while(kind===this.lastKind);
        return kind;
      }
      const candidates=KINDS.filter(kind=>kind!==this.lastKind);
      return candidates[Math.min(candidates.length-1,Math.floor(this.range(0,candidates.length)))];
    }

    start(kind) {
      this.kind=kind;this.pending='';this.lastKind=kind;
      this.elapsed=0;this.segmentAge=0;this.segmentIndex=0;this.nextIn=0;
      const move=(from,to,duration)=>({from,to,duration});
      const hold=(frame,duration)=>move(frame,frame,duration);
      if(kind==='weight'){
        this.side=this.nextWeightSide;this.nextWeightSide*=-1;
        const frame=this.side<0?1:2;
        this.segments=[move(0,frame,.6),hold(frame,this.range(2,4)),move(frame,0,.65)];
      }else if(kind==='sleeve'){
        this.side=0;
        this.segments=[move(0,3,.3),move(3,4,.24),hold(4,.6),move(4,3,.22),move(3,0,.3)];
      }else if(kind==='pocket'){
        this.side=0;
        this.segments=[move(0,5,.3),move(5,6,.28),hold(6,this.range(2,4)),move(6,5,.28),move(5,0,.35)];
      }else{
        this.side=this.nextLookSide;this.nextLookSide*=-1;
        const frame=this.side<0?7:8;
        this.segments=[move(0,frame,.22),hold(frame,this.range(1.4,2.5)),move(frame,0,.28)];
      }
    }

    advance(dt) {
      while(this.kind&&dt>0){
        const segment=this.segments[this.segmentIndex];
        const used=Math.min(dt,Math.max(0,segment.duration-this.segmentAge));
        this.segmentAge+=used;this.elapsed+=used;dt-=used;
        if(this.segmentAge+1e-9>=segment.duration){
          this.segmentIndex++;this.segmentAge=0;
          if(this.segmentIndex===this.segments.length){this.clearGesture();this.scheduleQuiet();}
        }else break;
      }
    }

    step(dt,{available=true,reducedMotion=false}={}) {
      this.available=Boolean(available);this.reducedMotion=Boolean(reducedMotion);
      const blocked=!this.enabled||!this.available||this.reducedMotion;
      if(blocked){
        // Draw a fresh cooldown once on interruption; a sustained conversation
        // must not keep advancing the timer or sampling new random durations.
        if(!this.blocked)this.cancel();
        else this.clearGesture();
        this.blocked=true;
        return this.snapshot();
      }
      this.blocked=false;
      dt=Number.isFinite(dt)?clamp(dt,0,.1):0;
      if(this.pending){this.start(this.pending);this.advance(dt);}
      else if(this.kind)this.advance(dt);
      else if(dt>=this.nextIn){
        const remainder=dt-this.nextIn;
        this.start(this.chooseKind());this.advance(remainder);
      }else this.nextIn-=dt;
      return this.snapshot();
    }

    snapshot() {
      const active=Boolean(this.kind),segment=active?this.segments[this.segmentIndex]:null;
      const frameA=segment?.from??0,frameB=segment?.to??0;
      const mix=segment?smooth(clamp(this.segmentAge/segment.duration,0,1)):0;
      const duration=this.segments.reduce((total,item)=>total+item.duration,0);
      const weight=frame=>frame===1?-1:frame===2?1:0;
      const gaze=frame=>frame===7?-1:frame===8?1:0;
      return {enabled:this.enabled,showcase:this.showcase,available:this.available,
        reducedMotion:this.reducedMotion,blocked:this.blocked,active,kind:this.kind,
        lastKind:this.lastKind,pending:this.pending,side:this.side,elapsed:this.elapsed,
        duration,progress:duration?this.elapsed/duration:0,nextIn:this.nextIn,
        phase:active?(frameA===frameB?'hold':'transition'):(this.blocked?'blocked':'waiting'),
        frameA,frameB,mix,weight:weight(frameA)*(1-mix)+weight(frameB)*mix,
        gaze:gaze(frameA)*(1-mix)+gaze(frameB)*mix};
    }
  }

  root.YatoIdle=YatoIdle;
  if(typeof module!=='undefined'&&module.exports)module.exports=YatoIdle;
})(typeof window!=='undefined'?window:globalThis);
