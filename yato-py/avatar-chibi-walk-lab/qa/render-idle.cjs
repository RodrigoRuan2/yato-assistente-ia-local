// Isolated idle renderer QA. Hidden/offscreen on monitor 2; no desktop/audio/video capture.
'use strict';
const {app,BrowserWindow,nativeImage,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const Target=require('../display-target.cjs'),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const prefix=process.argv.find(arg=>arg.startsWith('--qa-prefix='))?.split('=')[1]||'idle-v1';
if(!/^[a-z0-9-]{1,64}$/.test(prefix))throw new Error('Invalid QA prefix');
const artifact=name=>path.join(__dirname,prefix+'-'+name);
const save=(name,value)=>fs.writeFileSync(artifact(name+'.json'),JSON.stringify(value,null,2));
app.whenReady().then(async()=>{
  const display=Target.selectDisplay(screen);
  const win=new BrowserWindow({...Target.windowBounds(display,{width:1240,height:980}),show:false,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true}});
  assert.ok(Target.contains(display,win.getBounds()),'QA must remain on monitor 2');
  const js=code=>win.webContents.executeJavaScript(code),state=()=>js('window.avatarDebug?.()');
  await win.loadFile(path.resolve(__dirname,'..','index.html'));
  for(let n=0;n<160&&!(await state())?.ready;n++)await pause(50);
  let s=await state();assert.equal(s?.ready,true);assert.equal(s.idleFrames,9);
  await js('window.setMovimento("blinking",false);window.setMovimento("breathing",false);window.setMovimento("idleMotion",false);window.setMovimento("following",false)');
  const visuals=await js(`(()=>{
    const labels=['Neutro','Apoio esquerdo','Apoio direito','Aproxima manga','Ajusta manga','Aproxima bolso','Mão no bolso','Olhar esquerdo','Olhar direito'];
    const make=(items,columns,face=false,blink=false)=>{
      const tileWidth=face?320:192,tileHeight=face?310:310;
      const c=document.createElement('canvas');c.width=columns*tileWidth;c.height=Math.ceil(items.length/columns)*tileHeight;
      const g=c.getContext('2d');g.fillStyle='#29242f';g.fillRect(0,0,c.width,c.height);
      items.forEach(([frame,label],i)=>{const x=i%columns*tileWidth,y=Math.floor(i/columns)*tileHeight;
        const pose=document.createElement('canvas');pose.width=384;pose.height=560;const p=pose.getContext('2d');p.drawImage(frame,0,0);
        if(blink)p.drawImage(frames[1],132,108,120,28,132,108,120,28);
        if(face)g.drawImage(pose,112,18,160,145,x,y,320,290);else g.drawImage(pose,x,y,192,280);
        g.fillStyle='#e7dff0';g.font='13px sans-serif';g.textAlign='center';g.fillText(label,x+tileWidth/2,y+304);});return c.toDataURL();
    };
    const measure=frame=>{const p=frame.getContext('2d').getImageData(0,0,384,560).data;
      let top=560,bottom=0,left=384,right=0,count=0;const fabric=[];
      for(let y=0;y<560;y++)for(let x=0;x<384;x++)if(p[(y*384+x)*4+3]>180){top=Math.min(top,y);bottom=Math.max(bottom,y);count++;}
      for(let y=top;y<top+140;y++)for(let x=0;x<384;x++)if(p[(y*384+x)*4+3]>180){left=Math.min(left,x);right=Math.max(right,x);}
      for(let y=220;y<300;y++)for(let x=160;x<225;x++){const i=(y*384+x)*4,r=p[i],g=p[i+1],b=p[i+2];
        if(p[i+3]>240&&Math.max(r,g,b)-Math.min(r,g,b)<20&&Math.max(r,g,b)<100)fabric.push(.2126*r+.7152*g+.0722*b);}
      fabric.sort((a,b)=>a-b);
      const region=(x0,y0,x1,y1)=>{const values=[];for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*384+x)*4,r=p[i],g=p[i+1],b=p[i+2];if(p[i+3]>240&&Math.max(r,g,b)-Math.min(r,g,b)<20&&Math.max(r,g,b)<100)values.push(.2126*r+.7152*g+.0722*b);}values.sort((a,b)=>a-b);return {median:values[Math.floor(values.length/2)],samples:values.length};};
      return {top,bottom,headWidth:right-left+1,count,fabricMedian:fabric[Math.floor(fabric.length/2)],fabricSamples:fabric.length,upperChest:region(160,180,225,220),trousers:region(155,365,230,430)};
    };
    const items=idleFrames.map((frame,n)=>[frame,labels[n]]),faces=[[frames[0],'Frontal anterior'],...items];
    return {poses:make(items,3),comparison:make([[frames[0],'Frontal anterior'],...items],5),faces:make(faces,5,true),blinks:make(faces,5,true,true),
      metrics:idleFrames.map(measure),original:measure(frames[0])};
  })()`);
  for(const key of ['poses','comparison','faces','blinks'])fs.writeFileSync(artifact(key+'.png'),nativeImage.createFromDataURL(visuals[key]).toPNG());
  const spread=values=>(Math.max(...values)-Math.min(...values))/(values.reduce((a,b)=>a+b)/values.length);
  const occludedTorsoSpread=spread(visuals.metrics.map(m=>m.fabricMedian));
  // Sleeve gestures cover the previous torso sample with an arm. Compare two
  // consistently visible garment regions instead, retaining the 10% limit.
  const upperChestSpread=spread(visuals.metrics.map(m=>m.upperChest.median)),trousersSpread=spread(visuals.metrics.map(m=>m.trousers.median));
  const fabricSpread=Math.max(upperChestSpread,trousersSpread);
  const art={asset:await js('idleSheet.src.split("/").pop()'),monitor:{id:display.id,label:display.label,bounds:win.getBounds()},fabricSpread,upperChestSpread,trousersSpread,occludedTorsoSpread,metrics:visuals.metrics,original:visuals.original};save('art-result',art);
  console.log(JSON.stringify({art}));
  for(const [n,m] of visuals.metrics.entries()){
    assert.ok(m.count>15000,'Pose '+n+' must not be blank');
    assert.ok(Math.abs(m.headWidth-visuals.original.headWidth)<=3,'Pose '+n+' head must remain within 3 pixels of approved frontal head');
    assert.ok(m.top>=15&&m.top<=25,'Crown must remain stable');assert.ok(m.bottom>=530&&m.bottom<=534,'Soles must remain on baseline');assert.ok(m.upperChest.samples>400);assert.ok(m.trousers.samples>400);
  }
  const widths=visuals.metrics.map(m=>m.headWidth);assert.ok(Math.max(...widths)-Math.min(...widths)<=4,'Idle head width must not pulse across poses');
  assert.ok(fabricSpread<.10,'Idle fabric must not alternate brightness');
  if(process.argv.includes('--art-only')){console.log(JSON.stringify({ok:true,scope:'art'}));app.quit();return;}
  await pause(250);fs.writeFileSync(artifact('studio.png'),(await win.webContents.capturePage()).toPNG());
  // Observe actual rendered gesture segments, including the return to neutral.
  const gestures=[];
  for(const kind of ['weight','weight','sleeve','pocket','look','look']){
    const result=await js(`(async()=>{
      window.playIdleGesture(${JSON.stringify(kind)});
      const seen=new Set();let started=false,hold=null,last=null;const end=performance.now()+12000;
      while(performance.now()<end){await new Promise(requestAnimationFrame);last=window.avatarDebug();
        if(last.idle.active){started=true;seen.add(last.idle.frameA);seen.add(last.idle.frameB);if(last.idle.phase==='hold'&&!hold)hold=poseCanvas.toDataURL();}
        else if(started)return {kind:${JSON.stringify(kind)},seen:[...seen].sort(),last,hold};
      }
      throw new Error('Gesture did not return to neutral: '+${JSON.stringify(kind)});
    })()`);
    assert.equal(result.last.idle.active,false);assert.equal(result.last.idle.frameA,0);assert.equal(result.last.idle.frameB,0);assert.equal(result.last.idleAvailable,true);
    if(kind==='sleeve')assert.deepEqual(result.seen,[0,3,4]);
    else if(kind==='pocket')assert.deepEqual(result.seen,[0,5,6]);
    else {assert.equal(result.seen[0],0);assert.equal(result.seen.length,2);assert.ok((kind==='weight'?[1,2]:[7,8]).includes(result.seen[1]));}
    if(result.hold)fs.writeFileSync(artifact('gesture-'+kind+'-'+gestures.length+'.png'),nativeImage.createFromDataURL(result.hold).toPNG());
    delete result.hold;gestures.push(result);
  }
  for(const kind of ['weight','look'])assert.equal(new Set(gestures.filter(g=>g.kind===kind).map(g=>g.seen[1])).size,2,'Both sides must alternate');
  // Commands cancel a running idle gesture on the next animation frame.
  const interruptions=[];
  for(const command of ['window.setMovimento("walking",true)','window.setEstadoConversa("falando");window.setBoca(.8)','window.reagir("think")']){
    const result=await js(`(async()=>{
      window.setMovimento('walking',false);window.setEstadoConversa('ociosa');window.reagir('wake');window.setBoca(0);
      const readyEnd=performance.now()+6000;while(!window.avatarDebug().idleAvailable&&performance.now()<readyEnd)await new Promise(requestAnimationFrame);
      window.playIdleGesture('sleeve');await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      const before=window.avatarDebug();${command};await new Promise(requestAnimationFrame);return {before,after:window.avatarDebug()};
    })()`);
    assert.equal(result.before.idle.active,true);assert.equal(result.after.idle.active,false);assert.equal(result.after.idleAvailable,false);interruptions.push(command);
  }
  await js('window.setMovimento("walking",false);window.setEstadoConversa("ociosa");window.reagir("wake");window.setBoca(0);window.setIdleGestures(false)');
  s=await js('(async()=>{await new Promise(requestAnimationFrame);return window.avatarDebug()})()');assert.equal(s.idleGestures,false);assert.equal(s.idle.active,false);
  await js('window.setBoca(.8)');await pause(250);
  s=await js('(async()=>{window.piscar();await new Promise(requestAnimationFrame);return window.avatarDebug()})()');assert.ok(s.visibleMouth>.7);assert.equal(s.blinkActive,true);
  await js('window.setBoca(0);window.setIdleDemo(true)');
  const showcase=await js(`(async()=>{
    let started=null;const end=performance.now()+12000;
    while(performance.now()<end){await new Promise(requestAnimationFrame);const s=window.avatarDebug();if(s.idle.active&&!started)started=s.idle.kind;
      if(started&&!s.idle.active)return {started,idle:s.idle,demo:s.idleDemo};}
    throw new Error('Showcase did not complete its first gesture');
  })()`);
  assert.equal(showcase.demo,true);assert.equal(showcase.started,'weight');assert.ok(showcase.idle.nextIn>=2&&showcase.idle.nextIn<=3);
  await js('window.setIdleDemo(false)');
  const neutralContinuity=await js(`(async()=>{
    const next=()=>new Promise(requestAnimationFrame);
    window.setIdleDemo(false);window.setIdleGestures(true);window.setEstadoConversa('ociosa');window.setBoca(0);window.reagir('wake');
    const quietEnd=performance.now()+4000;
    while(performance.now()<quietEnd){await next();const s=window.avatarDebug();if(s.idleAvailable&&!s.idle.active&&s.transition===1&&s.visibleMouth<.01)break;}
    // Read steady draws after the last composited transition frame; that frame
    // may differ by one unit from premultiplied-alpha rounding.
    await next();await next();
    const quiet=window.avatarDebug();
    const a=poseCtx.getImageData(0,0,384,560).data,quietImage=poseCanvas.toDataURL();
    window.setEstadoConversa('falando');window.setBoca(.8);
    const talkEnd=performance.now()+4000;
    while(performance.now()<talkEnd){await next();const s=window.avatarDebug();if(s.transition===1&&s.visibleMouth>.7)break;}
    await next();await next();window.piscar();await next();
    const talking=window.avatarDebug(),b=poseCtx.getImageData(0,0,384,560).data,talkImage=poseCanvas.toDataURL();
    let bodyDifferences=0,bodyMaxDifference=0,bodySamples=0,mouthDifferences=0,eyeDifferences=0;
    for(let y=0;y<560;y++)for(let x=0;x<384;x++)for(let k=0;k<4;k++){
      const i=(y*384+x)*4+k,diff=Math.abs(a[i]-b[i]);
      if(y>=108&&y<136){if(diff)eyeDifferences++;}
      else if(y>=138&&y<158){if(diff)mouthDifferences++;}
      else {bodySamples++;if(diff)bodyDifferences++;bodyMaxDifference=Math.max(bodyMaxDifference,diff);}
    }
    return {quiet:{available:quiet.idleAvailable,active:quiet.idle.active,transition:quiet.transition,view:quiet.view},
      talking:{available:talking.idleAvailable,active:talking.idle.active,transition:talking.transition,view:talking.view,mouth:talking.visibleMouth,blink:talking.blinkActive},
      bodyDifferences,bodyMaxDifference,bodySamples,mouthDifferences,eyeDifferences,quietImage,talkImage};
  })()`);
  // Compare canonical decoded output pixels. GPU canvas getImageData can
  // round unpremultiplication differently by 1/255 even when PNG outputs match.
  const quietBitmap=nativeImage.createFromDataURL(neutralContinuity.quietImage).toBitmap();
  const talkBitmap=nativeImage.createFromDataURL(neutralContinuity.talkImage).toBitmap();
  neutralContinuity.rawCanvasBodyDifferences=neutralContinuity.bodyDifferences;
  neutralContinuity.rawCanvasBodyMaxDifference=neutralContinuity.bodyMaxDifference;
  neutralContinuity.bodyDifferences=0;neutralContinuity.bodyMaxDifference=0;
  for(let y=0;y<560;y++)if(!(y>=108&&y<136)&&!(y>=138&&y<158))for(let x=0;x<384;x++)for(let k=0;k<4;k++){
    const i=(y*384+x)*4+k,diff=Math.abs(quietBitmap[i]-talkBitmap[i]);
    if(diff)neutralContinuity.bodyDifferences++;neutralContinuity.bodyMaxDifference=Math.max(neutralContinuity.bodyMaxDifference,diff);
  }
  for(const [key,name] of [['quietImage','neutral'],['talkImage','talk']]){
    fs.writeFileSync(artifact(name+'.png'),nativeImage.createFromDataURL(neutralContinuity[key]).toPNG());delete neutralContinuity[key];
  }
  save('neutral-continuity',neutralContinuity);
  assert.equal(neutralContinuity.quiet.available,true);assert.equal(neutralContinuity.quiet.active,false);assert.equal(neutralContinuity.quiet.transition,1);
  assert.equal(neutralContinuity.talking.available,false);assert.equal(neutralContinuity.talking.active,false);assert.equal(neutralContinuity.talking.transition,1);
  assert.equal(neutralContinuity.talking.view,'neutral');assert.ok(neutralContinuity.talking.mouth>.7);assert.equal(neutralContinuity.talking.blink,true);
  assert.equal(neutralContinuity.bodyDifferences,0,'Rest and speech must use identical decoded output body pixels outside the face masks');
  assert.equal(neutralContinuity.bodyMaxDifference,0);assert.ok(neutralContinuity.bodySamples>500000);
  assert.ok(neutralContinuity.mouthDifferences>0);assert.ok(neutralContinuity.eyeDifferences>0);
  await js('window.setEstadoConversa("ociosa");window.setBoca(0)');
  const result={ok:true,...art,neutralContinuity,gestures:gestures.map(g=>({kind:g.kind,seen:g.seen})),interruptions,showcase,checks:['9 idle poses','head within 3 px of frontal','head spread at most 4 px','baseline preserved','fabric spread below 10%','all gesture poses and return to neutral','walk/speech/reaction interrupt at next frame','disable gestures','mouth and blink','shorter showcase intervals','identical decoded output body pixels between rest and speech with face masks active'],date:new Date().toISOString()};
  save('render-result',result);console.log(JSON.stringify(result));app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
