'use strict';
const {app,BrowserWindow,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const Target=require('../display-target.cjs');
const build=process.argv.includes('--build');
const root=path.resolve(__dirname,'..');
const groups=['frames','reactionFrames','walkFrames','cycleFrames','cycleRestFrames','approvedCycleFrames','approvedRestFrames'];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const deadline=setTimeout(()=>app.exit(1),90000);
app.whenReady().then(async()=>{
  const display=Target.selectDisplay(screen);
  const runs=[];
  const pixels=[];
  for(let n=0;n<(build?3:6);n++){
    const legacy=build||n<3;
    const w=new BrowserWindow({...Target.windowBounds(display,{width:300,height:500}),show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});
    assert(Target.contains(display,w.getBounds()));
    const start=performance.now();
    await w.loadFile(path.join(root,'index.html'),{query:{desktop:'1',chat:'1',...(legacy?{legacy:'1'}:{})}});
    while(!await w.webContents.executeJavaScript('window.avatarDebug?.().ready')){
      if(performance.now()-start>20000)throw Error('Avatar startup timeout');
      await pause(10);
    }
    const elapsed=performance.now()-start;
    runs.push({legacy,ms:Math.round(elapsed),timing:await w.webContents.executeJavaScript('window.avatarDebug().startup??null')});
    if(build&&n===0){
      fs.mkdirSync(path.join(root,'assets/prepared'),{recursive:true});
      for(const name of groups){
        const data=await w.webContents.executeJavaScript(`(()=>{const a=${name},c=document.createElement('canvas');c.width=384*4;c.height=560*Math.ceil(a.length/4);const g=c.getContext('2d');a.forEach((f,i)=>g.drawImage(f,i%4*384,Math.floor(i/4)*560));return {count:a.length,png:c.toDataURL()};})()`);
        fs.writeFileSync(path.join(root,'assets/prepared',name+'.png'),Buffer.from(data.png.split(',')[1],'base64'));
      }
      const png=await w.webContents.executeJavaScript('frames[0].toDataURL()');
      fs.writeFileSync(path.join(root,'assets/prepared/neutral.png'),Buffer.from(png.split(',')[1],'base64'));
      const files=['yato-chibi-sprites-v1.png','yato-chibi-reacoes-v1.png','yato-caminhada-lateral-v1.png','yato-caminhada-ciclo-v2.png','yato-caminhada-bracos-v3.png'];
      const hash=file=>createHash('sha256').update(fs.readFileSync(path.join(root,'assets',file))).digest('hex');
      const manifest={version:1,width:384,height:560,columns:4,sources:Object.fromEntries(files.map(f=>[f,hash(f)])),prepared:Object.fromEntries(['neutral',...groups].map(n=>[n+'.png',hash('prepared/'+n+'.png')]))};
      fs.writeFileSync(path.join(root,'assets/prepared/manifest.json'),JSON.stringify(manifest,null,2));
    }
    if(!build&&!legacy){
      assert.equal(await w.webContents.executeJavaScript('window.avatarDebug().startup.source'),'prepared');
    }
    if(!build&&n===0){
      for(const name of groups){
        const diff=await w.webContents.executeJavaScript(`(async()=>{const a=${name},b=await preparedFrames('${name}',a.length);let max=0,opaque=0;for(let n=0;n<a.length;n++){const x=a[n].getContext('2d').getImageData(0,0,384,560).data,y=b[n].getContext('2d').getImageData(0,0,384,560).data;for(let i=0;i<x.length;i++){const d=Math.abs(x[i]-y[i]);max=Math.max(max,d);if(x[i-i%4+3]===255)opaque=Math.max(opaque,d);}}return {max,opaque};})()`);
        pixels.push({name,...diff});assert(diff.max<=1&&diff.opaque===0,`${name}: pixel regression ${JSON.stringify(diff)}`);
      }
    }
    if(!build&&n===5){
      await w.webContents.executeJavaScript('state.ready=false;preparedImage=async()=>{throw new Error("QA missing cache")};loadPrepared();void 0');
      const startFallback=Date.now();
      while(!await w.webContents.executeJavaScript('window.avatarDebug().ready')){
        assert(Date.now()-startFallback<10000);await pause(10);
      }
      assert.equal(await w.webContents.executeJavaScript('window.avatarDebug().startup.source'),'original');
    }
    w.destroy();
  }
  const result={ok:true,monitor:display.id,runs,pixels,fallbackChecked:!build,date:new Date().toISOString()};
  fs.writeFileSync(path.join(__dirname,build?'startup-before.json':'startup-after.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));clearTimeout(deadline);app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
app.on('window-all-closed',()=>{});
