/* Sprite gait shared by studio and desktop. No DOM, cutout rig or IPC.
 * Existing cadence: .9 s cycle at speed 1; travel reaches 110 px/s.
 * Stops land at cycle 0 or .5, then settle before the front pose takes over.
 * anticipation: 0..1 during .12 s preparation. settleProgress: 0..1 during
 * .18 s settling, 1 at idle, otherwise 0. At established walking speeds,
 * finishing the current half-step and settling takes less than 1.1 s.
 * The gait never speeds up to meet an arbitrary stopping deadline.
 */
(function(root){
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const SPEED=110,CYCLE=.9,ANTICIPATION=.12,SETTLE=.18,TURN=.36;
  const support=cycle=>Math.round(cycle*2)/2%1;
  class YatoMotion {
    constructor(x=0){
      this.x=Number.isFinite(x)?x:0;this.velocity=0;this.travelVelocity=0;
      this.direction=1;this.pendingDirection=null;this.turnTime=null;
      this.cycle=0;this.mode='idle';this.blocked=false;
      this.options={walking:false,wandering:false,speed:1};
      this._timer=0;this._stop=null;
    }
    configure(options={}){
      for(const key of ['walking','wandering'])if(typeof options[key]==='boolean')this.options[key]=options[key];
      if(Number.isFinite(options.speed))this.options.speed=clamp(options.speed,.6,1.5);
      if(options.direction===1||options.direction===-1)this.face(options.direction);
    }
    face(direction){
      if(direction!==1&&direction!==-1)return;
      if(this.mode==='idle'&&!this.options.walking){
        this.direction=direction;this.pendingDirection=null;this.turnTime=null;
      }else this.pendingDirection=direction===this.direction?null:direction;
    }
    place(x){
      if(!Number.isFinite(x))return;
      this.x=x;this.velocity=0;this.travelVelocity=0;
      this.cycle=support(this.cycle);this.mode='idle';this._timer=0;
      this._stop=null;this.pendingDirection=null;this.turnTime=null;
    }
    snapshot(){return {x:this.x,velocity:this.velocity,travelVelocity:this.travelVelocity,direction:this.direction,
      pace:Math.abs(this.velocity)/SPEED,cycle:this.cycle,mode:this.mode,blocked:this.blocked,
      turnProgress:this.turnTime===null?0:clamp(this.turnTime/TURN,0,1),
      anticipation:this.mode==='anticipating'?clamp(this._timer/ANTICIPATION,0,1):0,
      settleProgress:this.mode==='settling'?clamp(this._timer/SETTLE,0,1):this.mode==='idle'?1:0};}
    _stopPlan(){
      const phase=((this.cycle%.5)+.5)%.5;
      // Close to support, settle there instead of taking another half cycle.
      const distance=phase<.015||.5-phase<.015?0:.5-phase;
      const rate=Math.abs(this.velocity)/(SPEED*CYCLE);
      // A contact snap is at most .015 of a cycle. Its 40 ms brake moves
      // at most 3.3 px at speed 1.5 while the supported pose stays fixed.
      if(distance===0||rate<1e-6){
        return {distance:0,rate:0,cruise:0,brake:.04,duration:.04,
          integral:.02,target:support(this.cycle)};
      }
      // Cruise only as far as needed, then brake linearly. Both phase and
      // travel integrate this same profile; neither accelerates when stopping.
      const brake=Math.min(.22,2*distance/rate);
      const cruise=Math.max(0,distance/rate-brake/2);
      return {distance,rate,cruise,brake,duration:cruise+brake,
        integral:cruise+brake/2,target:(this.cycle+distance)%1};
    }
    _beginStop(){
      if(Math.abs(this.velocity)<.01&&Math.abs(this.travelVelocity)<.01){this._settle();return;}
      this._stop={...this._stopPlan(),elapsed:0,cycle:this.cycle,v0:this.velocity,travel0:this.travelVelocity};
      this.mode='stopping';
    }
    _settle(){
      this._stop=null;this.velocity=0;this.travelVelocity=0;this.mode='settling';this._timer=0;
      this.cycle=support(this.cycle);
    }
    _move(distance,min,max){this.x=clamp(this.x+distance,min,max);}
    _advanceStop(dt,min,max){
      const s=this._stop,before=s.elapsed;
      s.elapsed=Math.min(s.duration,s.elapsed+dt);
      const integrated=time=>{
        const braking=Math.max(0,time-s.cruise);
        return Math.min(time,s.cruise)+braking-braking*braking/(2*s.brake);
      };
      const travelTime=integrated(s.elapsed),previousTime=integrated(before);
      const factor=1-clamp((s.elapsed-s.cruise)/s.brake,0,1);
      // Preserve the final deceleration when walking and wandering turn off
      // together, as the existing renderer does.
      this._move(s.travel0*(travelTime-previousTime),min,max);
      this.velocity=s.v0*factor;this.travelVelocity=s.travel0*factor;
      this.cycle=(s.cycle+s.rate*travelTime)%1;
      if(s.elapsed>=s.duration){
        this.cycle=s.target;this._settle();
        // Carry the unused fraction of this tick into settling so the native
        // timer does not add another whole tick to the last footfall.
        this._timer=Math.max(0,dt-(s.elapsed-before));
      }
    }
    _beginTurn(){this.mode='turning';this.turnTime=0;this.velocity=0;this.travelVelocity=0;}
    step(dt,min=-Infinity,max=Infinity,blocked=false){
      dt=clamp(Number.isFinite(dt)?dt:0,0,.05);max=Math.max(min,max);
      if(this.x<min||this.x>max)this.place(clamp(this.x,min,max));
      this.blocked=Boolean(blocked);
      const active=this.options.walking&&!this.blocked;
      const travel=this.options.wandering&&max-min>8;
      if(this._stop){this._advanceStop(dt,min,max);return this.snapshot();}
      if(this.mode==='settling'){
        this._timer+=dt;
        if(this._timer>=SETTLE){
          if(this.pendingDirection!==null&&!this.blocked)this._beginTurn();
          else{this.mode='idle';this._timer=0;}
        }
        return this.snapshot();
      }
      if(this.mode==='turning'){
        if(this.blocked)return this.snapshot();
        this.turnTime+=dt;
        if(this.turnTime>=TURN){
          this.direction=this.pendingDirection??this.direction;this.pendingDirection=null;
          this.turnTime=null;this.cycle=0;this.mode='idle';this._timer=0;
        }
        return this.snapshot();
      }
      if(this.mode==='idle'){
        if(this.pendingDirection!==null&&!this.blocked)this._beginTurn();
        else if(active){this.mode='anticipating';this._timer=0;}
        return this.snapshot();
      }
      if(this.mode==='anticipating'){
        if(!active||this.pendingDirection!==null){this._settle();return this.snapshot();}
        this._timer+=dt;
        if(this._timer>=ANTICIPATION){this.mode='starting';this._timer=0;}
        return this.snapshot();
      }
      // Reserve room for the last half-step before reversing at a screen edge.
      if(active&&travel&&this.pendingDirection===null){
        const available=this.direction>0?max-this.x:this.x-min,plan=this._stopPlan();
        if(available<=Math.abs(this.travelVelocity)*plan.integral+8)this.pendingDirection=-this.direction;
      }
      if(!active||this.pendingDirection!==null){this._beginStop();if(this._stop)this._advanceStop(dt,min,max);return this.snapshot();}
      const target=this.direction*SPEED*this.options.speed,previousVelocity=this.velocity;
      this.velocity+=clamp(target-this.velocity,-400*dt,400*dt);
      const previousTravel=this.travelVelocity,targetTravel=travel?this.velocity:0;
      this.travelVelocity+=clamp(targetTravel-this.travelVelocity,-600*dt,600*dt);
      this._move((previousTravel+this.travelVelocity)*.5*dt,min,max);
      this.cycle=(this.cycle+(Math.abs(previousVelocity)+Math.abs(this.velocity))*.5/SPEED*dt/CYCLE)%1;
      this.mode=Math.abs(target-this.velocity)>1?'starting':'walking';
      return this.snapshot();
    }
  }
  if(typeof module==='object'&&module.exports)module.exports=YatoMotion;
  else root.YatoMotion=YatoMotion;
})(globalThis);
