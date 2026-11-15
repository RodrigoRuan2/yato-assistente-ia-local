'use strict';
const { app, BrowserWindow, ipcMain, Menu, screen, dialog } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const YatoMotion = require('./motion.js');
const DesktopSize = require('./desktop-size.js');
const YatoRoutine = require('./autonomy.js');
const DisplayTarget = require('./display-target.cjs');
const walker = new YatoMotion();
const desktop = process.argv.includes('--desktop');
const selftest = process.argv.includes('--selftest') || process.argv.includes('--walk-selftest');
const chat = process.argv.includes('--chat');
const port = Number(process.env.YATO_CHIBI_WALK_PORTA || (selftest ? 18142 : 8141));
app.setPath('userData', path.join(app.getPath('appData'), selftest?'yato-chibi-walk-selftest':'yato-chibi-walk-lab'));
const sizeFile = selftest ? path.join(app.getPath('temp'),`yato-walk-size-selftest-${process.pid}.json`) : path.join(app.getPath('userData'),'desktop-settings.json');
let sizePercent = selftest ? 100 : DesktopSize.readPercent(sizeFile);
let automatic = desktop && !selftest && DesktopSize.readSettings(sizeFile).automatic !== false;
const routine = new YatoRoutine();
const requestedMovement = {walking:false,wandering:false,speed:1};
let win, server, timer, targetDisplay, lastMove = 0, testHover = null;
let lastPresence=0, desktopReady=false, closing=false, menuOpen=false, dragUntil=0;
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.json':'application/json', '.wav':'audio/wav' };
const allowed = new Set(['index.html','style.css','avatar.js','motion.js','effects.js','idle.js','assets/yato-repouso-v1.png','assets/yato-caminhada-bracos-v3.png','assets/yato-caminhada-lateral-v1.png','assets/yato-caminhada-complementos-v1.png','assets/yato-caminhada-ciclo-v2.png','assets/yato-chibi-sprites-v1.png','assets/yato-chibi-conceito-v1.png','assets/yato-chibi-reacoes-v1.png','assets/fala-demo.wav','assets/fala-demo.json']);
const send = (res, code, value) => { res.writeHead(code, { 'Content-Type':'text/plain; charset=utf-8' }); res.end(value); };

async function request(req, res) {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method !== 'GET') return send(res, 405, 'Método não permitido');
    if(url.pathname==='/saude'){
      if(!win||win.isDestroyed()||win.webContents.isLoading())return send(res,503,'Inicializando');
      const debug=await win.webContents.executeJavaScript('window.avatarDebug?.()');
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({avatar:'walk-lab',ready:Boolean(debug?.ready),chat,debug,sizePercent,bounds:win.getBounds(),
        monitor:{id:targetDisplay.id,label:targetDisplay.label,bounds:targetDisplay.bounds,workArea:targetDisplay.workArea,contained:DisplayTarget.contains(targetDisplay,win.getBounds())},
        routine:{enabled:automatic,...routine.snapshot()},presence:{visible:win.isVisible(),minimized:win.isMinimized(),alwaysOnTop:win.isAlwaysOnTop(),focusable:win.isFocusable(),focused:win.isFocused()}}));return;
    }
    if (url.pathname === '/controle') {
      if (!win || win.isDestroyed() || win.webContents.isLoading()) return send(res, 503, 'Avatar indisponível');
      let script;
      const action = url.searchParams.get('acao');
      if(action==='rotina') {
        const value=url.searchParams.get('valor');
        if(!desktop||!['0','1'].includes(value))return send(res,400,'Rotina inválida');
        try { await setAutomatic(value==='1'); } catch { return send(res,500,'Não foi possível salvar o passeio'); }
        return send(res,200,'ok');
      }
      if(action==='tamanho') {
        const raw=url.searchParams.get('valor'),value=Number(raw);
        if(!desktop||raw===null||raw.trim()===''||!DesktopSize.validPercent(value))return send(res,400,'Tamanho inválido');
        try { applySize(value); } catch { return send(res,500,'Não foi possível salvar o tamanho'); }
        return send(res,200,'ok');
      }
      if (action === 'boca') {
        const raw = url.searchParams.get('valor');
        const value = Number(raw);
        if (raw === null || raw.trim() === '' || !Number.isFinite(value)) return send(res, 400, 'Valor inválido');
        script = `window.setBoca(${Math.max(0, Math.min(1, value))})`;
      } else if (action === 'expressao') {
        const name = url.searchParams.get('nome');
        if (!['ociosa','pensando','falando','feliz'].includes(name)) return send(res, 400, 'Expressão inválida');
        script = `window.setExpressao(${JSON.stringify(name)})`;
      } else if (action === 'movimento') {
        const name=url.searchParams.get('nome'),value=url.searchParams.get('valor');
        if(!['walking','wandering'].includes(name)||!['0','1'].includes(value))return send(res,400,'Movimento inválido');
        if(desktop&&automatic)await setAutomatic(false,false);
        script=`window.setMovimento(${JSON.stringify(name)},${value==='1'})`;
      } else if (action === 'estado') {
        const name=url.searchParams.get('nome');
        if(!['ociosa','ouvindo','pensando','falando'].includes(name))return send(res,400,'Estado inválido');
        script=`window.setEstadoConversa(${JSON.stringify(name)})`;
      } else if (action === 'reacao') {
        const name = url.searchParams.get('nome');
        if (!['wave','think','celebrate','sleep','wake'].includes(name)) return send(res, 400, 'Reação inválida');
        script = `window.reagir(${JSON.stringify(name)})`;
      } else return send(res, 400, 'Ação inválida');
      await win.webContents.executeJavaScript(script);
      return send(res, 200, 'ok');
    }
    const file = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    if (!allowed.has(file)) return send(res, 404, 'Não encontrado');
    fs.readFile(path.join(__dirname, file), (error, data) => {
      if (error) return send(res, 404, 'Não encontrado');
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)],
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; object-src 'none'",
      }); res.end(data);
    });
  } catch (error) { send(res, 400, 'Requisição inválida'); }
}

function applySize(percent) {
  if(!desktop||!win||win.isDestroyed())return;
  DesktopSize.savePercent(sizeFile,percent);
  const before=win.getBounds(),work=targetDisplay.workArea;
  win.setBounds(DesktopSize.resizeBounds(before,work,percent));
  walker.x=win.getBounds().x; // Resizing preserves gait, velocity and walk preferences.
  sizePercent=percent;
  ensureDesktopPresence();
}
function ensureDesktopPresence() {
  if(!desktop||!win||win.isDestroyed()||closing)return;
  // The default 'floating' level uses Electron's Windows taskbar-reordering path.
  win.setAlwaysOnTop(true,'pop-up-menu');
  if(desktopReady&&!selftest) {
    if(win.isMinimized())win.restore();
    if(!win.isVisible())win.showInactive();
  }
}
async function setAutomatic(value, syncMovement=true) {
  DesktopSize.saveSettings(sizeFile,{automatic:value});
  automatic=value;routine.reset();
  if(syncMovement)await win.webContents.executeJavaScript(value?'window.setMovimento("wandering",true)':'window.setMovimento("walking",false)');
}
function menuAction(action) {
  const perform=async()=>{
    if(desktop&&automatic&&['walking','wandering'].includes(action))await setAutomatic(false,false);
    win.webContents.send('chibi-action',action);
  };
  perform().catch(()=>dialog.showErrorBox('Passeio do Yato','Não consegui salvar a preferência do passeio. Tente novamente.'));
}
function menuTemplate() {
  return [
    { label:'Yato · Caminhada LAB', enabled:false },
    ...(desktop ? [{label:`Tamanho · ${sizePercent}%`,submenu:DesktopSize.OPTIONS.map(({percent,label})=>({
      label,type:'radio',checked:sizePercent===percent,click:()=>{
        try { applySize(percent); } catch {
          dialog.showErrorBox('Tamanho do Yato','Não consegui salvar o tamanho. Tente novamente.');
        }
      },
    }))},{type:'separator'}] : []),
    ...(desktop?[{label:'Passeio automático com pausas',type:'checkbox',checked:automatic,click:item=>{
      setAutomatic(item.checked).catch(()=>dialog.showErrorBox('Passeio do Yato','Não consegui salvar a preferência do passeio. Tente novamente.'));
    }},{type:'separator'}]:[]),
    ...[['Acenar','wave'],['Pensar','think'],['Comemorar','celebrate'],['Cochilar','sleep'],['Despertar','wake'],...(!chat?[['Ouvir / parar a fala','speak']]:[]),['Piscar','blink'],['Caminhar / parar','walking'],['Passeio contínuo / parar','wandering']].map(([label, action]) => ({ label, click:() => menuAction(action) })),
    ...[['Virar para a esquerda','left'],['Virar para a direita','right']].map(([label,action])=>({label,click:()=>win.webContents.send('chibi-action',action)})),
    { type:'separator' }, { label:'Fechar', click:() => app.quit() },
  ];
}
function contextMenu() {
  if(menuOpen||!win||win.isDestroyed())return;
  menuOpen=true;
  if(automatic)routine.reset();
  Menu.buildFromTemplate(menuTemplate()).popup({ window:win, callback:()=>{menuOpen=false;} });
}
function createWindow() {
  const initial=DisplayTarget.windowBounds(targetDisplay,desktop?DesktopSize.dimensions(sizePercent):{width:1120,height:940},{desktop});
  win = new BrowserWindow({ ...initial,
    minWidth:Math.min(initial.width,desktop ? 150 : 720), minHeight:Math.min(initial.height,desktop ? 250 : 700),
    maxWidth:targetDisplay.workArea.width,maxHeight:targetDisplay.workArea.height,
    title:'Yato · Repouso LAB', backgroundColor:desktop ? '#00000000' : '#15131b',
    transparent:desktop, frame:!desktop, alwaysOnTop:desktop, resizable:!desktop,
    focusable:!desktop,skipTaskbar:desktop,minimizable:!desktop,
    show:false, autoHideMenuBar:true,
    webPreferences:{ preload:path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false, sandbox:true, backgroundThrottling:false, offscreen:selftest },
  });
  win.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
  if(selftest)win.webContents.on('console-message',(_event,details)=>console.log('renderer:',details));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('context-menu', contextMenu);
  win.on('close',()=>{closing=true;});
  win.on('will-move',(event,bounds)=>{
    if(!DisplayTarget.contains(targetDisplay,bounds)){
      event.preventDefault();win.setBounds(DisplayTarget.constrainBounds(bounds,targetDisplay.workArea));
    }
  });
  if(!desktop)win.once('ready-to-show',()=>{if(!selftest)win.show();});
  if(desktop) {
    // Forward right clicks on the native drag region to the webContents menu.
    win.on('system-context-menu',event=>event.preventDefault());
    win.once('ready-to-show',()=>{desktopReady=true;ensureDesktopPresence();});
    win.on('always-on-top-changed',(_event,value)=>{if(!value)ensureDesktopPresence();});
    win.on('minimize',ensureDesktopPresence);
    win.on('blur',ensureDesktopPresence);
    win.webContents.once('did-finish-load',()=>{
      if(automatic)win.webContents.executeJavaScript('window.setMovimento("wandering",true)').catch(console.error);
    });
  }
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') app.quit();
  });
  win.loadURL(`http://127.0.0.1:${port}/?${new URLSearchParams({...desktop?{desktop:'1'}:{},...chat?{chat:'1'}:{},...process.argv.includes('--demo')&&!desktop&&!selftest?{demo:'1'}:{},...process.argv.includes('--idle-demo')&&!desktop&&!selftest?{'idle-demo':'1'}:{},...process.argv.includes('--effects')&&!selftest?{effects:'1'}:{}})}`);
  if (desktop) {
    ensureDesktopPresence();
    win.setIgnoreMouseEvents(true, { forward:true });
    let solid = false;
    walker.place(win.getPosition()[0]);
    win.on('will-move', () => {
      dragUntil=Date.now()+500;routine.reset();walker.place(win.getBounds().x);
      if(!automatic)win.webContents.executeJavaScript('window.setMovimento("walking",false)').catch(() => {});
    });
    timer = setInterval(() => {
      if (!win || win.isDestroyed()) return;
      const bounds = win.getBounds(), cursor = screen.getCursorScreenPoint();
      const inside = selftest&&testHover!==null ? testHover : cursor.x > bounds.x + bounds.width * .32 && cursor.x < bounds.x + bounds.width * .68 && cursor.y > bounds.y + bounds.height * .37 && cursor.y < bounds.y + bounds.height * .73;
      const interactive=inside||menuOpen;
      if (interactive !== solid) { solid = interactive; win.setIgnoreMouseEvents(!interactive, { forward:true }); }
      const now = Date.now(), dt = Math.min((now - (lastMove || now)) / 1000, .1); lastMove = now;
      if(now-lastPresence>=1000){ensureDesktopPresence();lastPresence=now;}
      const work = targetDisplay.workArea;
      if(Math.abs(walker.x-bounds.x)>2)walker.place(bounds.x);
      const interrupted=inside||menuOpen||now<dragUntil;
      const activity=automatic?routine.step(dt,interrupted||!requestedMovement.walking):null;
      walker.configure({...requestedMovement,walking:requestedMovement.walking&&(!automatic||activity.phase==='walking')});
      if(activity?.startedWalking)walker.face(activity.direction);
      const snapshot=walker.step(dt,work.x,Math.max(work.x,work.x+work.width-bounds.width),interrupted);
      snapshot.routine={enabled:automatic,...routine.snapshot()};
      const y=Math.max(work.y,Math.min(Math.max(work.y,work.y+work.height-bounds.height),bounds.y));
      if(Math.round(snapshot.x)!==bounds.x||y!==bounds.y)win.setPosition(Math.round(snapshot.x),y);
      win.webContents.send('chibi-motion',snapshot);
    }, 16);
  }
  if (selftest) win.webContents.once('did-finish-load', () => runSelftest().catch(error => { console.error(error); app.exit(1); }));
}
ipcMain.on('chibi-close', () => app.quit());
ipcMain.on('chibi-movement', (event, data) => {
  if(event.sender!==win?.webContents||!data||typeof data!=='object')return;
  for(const key of ['walking','wandering'])if(typeof data[key]==='boolean')requestedMovement[key]=data[key];
  if(Number.isFinite(data.speed))requestedMovement.speed=Math.max(.6,Math.min(1.5,data.speed));
  if(data.direction===1||data.direction===-1)walker.face(data.direction);
});
app.whenReady().then(() => {
  // Resolve before creating any window, including offscreen selftests. Do not
  // silently fall back to the primary display if monitor 2 is unavailable.
  targetDisplay=DisplayTarget.selectDisplay(screen);
  screen.on('display-removed',(_event,display)=>{if(display.id===targetDisplay.id)app.quit();});
  screen.on('display-metrics-changed',(_event,display)=>{
    if(display.id!==targetDisplay.id)return;
    targetDisplay=display;
    if(win&&!win.isDestroyed())win.setBounds(DisplayTarget.constrainBounds(win.getBounds(),display.workArea));
  });
  server = http.createServer(request);
  server.once('error', error => { console.error(`Não foi possível abrir a porta ${port}: ${error.message}`); app.exit(1); });
  server.listen(port, '127.0.0.1', createWindow);
}).catch(error=>{console.error(error.message);app.exit(1);});
app.on('before-quit', () => { closing=true;clearInterval(timer); server?.close(); if(selftest&&fs.existsSync(sizeFile))fs.unlinkSync(sizeFile); });
app.on('window-all-closed', () => app.quit());

// Smoke test of the isolated host. Deterministic movement tests live in qa/.
// The hidden window renders only this app and does not capture the desktop.
async function runSelftest() {
  testHover=false;
  const assert=require('node:assert/strict');
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const js=code=>win.webContents.executeJavaScript(code);
  for(let i=0;i<160&&!(await js('window.avatarDebug?.().ready'));i++)await pause(50);
  assert.equal((await js('window.avatarDebug()')).ready,true,'Walk renderer must load');
  const base=`http://127.0.0.1:${port}`;
  const health=await(await fetch(base+'/saude')).json();
  assert.equal(health.avatar,'walk-lab');assert.equal(health.ready,true);
  assert.equal(health.monitor.id,targetDisplay.id);assert.equal(health.monitor.contained,true,'All tests must remain on monitor 2');
  assert.equal(health.debug.framesPerDirection,8);assert.equal(health.debug.walkSource,'arm-cycle-v3');
  assert.equal((await fetch(base+'/assets/yato-caminhada-ciclo-v2.png')).status,200);
  assert.equal((await fetch(base+'/assets/yato-caminhada-bracos-v3.png')).status,200);
  assert.equal((await fetch(base+'/effects.js')).status,200);
  assert.equal((await fetch(base+'/idle.js')).status,200);
  assert.equal((await fetch(base+'/assets/yato-repouso-v1.png')).status,200);
  assert.equal(health.debug.idleFrames,9);
  assert.equal((await fetch(base+'/main.js')).status,404);
  assert.equal((await fetch(base+'/controle?acao=boca&valor=0.7')).status,200);
  assert.equal((await js('window.avatarDebug()')).mouth,.7);
  assert.equal((await fetch(base+'/controle?acao=boca&valor=NaN')).status,400);
  await js('window.setBoca(0)');
  if(desktop) {
    assert.equal(win.isFocusable(),false);assert.equal(win.isAlwaysOnTop(),true);
    applySize(75);await pause(150);
    assert.equal((await js('window.avatarDebug()')).width,win.getBounds().width);
    assert.equal(DesktopSize.readPercent(sizeFile),75);
  }
  assert.equal(DisplayTarget.contains(targetDisplay,win.getBounds()),true);
  const result={ok:true,mode:desktop?'desktop':'studio',monitor:{id:targetDisplay.id,label:targetDisplay.label,bounds:win.getBounds()},checks:['window entirely on monitor 2','isolated walk profile and endpoint','renderer ready','complementary sprite atlas served','private files blocked','mouth bridge and input validation',...(desktop?['non-focusable overlay','topmost','size and renderer agree']:[])],date:new Date().toISOString()};
  fs.mkdirSync(path.join(__dirname,'qa'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'qa',`walk-host-${result.mode}.json`),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));app.quit();
}
