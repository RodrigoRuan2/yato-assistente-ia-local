// Arm-cycle v3 and optional effects QA. Monitor 2 only, hidden/offscreen. No desktop capture, video, or audio.
const {app,BrowserWindow,nativeImage,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const Target=require('../display-target.cjs'),pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  const display=Target.selectDisplay(screen);
  const win=new BrowserWindow({...Target.windowBounds(display,{width:1240,height:980}),show:false,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true}});
  assert.ok(Target.contains(display,win.getBounds()),'QA must stay on monitor 2');
  const js=code=>win.webContents.executeJavaScript(code),state=()=>js('window.avatarDebug()');
  await win.loadFile(path.resolve(__dirname,'..','index.html'));
  for(let n=0;n<120&&!(await state()).ready;n++)await pause(50);
  let s=await state();assert.equal(s.ready,true);assert.equal(s.cycleFrames,16);assert.equal(s.cycleRestFrames,2);assert.equal(s.walkSource,'arm-cycle-v3');assert.equal(s.effects,false);assert.equal(await js('approvedCycleFrames.length'),16);
  // Keep the existing gait regression focused on walking. Idle gestures and
  // their interruption by walking/speech are covered by render-idle.cjs.
  await js('window.setIdleGestures(false)');
  const visuals=await js(`(()=>{
    const make=(items,columns)=>{
      const c=document.createElement('canvas');c.width=columns*192;c.height=Math.ceil(items.length/columns)*310;
      const g=c.getContext('2d');g.fillStyle='#29242f';g.fillRect(0,0,c.width,c.height);
      items.forEach(([frame,label],i)=>{const x=i%columns*192,y=Math.floor(i/columns)*310;
        g.drawImage(frame,x,y,192,280);g.fillStyle='#e7dff0';g.font='13px sans-serif';g.textAlign='center';g.fillText(label,x+96,y+298);});return c.toDataURL();
    };
    const measure=frame=>{const p=frame.getContext('2d').getImageData(0,0,384,560).data;
      let top=560,bottom=0,left=384,right=0,footLeft=384,footRight=0,count=0;const fabric=[];
      for(let y=0;y<560;y++)for(let x=0;x<384;x++)if(p[(y*384+x)*4+3]>180){top=Math.min(top,y);bottom=Math.max(bottom,y);count++;}
      for(let y=top;y<top+140;y++)for(let x=0;x<384;x++)if(p[(y*384+x)*4+3]>180){left=Math.min(left,x);right=Math.max(right,x);}
      for(let y=450;y<535;y++)for(let x=0;x<384;x++)if(p[(y*384+x)*4+3]>180){footLeft=Math.min(footLeft,x);footRight=Math.max(footRight,x);}
      for(let y=220;y<300;y++)for(let x=160;x<225;x++){const i=(y*384+x)*4,r=p[i],g=p[i+1],b=p[i+2];
        if(p[i+3]>240&&Math.max(r,g,b)-Math.min(r,g,b)<20&&Math.max(r,g,b)<100)fabric.push(.2126*r+.7152*g+.0722*b);}
      fabric.sort((a,b)=>a-b);return {top,bottom,headWidth:right-left+1,count,footSpan:footRight-footLeft+1,fabricMedian:fabric[Math.floor(fabric.length/2)],fabricSamples:fabric.length};
    };
    return {right:make(cycleFrames.slice(0,8).map((f,n)=>[f,'Fase '+(n+1)]),4),left:make(cycleFrames.slice(8).map((f,n)=>[f,'Fase '+(n+1)]),4),
      transitions:make([[frames[0],'Repouso frontal'],[cycleRestFrames[0],'Preparação / repouso →'],[cycleFrames[0],'Apoio →'],[cycleFrames[2],'Passagem →'],[cycleFrames[8],'← Apoio'],[cycleRestFrames[1],'← Repouso']],6),
      metrics:cycleFrames.slice(0,8).concat(cycleRestFrames[0]).map(measure),originalMetrics:walkFrames.slice(0,6).map(measure),approvedMetrics:approvedCycleFrames.slice(0,8).concat(approvedRestFrames[0]).map(measure),
      noMixedFrames:cycleFrames.every(f=>!walkFrames.includes(f)&&!approvedCycleFrames.includes(f)),mirrorErrors:cycleFrames.slice(0,8).map((f,n)=>{
        const a=f.getContext('2d').getImageData(0,0,384,560).data,b=cycleFrames[n+8].getContext('2d').getImageData(0,0,384,560).data;
        let alpha=0,color=0;for(let y=0;y<560;y++)for(let x=0;x<384;x++){const i=(y*384+x)*4,j=(y*384+383-x)*4;
          alpha=Math.max(alpha,Math.abs(a[i+3]-b[j+3]));for(let k=0;k<3;k++)color=Math.max(color,Math.abs(a[i+k]*a[i+3]-b[j+k]*b[j+3])/255);}
        return {alpha,color};})};
  })()`);
  for(const key of ['right','left','transitions'])fs.writeFileSync(path.join(__dirname,'arms-v3-'+key+'.png'),nativeImage.createFromDataURL(visuals[key]).toPNG());
  assert.equal(visuals.noMixedFrames,true);for(const error of visuals.mirrorErrors){assert.ok(error.alpha<=1);assert.ok(error.color<=2,'Mirror may differ only by canvas alpha rounding');}
  for(const m of visuals.metrics){assert.ok(m.count>15000);assert.ok(m.headWidth>=137&&m.headWidth<=142);assert.ok(m.top>=15&&m.top<=25);assert.ok(m.bottom>=530&&m.bottom<=534);assert.ok(m.fabricSamples>400);}
  const fabric=visuals.metrics.map(m=>m.fabricMedian),fabricSpread=(Math.max(...fabric)-Math.min(...fabric))/(fabric.reduce((a,b)=>a+b)/fabric.length);
  const art={monitor:{id:display.id,label:display.label,bounds:win.getBounds()},fabricSpread,metrics:visuals.metrics,originalMetrics:visuals.originalMetrics,approvedMetrics:visuals.approvedMetrics};
  fs.writeFileSync(path.join(__dirname,'arms-v3-art-result.json'),JSON.stringify(art,null,2));
  assert.ok(fabricSpread<.10,'Fabric palette must not alternate brightness');
  assert.ok(visuals.metrics[0].footSpan>visuals.metrics[2].footSpan+25);assert.ok(visuals.metrics[4].footSpan>visuals.metrics[6].footSpan+25);
  if(process.argv.includes('--art-only')){console.log(JSON.stringify({ok:true,...art}));app.quit();return;}
  if(!process.argv.includes('--effects-only')) {
  await js('window.setMovimento("blinking",false)');await pause(250);
  fs.writeFileSync(path.join(__dirname,'arms-v3-studio.png'),(await win.webContents.capturePage()).toPNG());
  await js('document.getElementById("walk-demo").click()');
  for(let n=0;n<30;n++){await pause(20);s=await state();if(['starting','walking'].includes(s.motion.mode))assert.ok(s.view.startsWith('walk-'));}
  assert.equal(s.demo,true);assert.ok(s.motion.pace>0);assert.equal(s.framesPerDirection,8);assert.equal(s.walkSource,'arm-cycle-v3');
  fs.writeFileSync(path.join(__dirname,'arms-v3-playing.png'),(await win.webContents.capturePage()).toPNG());
  await js('document.getElementById("refined").click()');await pause(150);s=await state();assert.equal(s.framesPerDirection,8);assert.ok(s.frame<8);assert.equal(s.walkSource,'coherent-cycle-v2');
  await js('document.getElementById("refined").click()');await pause(150);assert.equal((await state()).framesPerDirection,8);assert.equal((await state()).walkSource,'arm-cycle-v3');
  // The comparison can take longer on a busy machine and the automatic demo
  // may already be resting. Request an actual stride before testing its stop.
  await js('window.setWalkDemo(false,false);window.setMovimento("walking",true)');
  for(let n=0;n<100;n++){s=await state();if(s.motion.pace>.6)break;await pause(25);}
  assert.ok(s.motion.pace>.6);
  await js('window.qaModes=[];window.qaTrack=true;requestAnimationFrame(function sample(){window.qaModes.push(window.avatarDebug().motion.mode);if(window.qaTrack)requestAnimationFrame(sample);})');
  await js('document.getElementById("natural-stop").click()');
  for(let n=0;n<110;n++){await pause(20);s=await state();if(s.motion.mode==='stopping')assert.ok(s.view.startsWith('walk-'));if(s.motion.mode==='idle')break;}
  const observed=new Set(await js('window.qaTrack=false;window.qaModes'));
  assert.equal(s.demo,false);assert.equal(s.motion.mode,'idle');assert.ok(observed.has('stopping'));assert.ok(observed.has('settling'));
  await pause(250);assert.equal((await state()).view,'front');
  await js('document.getElementById("walk-demo").click()');await pause(600);await js('document.getElementById("walking").click()');
  s=await state();assert.equal(s.demo,false);assert.equal(s.walking,false);
  // A pending direction change may still finish after stopping. Await the
  // renderer state instead of assuming wall time equals simulated gait time.
  const manualDeadline=Date.now()+4000;
  while(s.motion.mode!=='idle'&&Date.now()<manualDeadline){await pause(25);s=await state();}
  assert.equal(s.motion.mode,'idle');
  await js('window.setBoca(.8)');await pause(250);await js('window.piscar()');await pause(40);s=await state();assert.ok(s.visibleMouth>.7);assert.equal(s.blinkActive,true);

  }
  const effectsResult=await js(`(()=>{
    const create=()=>{const c=document.createElement('canvas');c.width=384;c.height=560;return c;};
    const source=cycleFrames[0],baseline=create(),disabled=create(),enabled=create(),reduced=create();
    const bg=baseline.getContext('2d');bg.drawImage(source,0,0);
    const reference=bg.getImageData(0,0,384,560).data;
    const dg=disabled.getContext('2d');dg.drawImage(source,0,0);
    const off=new YatoEffects();off.triggerMaterialize();off.render(dg,source,0,0,1,.016,{enabled:false});
    const offPixels=dg.getImageData(0,0,384,560).data;
    let disabledDifferences=0;for(let i=0;i<reference.length;i++)if(reference[i]!==offPixels[i])disabledDifferences++;
    const fx=new YatoEffects(),eg=enabled.getContext('2d');let draws=0,maxParticleDraws=0;
    const fill=eg.fillRect.bind(eg);eg.fillRect=(...args)=>{draws++;fill(...args);};
    fx.triggerMaterialize();
    for(let n=0;n<120;n++){draws=0;eg.clearRect(0,0,384,560);fx.render(eg,source,0,0,1,.016,{enabled:true,poseKey:'same'});maxParticleDraws=Math.max(maxParticleDraws,draws);}
    eg.drawImage(source,0,0);
    const onPixels=eg.getImageData(0,0,384,560).data;
    let opaqueDifferences=0,opaqueSamples=0,outsideEffectPixels=0,nearOpaqueSamples=0,nearOpaqueMaxDiff=0,nearOpaqueSumDiff=0;
    for(let i=0;i<reference.length;i+=4){if(reference[i+3]===255){opaqueSamples++;for(let k=0;k<4;k++)if(reference[i+k]!==onPixels[i+k])opaqueDifferences++;}
      if(reference[i+3]>240){nearOpaqueSamples++;for(let k=0;k<3;k++){const diff=Math.abs(reference[i+k]-onPixels[i+k]);nearOpaqueMaxDiff=Math.max(nearOpaqueMaxDiff,diff);nearOpaqueSumDiff+=diff;}}
      if(reference[i+3]===0&&onPixels[i+3]>0)outsideEffectPixels++;}
    // A synthetic opaque cutout tests the fully opaque contract extensively;
    // scanline-normalized art has very few alpha=255 pixels, counted separately.
    const solid=create(),sg=solid.getContext('2d');sg.fillStyle='#342f46';sg.fillRect(80,80,224,400);
    const solidReference=sg.getImageData(0,0,384,560).data,solidTarget=create(),stg=solidTarget.getContext('2d');
    const solidFx=new YatoEffects();solidFx.render(stg,solid,0,0,1,.016,{enabled:true,poseKey:'solid'});stg.drawImage(solid,0,0);
    const solidPixels=stg.getImageData(0,0,384,560).data;let fixtureOpaqueSamples=0,fixtureOpaqueDifferences=0;
    for(let i=0;i<solidReference.length;i+=4)if(solidReference[i+3]===255){fixtureOpaqueSamples++;for(let k=0;k<4;k++)if(solidReference[i+k]!==solidPixels[i+k])fixtureOpaqueDifferences++;}

    const rm=new YatoEffects(),rg=reduced.getContext('2d');let reducedParticleDraws=0;
    const reducedFill=rg.fillRect.bind(rg);rg.fillRect=(...args)=>{reducedParticleDraws++;reducedFill(...args);};
    rm.triggerMaterialize();rm.render(rg,source,0,0,1,.016,{enabled:true,reducedMotion:true,poseKey:'same'});
    return {disabledDifferences,disabled:off.snapshot(),opaqueDifferences,opaqueSamples,nearOpaqueSamples,nearOpaqueMaxDiff,nearOpaqueMeanDiff:nearOpaqueSumDiff/Math.max(1,nearOpaqueSamples*3),fixtureOpaqueSamples,fixtureOpaqueDifferences,outsideEffectPixels,maxParticleDraws,enabled:fx.snapshot(),reducedParticleDraws,reduced:rm.snapshot()};
  })()`);
  fs.writeFileSync(path.join(__dirname,'arms-v3-effects-result.json'),JSON.stringify(effectsResult,null,2));console.log(JSON.stringify({effects:effectsResult}));
  assert.equal(effectsResult.disabledDifferences,0,'Disabled effects must be a pixel no-op');
  assert.equal(effectsResult.disabled.buffers,0,'Disabled effects must not allocate canvases');
  assert.equal(effectsResult.opaqueDifferences,0,'Effects must preserve the opaque character colors');
  assert.ok(effectsResult.opaqueSamples>0);assert.ok(effectsResult.fixtureOpaqueSamples>15000);assert.equal(effectsResult.fixtureOpaqueDifferences,0);assert.ok(effectsResult.outsideEffectPixels>0);
  assert.ok(effectsResult.nearOpaqueSamples>15000);assert.equal(effectsResult.nearOpaqueMaxDiff,0,'Near-opaque actual character colors must remain unchanged');
  assert.equal(effectsResult.maxParticleDraws,12);assert.equal(effectsResult.enabled.buffers,2);assert.equal(effectsResult.enabled.maskBuilds,1);
  assert.equal(effectsResult.reducedParticleDraws,0);assert.equal(effectsResult.reduced.materializing,false);
  assert.equal(effectsResult.reduced.reducedMotion,true);

  await js('window.setBoca(0);window.setMovimento("blinking",false);window.materializar()');await pause(300);
  fs.writeFileSync(path.join(__dirname,'arms-v3-effects.png'),(await win.webContents.capturePage()).toPNG());
  await js('window.setEffects(false)');assert.equal((await state()).effects,false);
  const effectsOnly=process.argv.includes('--effects-only');
  const result={ok:true,scope:effectsOnly?'art-and-effects':'full',...art,effects:effectsResult,checks:['one atlas, no alternating palettes','eight gait phases and matching rest','mirrored colors and gait','stable head and baseline','fabric spread below 10%','two support/passing phases',...(effectsOnly?[]:['comparison approved v2/eight and arm v3/eight poses','stop then settle','manual override','mouth and blink']),'effects disabled pixel no-op','opaque colors preserved with effects','bounded particles and cached halo','reduced motion suppresses particles/materialization'],date:new Date().toISOString()};
  fs.writeFileSync(path.join(__dirname,effectsOnly?'arms-v3-effects-run-result.json':'arms-v3-render-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
