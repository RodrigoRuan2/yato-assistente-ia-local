const {app,BrowserWindow,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const Target=require('../../avatar-chibi-lab/display-target.cjs');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const timeout=setTimeout(()=>app.exit(1),35000);
app.whenReady().then(async()=>{
 const display=Target.selectDisplay(screen,['--monitor=1']);
 const win=new BrowserWindow({...Target.windowBounds(display,{width:780,height:1000}),show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});
 const errors=[];win.webContents.on('console-message',(_e,level,message)=>{if(level===3)errors.push(message);});
 await win.loadFile(path.join(__dirname,'preview.html'));await pause(800);
 const frame=win.webContents.mainFrame.frames.find(f=>f.url==='about:srcdoc')||win.webContents.mainFrame.frames[0];assert(frame);
 const js=code=>frame.executeJavaScript(code);
 await js(`document.documentElement.style.colorScheme='dark'`);
 assert.equal(await js(`document.querySelectorAll('.yato-character').length`),3);
 assert(await js(`[...document.querySelectorAll('.yato-character')].every(i=>i.complete&&i.naturalWidth>0)`));
 for(const width of [780,360]){
  win.setSize(width,1000);await pause(200);
  for(let i=0;i<3;i++){
   await js(`document.querySelectorAll('[data-variant]').forEach((e,n)=>e.hidden=n!==${i});`);
   await js(`document.querySelectorAll('.yato-stage')[${i}].querySelector('[data-scene="long"]').click()`);
   await js(`document.querySelectorAll('.yato-stage')[${i}].querySelector('.expand').click()`);
   assert(await js(`document.documentElement.scrollWidth<=innerWidth+1`),'horizontal overflow');
   assert(await js(`(()=>{const h=document.querySelectorAll('.headline')[${i}];return h.scrollHeight<=h.clientHeight+1;})()`),'headline clipped');
   await js(`document.querySelectorAll('.yato-stage')[${i}].querySelector('[data-scene="math"]').click()`);
   await js(`(()=>{const s=document.querySelectorAll('.yato-stage')[${i}];s.querySelector('input').value='quanto é 18 vezes 27?';s.querySelector('.input-row button').click();})()`);
   assert(await js(`document.querySelectorAll('.yato-stage')[${i}].textContent.includes('486')`),JSON.stringify({i,width,errors,text:await js(`document.querySelectorAll('.yato-stage')[${i}].textContent`)}));
   if(width===780){await js(`document.querySelectorAll('.yato-stage')[${i}].querySelector('[data-scene="news"]').click()`);await pause(100);fs.writeFileSync(path.join(__dirname,`modelo-${i+1}.png`),(await win.webContents.capturePage()).toPNG());}
  }
 }
 assert(!errors.some(e=>/ReferenceError|TypeError|SyntaxError/.test(e)),errors.join('\n'));
 fs.writeFileSync(path.join(__dirname,'validation.json'),JSON.stringify({ok:true,monitor:display.id,checks:['3 variants','avatar loaded','long headlines without clipping','narrow and desktop widths','18 times 27 equals 486','no script errors']},null,2));
 win.destroy();clearTimeout(timeout);app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
