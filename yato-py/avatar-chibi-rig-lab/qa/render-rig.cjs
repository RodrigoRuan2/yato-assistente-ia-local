// Internal renderer QA; no desktop capture, recording or microphone access.
const {app,BrowserWindow,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1240,height:980,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true}});
  const js=code=>win.webContents.executeJavaScript(code);
  win.webContents.on('console-message',(_event,...args)=>console.log(...args));
  await win.loadFile(path.resolve(__dirname,'..','index.html'));
  for(let i=0;i<140&&!(await js('window.avatarDebug().ready'));i++)await pause(50);
  assert.equal((await js('window.avatarDebug()')).ready,true);
  await js('window.setMovimento("blinking",false);window.setMovimento("breathing",false);state.skeleton=false');await pause(250);
  assert.equal((await js('window.avatarDebug()')).rig.parts.length,8);
  fs.writeFileSync(path.join(__dirname,'rig-studio.png'),(await win.webContents.capturePage()).toPNG());
  const output=await js(`(()=>{
    const board=document.createElement('canvas');board.width=1536;board.height=640;
    const c=board.getContext('2d');c.fillStyle='#24212d';c.fillRect(0,0,board.width,board.height);
    const test=new YatoMotion();test.configure({scale:1,walking:true,wandering:true});
    const poses=[];const collect=label=>poses.push({label,motion:test.snapshot()});
    collect('Repouso');
    for(let i=0;i<9;i++)test.step(1/60,-1000,1000);collect('Antecipação');
    for(let i=0;i<17;i++)test.step(1/60,-1000,1000);collect('Primeiro passo');
    for(let i=0;i<17;i++)test.step(1/60,-1000,1000);collect('Troca de apoio');
    test.configure({walking:false});
    for(let i=0;i<15;i++)test.step(1/60,-1000,1000);collect('Concluir passada');
    for(let i=0;i<60;i++)test.step(1/60,-1000,1000);collect('Parado');
    test.face(-1);for(let i=0;i<60;i++)test.step(1/60,-1000,1000);collect('Virada em apoio');
    test.configure({walking:true});for(let i=0;i<27;i++)test.step(1/60,-1000,1000);collect('Passo à esquerda');
    poses.forEach((p,i)=>{
      const x=(i%4)*384,y=Math.floor(i/4)*320;
      c.save();c.translate(x+96,y+20);c.scale(.5,.5);
      rig.draw(c,p.motion,{time:0,breathing:false,skeleton:i===3,footLocks:true});c.restore();
      c.fillStyle='#eee8f4';c.font='16px sans-serif';c.textAlign='center';c.fillText(p.label,x+192,y+309);
    });
    return {image:board.toDataURL(),poses:poses.map(p=>({label:p.label,mode:p.motion.mode,rig:p.motion.rig}))};
  })()`);
  fs.writeFileSync(path.join(__dirname,'rig-walk-stop.png'),nativeImage.createFromDataURL(output.image).toPNG());delete output.image;
  await js('document.getElementById("rig-demo").click()');await pause(900);
  let debug=await js('window.avatarDebug()');assert.equal(debug.demo,true);assert.ok(!debug.motion.rig.settled);
  fs.writeFileSync(path.join(__dirname,'rig-walking.png'),(await win.webContents.capturePage()).toPNG());
  await js('document.getElementById("natural-stop").click()');
  const modes=new Set();for(let i=0;i<100;i++){await pause(20);debug=await js('window.avatarDebug()');modes.add(debug.motion.mode);if(debug.motion.rig.settled)break;}
  assert.equal(debug.demo,false);assert.equal(debug.motion.rig.settled,true);
  assert.equal(debug.motion.rig.near.grounded,true);assert.equal(debug.motion.rig.far.grounded,true);
  assert.ok(modes.has('stopping')||modes.has('settling'));
  await js('document.getElementById("rig-demo").click()');await pause(250);
  await js('document.getElementById("walking").click()');await pause(900);
  debug=await js('window.avatarDebug()');assert.equal(debug.demo,false);assert.equal(debug.walking,false);assert.equal(debug.motion.rig.settled,true);
  await js('document.getElementById("skeleton").click();document.getElementById("foot-locks").click()');await pause(100);
  debug=await js('window.avatarDebug()');assert.equal(debug.skeleton,true);assert.equal(debug.footLocks,true);
  fs.writeFileSync(path.join(__dirname,'rig-skeleton.png'),(await win.webContents.capturePage()).toPNG());
  await js('window.setBoca(.8)');await pause(600);debug=await js('window.avatarDebug()');assert.equal(debug.view,'front');
  assert.ok(debug.visibleMouth>.7);
  await js('window.piscar()');await pause(40);assert.equal((await js('window.avatarDebug()')).blinkActive,true);
  await js('window.setBoca(0)');await pause(600);assert.ok((await js('window.avatarDebug()')).view.startsWith('rig-'));
  const result={ok:true,checks:['eight separate atlas parts','renderer ready','demo button walks','natural stop completes support','debug joint and support toggles','mouth and blink bridge','return to articulated rest'],poses:output.poses,date:new Date().toISOString()};
  fs.writeFileSync(path.join(__dirname,'rig-render-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({ok:true,checks:result.checks}));app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
