/* Articulated gait, shared by Electron and the studio. No DOM/IPC.
 * x/velocity are screen units; rig feet are pose units relative to root x=192.
 * Pass scale=renderedHeight/512. A planted foot keeps its world coordinate while
 * the root moves. Walking in place uses the same gait over a virtual treadmill.
 * rig feet: {x, lift>=0 above sole y=532, angle radians, grounded}.
 * rig bodyY is positive down; bodyX is a local offset; armSwing is radians.
 */
(function(root){
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const smooth=t=>t*t*(3-2*t);
  const damp=(from,to,dt,rate=14)=>to+(from-to)*Math.exp(-rate*dt);
  const SPEED=90, STEP_TIME=.36, ANTICIPATION=.16, SETTLE_TIME=.14, TURN_TIME=.28;
  class YatoMotion {
    constructor(x=0){
      this.x=Number.isFinite(x)?x:0;this.velocity=0;this.travelVelocity=0;
      this.direction=1;this.pendingDirection=null;this.turnTime=null;
      this.cycle=0;this.mode='idle';this.blocked=false;
      this.options={walking:false,wandering:false,speed:1,scale:1};
      this._gaitX=this.x;this._lastX=this.x;this._segment=null;
      this._timer=0;this._gaitTravel=false;this._travelRoom=true;this._nextFoot='far';
      this._bodyY=0;this._bodyX=0;this._arms=0;
      this._feet={near:{world:this.x+8,lift:0,angle:0,grounded:true},far:{world:this.x-8,lift:0,angle:0,grounded:true}};
    }
    configure(options={}){
      this._syncExternalPosition();
      if(Number.isFinite(options.scale)){
        const scale=clamp(options.scale,.1,4),ratio=scale/this.options.scale;
        if(Math.abs(ratio-1)>1e-9){
          // Resize targets in pose space, not around the previous window origin.
          for(const foot of Object.values(this._feet))foot.world=this._gaitX+(foot.world-this._gaitX)*ratio;
          if(this._segment){
            const s=this._segment;
            for(const key of ['x0','x1','foot0','foot1'])s[key]=this._gaitX+(s[key]-this._gaitX)*ratio;
            s.v0*=ratio;s.v1*=ratio;
          }
          this.velocity*=ratio;this.travelVelocity*=ratio;this.options.scale=scale;
        }
      }
      for(const key of ['walking','wandering'])if(typeof options[key]==='boolean')this.options[key]=options[key];
      if(Number.isFinite(options.speed))this.options.speed=clamp(options.speed,.6,1.5);
      if(options.direction===1||options.direction===-1)this.face(options.direction);
    }
    face(direction){
      if(direction!==1&&direction!==-1)return;
      if(this.mode==='idle'){this.direction=direction;this.pendingDirection=null;}
      else this.pendingDirection=direction===this.direction?null:direction;
    }
    place(x){
      if(!Number.isFinite(x))return;
      this.x=x;this._gaitX=x;this._lastX=x;
      this.velocity=0;this.travelVelocity=0;this._segment=null;
      this.mode='idle';this._timer=0;this.turnTime=null;this.pendingDirection=null;this.cycle=0;
      for(const [name,offset] of [['near',8],['far',-8]])this._feet[name]={world:x+offset*this.options.scale,lift:0,angle:0,grounded:true};
      this._bodyX=0;this._bodyY=0;this._arms=0;
    }
    _syncExternalPosition(){
      const delta=this.x-this._lastX;
      if(!Number.isFinite(delta)||Math.abs(delta)<1e-9)return;
      this._gaitX+=delta;
      for(const foot of Object.values(this._feet))foot.world+=delta;
      if(this._segment)for(const key of ['x0','x1','foot0','foot1'])this._segment[key]+=delta;
      this._lastX=this.x;
    }
    snapshot(){
      const foot=name=>{
        const value=this._feet[name];
        return {x:(value.world-this._gaitX)/this.options.scale,lift:value.lift,angle:value.angle,grounded:value.grounded};
      };
      return {x:this.x,velocity:this.velocity,travelVelocity:this.travelVelocity,direction:this.direction,
        pace:Math.abs(this.velocity)/(SPEED*this.options.scale),cycle:this.cycle,mode:this.mode,
        turnProgress:this.turnTime===null?0:clamp(this.turnTime/TURN_TIME,0,1),blocked:this.blocked,
        rig:{near:foot('near'),far:foot('far'),bodyY:this._bodyY,bodyX:this._bodyX,armSwing:this._arms,
          settled:!this._segment&&(this.mode==='idle'||this.mode==='turning')}};
    }
    _beginSegment(kind,min,max){
      const scale=this.options.scale,speed=this.options.speed;
      const v0=this.velocity,v1=kind==='settle'?0:this.direction*SPEED*scale*speed;
      const incomingSpeed=Math.abs(v0)/(SPEED*scale);
      // A speed slider change adjusts cadence without making one huge stride.
      const cadence=kind==='settle'?Math.max(.6,incomingSpeed):incomingSpeed>.01?(incomingSpeed+speed)*.5:speed;
      const duration=(kind==='settle'?.30:STEP_TIME)/cadence;
      let distance=(v0+v1)*.5*duration;
      if(this._gaitTravel)distance=clamp(this.x+distance,min,max)-this.x;
      const x0=this._gaitX,x1=x0+distance;
      // Shift weight onto the last plant, then land the trailing foot beside it.
      const foot=this._nextFoot,foot1=x1+this.direction*(kind==='settle'?-7:16)*scale;
      const normalizedDistance=Math.abs(foot1-this._feet[foot].world)/scale;
      this._segment={kind,foot,elapsed:0,duration,x0,x1,v0,v1,foot0:this._feet[foot].world,foot1,
        lift:kind==='settle'?Math.min(12,normalizedDistance*.22):Math.min(17,normalizedDistance*.30)};
      this._feet[foot].grounded=false;
      this.mode=kind==='settle'?'stopping':Math.abs(v0)<1?'starting':'walking';
    }
    _wantsStop(){return !this.options.walking||this.blocked||this.pendingDirection!==null||(this.options.wandering&&this._travelRoom)!==this._gaitTravel;}
    _evaluateSegment(dt,min,max){
      const s=this._segment;s.elapsed=Math.min(s.duration,s.elapsed+dt);
      const t=s.elapsed/s.duration,t2=t*t,t3=t2*t;
      // Hermite root trajectory keeps both position and speed continuous.
      const next=(2*t3-3*t2+1)*s.x0+(t3-2*t2+t)*s.duration*s.v0+(-2*t3+3*t2)*s.x1+(t3-t2)*s.duration*s.v1;
      const derivative=((6*t2-6*t)*s.x0+(3*t2-4*t+1)*s.duration*s.v0+(-6*t2+6*t)*s.x1+(3*t2-2*t)*s.duration*s.v1)/s.duration;
      const delta=next-this._gaitX;this._gaitX=next;
      if(this._gaitTravel)this.x=clamp(this.x+delta,min,max);
      this.velocity=derivative;this.travelVelocity=this._gaitTravel?derivative:0;
      const moving=this._feet[s.foot],u=smooth(t);
      moving.world=s.foot0+(s.foot1-s.foot0)*u;
      moving.lift=s.lift*Math.sin(Math.PI*u);
      moving.angle=-this.direction*.13*Math.sin(Math.PI*u);
      this.cycle=((s.foot==='far'?0:.5)+t*.5)%1;
      if(this._wantsStop())this.mode='stopping';
      if(t>=1){
        moving.world=s.foot1;moving.lift=0;moving.angle=0;moving.grounded=true;
        this._nextFoot=s.foot==='near'?'far':'near';this._segment=null;
        if(s.kind==='settle'){this.velocity=0;this.travelVelocity=0;this.mode='settling';this._timer=0;}
        else if(this._wantsStop())this._beginSegment('settle',min,max);
        else this._beginSegment('walk',min,max);
      }
    }
    step(dt,min=-Infinity,max=Infinity,blocked=false){
      dt=clamp(Number.isFinite(dt)?dt:0,0,.05);max=Math.max(min,max);
      this._syncExternalPosition();
      if(this.x<min||this.x>max)this.place(clamp(this.x,min,max));
      this.blocked=Boolean(blocked);
      // A stage too narrow for two steps becomes a treadmill, not edge jitter.
      this._travelRoom=max-min>104*this.options.scale;
      const active=this.options.walking&&!this.blocked;
      // Reserve current footfall plus the final accommodation near each edge.
      if(active&&this.options.wandering&&this.pendingDirection===null&&this.mode!=='turning'){
        const distance=this.direction>0?max-this.x:this.x-min;
        if(distance<52*this.options.scale&&max-min>104*this.options.scale)this.pendingDirection=-this.direction;
      }
      if(this._segment)this._evaluateSegment(dt,min,max);
      else if(this.mode==='anticipating'){
        this._timer+=dt;
        if(this._wantsStop()){this.mode='settling';this._timer=0;}
        else if(this._timer>=ANTICIPATION)this._beginSegment('walk',min,max);
      }else if(this.mode==='settling'){
        this._timer+=dt;
        if(this._timer>=SETTLE_TIME){
          if(this.pendingDirection!==null&&this.pendingDirection!==this.direction){this.mode='turning';this.turnTime=0;}
          else{this.mode='idle';this.pendingDirection=null;}
        }
      }else if(this.mode==='turning'){
        this.turnTime+=dt;
        if(this.turnTime>=TURN_TIME){this.direction=this.pendingDirection??this.direction;this.pendingDirection=null;this.turnTime=null;this.mode='idle';}
      }else if(active){
        if(this.pendingDirection!==null){this.mode='turning';this.turnTime=0;}
        else{
          this._gaitTravel=this.options.wandering&&this._travelRoom;this.mode='anticipating';this._timer=0;
          this._nextFoot=this._feet.near.world*this.direction<this._feet.far.world*this.direction?'near':'far';
        }
      }
      const segment=this._segment,t=segment?segment.elapsed/segment.duration:0;
      const bodyY=this.mode==='anticipating'?2.1*Math.sin(Math.PI*clamp(this._timer/ANTICIPATION,0,1)):
        segment?-2.1*Math.sin(Math.PI*t):this.mode==='settling'?1.4*Math.sin(Math.PI*clamp(this._timer/SETTLE_TIME,0,1)):0;
      this._bodyY=damp(this._bodyY,bodyY,dt);
      this._bodyX=damp(this._bodyX,segment?this.direction*1.6:0,dt);
      const near=(this._feet.near.world-this._gaitX)/this.options.scale,far=(this._feet.far.world-this._gaitX)/this.options.scale;
      this._arms=damp(this._arms,segment?clamp((far-near)/64,-1,1)*.22:0,dt);
      this._lastX=this.x;
      return this.snapshot();
    }
  }
  if(typeof module==='object'&&module.exports)module.exports=YatoMotion;
  else root.YatoMotion=YatoMotion;
})(globalThis);
