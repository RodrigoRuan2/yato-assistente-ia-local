/* Articulated cutout renderer. All geometry is in the approved 384 x 560 pose space.
 * The face is sampled from the existing Yato art; the independent clothing parts
 * live in the prototype's own atlas. No frame swapping drives the limbs. */
(function(root){
  'use strict';
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const PARTS=['torso','upperArm','forearm','thigh','shin','shoe','farUpperArm','farForearm'];
  function solveLeg(hip,ankle,a=108,b=100){
    const dx=ankle.x-hip.x,dy=ankle.y-hip.y;
    const distance=clamp(Math.hypot(dx,dy),Math.abs(a-b)+.01,a+b-.01);
    const angle=Math.atan2(dy,dx)-Math.acos(clamp((a*a+distance*distance-b*b)/(2*a*distance),-1,1));
    return {x:hip.x+Math.cos(angle)*a,y:hip.y+Math.sin(angle)*a};
  }
  class YatoRig {
    constructor(atlas,head){
      this.atlas=atlas;this.head=head;this.parts={};this.lastGeometry=null;
      const raw=document.createElement('canvas');raw.width=atlas.naturalWidth;raw.height=atlas.naturalHeight;
      const c=raw.getContext('2d',{willReadFrequently:true});c.drawImage(atlas,0,0);
      const pixels=c.getImageData(0,0,raw.width,raw.height).data;
      PARTS.forEach((name,n)=>{
        const x0=Math.round((n%4)*raw.width/4),x1=Math.round((n%4+1)*raw.width/4);
        const y0=Math.round(Math.floor(n/4)*raw.height/2),y1=Math.round((Math.floor(n/4)+1)*raw.height/2);
        let left=x1,right=x0,top=y1,bottom=y0;
        for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(pixels[(y*raw.width+x)*4+3]>12){
          left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
        }
        if(right<=left||bottom<=top)throw Error('Peça ausente no atlas: '+name);
        this.parts[name]={x:left,y:top,w:right-left+1,h:bottom-top+1};
      });
    }
    piece(ctx,name,x,y,w,h){
      const p=this.parts[name];ctx.drawImage(this.atlas,p.x,p.y,p.w,p.h,x,y,w,h);
    }
    segment(ctx,name,start,end,width,overlap=8){
      ctx.save();ctx.translate(start.x,start.y);
      ctx.rotate(Math.atan2(end.y-start.y,end.x-start.x)-Math.PI/2);
      this.piece(ctx,name,-width/2,-overlap,width,Math.hypot(end.x-start.x,end.y-start.y)+2*overlap);
      ctx.restore();
    }
    draw(ctx,motion,{time=0,breathing=true,skeleton=false,footLocks=false}={}){
      const r=motion.rig||{near:{x:8,lift:0,angle:0,grounded:true},far:{x:-8,lift:0,angle:0,grounded:true},bodyY:0,bodyX:0,armSwing:0,settled:true};
      const direction=motion.direction<0?-1:1,dy=r.bodyY||0,dx=(r.bodyX||0)*direction;
      const breathe=breathing?Math.sin(time/900)*.6:0;
      const hips={near:{x:195+dx,y:308+dy},far:{x:185+dx,y:308+dy}};
      const feet={},knees={},arms={};
      for(const side of ['near','far']){
        const f=r[side];feet[side]={x:192+f.x*direction,y:510-f.lift};
        knees[side]=solveLeg(hips[side],feet[side]);
        const swing=(r.armSwing||0)*direction*(side==='near'?1:-1);
        const shoulder={x:(side==='near'?168:195)+dx,y:183+dy+breathe};
        const elbow={x:shoulder.x+Math.sin(swing)*65,y:shoulder.y+Math.cos(swing)*65};
        const hand={x:elbow.x+Math.sin(swing-.12)*57,y:elbow.y+Math.cos(swing-.12)*57};
        arms[side]={shoulder,elbow,hand};
      }
      ctx.save();if(direction<0){ctx.translate(384,0);ctx.scale(-1,1);}
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      const leg=side=>{
        ctx.save();if(side==='far')ctx.filter='brightness(0.80)';
        this.segment(ctx,'thigh',hips[side],knees[side],side==='near'?52:49,10);
        this.segment(ctx,'shin',knees[side],feet[side],side==='near'?43:40,9);
        ctx.translate(feet[side].x,feet[side].y);ctx.rotate((r[side].angle||0)*direction);
        this.piece(ctx,'shoe',-25,-26,82,48);ctx.restore();
      };
      const arm=side=>{
        const a=arms[side];ctx.save();if(side==='far')ctx.filter='brightness(0.85)';
        this.segment(ctx,side==='near'?'upperArm':'farUpperArm',a.shoulder,a.elbow,39,10);
        this.segment(ctx,side==='near'?'forearm':'farForearm',a.elbow,a.hand,34,7);ctx.restore();
      };
      arm('far');leg('far');leg('near');
      this.piece(ctx,'torso',140+dx,143+dy+breathe,104,184-breathe);
      // A single constant-size head preserves the approved face and hair.
      ctx.drawImage(this.head,92,0,200,156,92+dx*.35,dy*.35+breathe*.25,200,156);
      arm('near');
      if(skeleton){
        ctx.save();ctx.strokeStyle='#7be5ed';ctx.fillStyle='#142c3d';ctx.lineWidth=2;
        const chain=points=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
          for(const p of points){ctx.beginPath();ctx.arc(p.x,p.y,4,0,2*Math.PI);ctx.fill();ctx.stroke();}};
        for(const side of ['far','near']){chain([hips[side],knees[side],feet[side]]);const a=arms[side];chain([a.shoulder,a.elbow,a.hand]);}
        chain([{x:192+dx,y:151+dy*.35},{x:192+dx,y:238+dy},{x:192+dx,y:308+dy}]);ctx.restore();
      }
      if(footLocks){
        ctx.save();ctx.lineWidth=3;
        for(const side of ['far','near']){
          const foot=feet[side];ctx.strokeStyle=r[side].grounded?'#7fe4b4':'#d4acff';
          ctx.beginPath();ctx.moveTo(foot.x-12,534);ctx.lineTo(foot.x+12,534);ctx.stroke();
          if(!r[side].grounded){ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(foot.x,532);ctx.lineTo(foot.x,foot.y+22);ctx.stroke();ctx.setLineDash([]);}
        }ctx.restore();
      }
      ctx.restore();this.lastGeometry={hips,knees,feet,arms,direction,settled:r.settled};
    }
    debug(){return {parts:Object.keys(this.parts),geometry:this.lastGeometry};}
  }
  YatoRig.solveLeg=solveLeg;root.YatoRig=YatoRig;
})(globalThis);
