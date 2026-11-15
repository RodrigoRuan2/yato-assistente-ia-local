// App-rendered canvases only. Hidden/offscreen and positioned on monitor 2.
'use strict';
const {app,BrowserWindow,nativeImage,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const Target=require('../display-target.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const resultPath=path.join(__dirname,'pulse-visibility-result.json');
let win;
const deadline=setTimeout(()=>{console.error('Pulse visibility QA timed out');app.exit(1);},30000);

function comparePulsePixels(){
  const source=frames[0],W=225,H=375,scale=330/512,clock=3.2;
  const makeCanvas=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;return c;};
  const body=makeCanvas(),bodyCtx=body.getContext('2d');
  bodyCtx.translate(W/2,H-12);
  bodyCtx.drawImage(source,-192*scale,-532*scale,384*scale,560*scale);
  const opaque=bodyCtx.getImageData(0,0,W,H).data;
  const draw=(background,kind)=>{
    const c=makeCanvas(),g=c.getContext('2d'),fx=new YatoEffects();
    g.fillStyle=background;g.fillRect(0,0,W,H);
    g.save();g.translate(W/2,H-12);
    fx.clock=clock;
    if(kind==='pulse')fx.materializeAge=.675;
    if(kind!=='plain')fx.render(g,source,-192*scale,-532*scale,scale,0,{enabled:kind!=='off',poseKey:'front',reducedMotion:false});
    g.drawImage(source,-192*scale,-532*scale,384*scale,560*scale);g.restore();
    return c;
  };
  const compare=(a,b)=>{
    const ap=a.getContext('2d').getImageData(0,0,W,H).data,bp=b.getContext('2d').getImageData(0,0,W,H).data;
    let pixels12=0,changed=0,maxDelta=0,opaqueChanged=0,opaqueMaxDelta=0;
    for(let i=0;i<ap.length;i+=4){
      const delta=Math.max(Math.abs(ap[i]-bp[i]),Math.abs(ap[i+1]-bp[i+1]),Math.abs(ap[i+2]-bp[i+2]));
      if(delta>=12)pixels12++;
      if(delta>0)changed++;
      maxDelta=Math.max(maxDelta,delta);
      if(opaque[i+3]===255){if(delta>0)opaqueChanged++;opaqueMaxDelta=Math.max(opaqueMaxDelta,delta);}
    }
    return {pixels12,changed,maxDelta,opaqueChanged,opaqueMaxDelta};
  };
  const darkBase=draw('#17141e','ambient'),darkPulse=draw('#17141e','pulse');
  const lightBase=draw('#eee9f5','ambient'),lightPulse=draw('#eee9f5','pulse');
  const off=compare(draw('#17141e','off'),draw('#17141e','plain'));
  const grid=document.createElement('canvas');grid.width=W*4;grid.height=H+32;
  const g=grid.getContext('2d');g.fillStyle='#22202b';g.fillRect(0,0,grid.width,grid.height);
  const items=[[darkBase,'Ambiente · escuro'],[darkPulse,'Pulso · escuro'],[lightBase,'Ambiente · claro'],[lightPulse,'Pulso · claro']];
  items.forEach(([canvas,label],i)=>{g.drawImage(canvas,i*W,32);g.fillStyle='#ece5f8';g.font='13px sans-serif';g.textAlign='center';g.fillText(label,i*W+W/2,21);});
  return {size:{width:W,height:H,percent:75,scale},sameClock:clock,peakAge:.675,
    dark:compare(darkBase,darkPulse),light:compare(lightBase,lightPulse),off,
    png:grid.toDataURL('image/png')};
}

async function checkRendererPulse(){
  window.setEffects(true);
  effects.clock=3.2;
  const before=window.avatarDebug().effectState.clock;
  window.materializar();
  const after=window.avatarDebug().effectState.clock;
  const initial=window.avatarDebug().effectState;
  let lastActiveAge=-1,firstActiveAt=null,endedAt=null,activeSamples=0;
  await new Promise((resolve,reject)=>{
    const start=performance.now();
    function sample(now){
      const s=window.avatarDebug().effectState;
      if(s.materializing){activeSamples++;lastActiveAge=s.materializeAge;if(firstActiveAt===null)firstActiveAt=now;}
      if(activeSamples&& !s.materializing){endedAt=now;resolve();return;}
      if(now-start>5000){reject(new Error('Renderer pulse did not finish'));return;}
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  window.setEffects(false);
  // Let the actual renderer acknowledge disabling, not only the setting flag.
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  return {before,after,initial,lastActiveAge,activeSamples,
    observedWallDurationMs:endedAt-firstActiveAt,afterOff:window.avatarDebug().effectState};
}

app.whenReady().then(async()=>{
  const display=Target.selectDisplay(screen);
  const bounds=Target.windowBounds(display,{width:225,height:375});
  win=new BrowserWindow({...bounds,frame:false,transparent:true,show:false,
    webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true}});
  assert.ok(Target.contains(display,win.getBounds()),'Hidden QA must stay on monitor 2');
  const js=code=>win.webContents.executeJavaScript(code);
  await win.loadFile(path.resolve(__dirname,'..','index.html'),{query:{desktop:'1',effects:'1'}});
  for(let n=0;n<120&&!(await js('window.avatarDebug().ready'));n++)await pause(50);
  assert.equal(await js('window.avatarDebug().ready'),true);
  assert.equal(await js('window.avatarDebug().width'),225);
  assert.equal(await js('window.avatarDebug().height'),375);
  await js('window.setMovimento("blinking",false);window.setMovimento("breathing",false);window.setMovimento("idleMotion",false)');
  const pixels=await js(`(${comparePulsePixels.toString()})()`);
  const imagePath=path.join(__dirname,'pulse-visibility.png');
  fs.writeFileSync(imagePath,nativeImage.createFromDataURL(pixels.png).toPNG());
  delete pixels.png;
  const renderer=await js(`(${checkRendererPulse.toString()})()`);
  const result={ok:false,date:new Date().toISOString(),monitor:{id:display.id,label:display.label,bounds:win.getBounds()},hidden:!win.isVisible(),pixels,renderer};
  fs.writeFileSync(resultPath,JSON.stringify(result,null,2));
  for(const background of ['dark','light']){
    assert.ok(pixels[background].pixels12>=100,`${background}: pulse must visibly change at least 100 pixels by RGB>=12`);
    assert.equal(pixels[background].opaqueMaxDelta,0,`${background}: opaque character colors must stay identical`);
  }
  assert.equal(pixels.off.changed,0,'Disabled FX must match plain body pixel for pixel');
  assert.equal(renderer.before,renderer.after,'Trigger must not reset the running ambient clock');
  assert.equal(renderer.initial.materializeAge,0,'Trigger must queue the pulse before the next rendered frame');
  assert.ok(renderer.activeSamples>=12,'Pulse must be present over multiple rendered frames');
  assert.ok(renderer.lastActiveAge>=1.25&&renderer.lastActiveAge<1.35,'Pulse must remain active until close to 1.35s');
  assert.equal(renderer.afterOff.enabled,false);
  assert.equal(renderer.afterOff.materializing,false);
  result.ok=true;
  result.checks=['225x375 desktop size','same-clock ambient/pulse pixel comparison on dark and light','>=100 pixels with RGB delta >=12','opaque avatar colors unchanged','disabled effect pixel-identical','trigger preserves ambient clock','renderer pulse expires at 1.35s','off cancels pulse'];
  fs.writeFileSync(resultPath,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  clearTimeout(deadline);win.destroy();app.quit();
}).catch(error=>{console.error(error);clearTimeout(deadline);if(win&&!win.isDestroyed())win.destroy();app.exit(1);});
