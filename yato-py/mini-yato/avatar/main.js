'use strict';
const { app, BrowserWindow, ipcMain, Menu, screen, dialog } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const YatoMotion = require('./motion.js');
const DesktopSize = require('./desktop-size.js');
const YatoRoutine = require('./autonomy.js');
const BubbleHost = require('./bubble-host.cjs');
const walker = new YatoMotion();
const desktop = process.argv.includes('--desktop');
const sizeSelftest = process.argv.includes('--size-selftest');
const routineSelftest = process.argv.includes('--routine-selftest');
const bubbleSelftest = process.argv.includes('--bubble-selftest');
const bubbleDemo = process.argv.includes('--bubble-demo');
const selftest = process.argv.includes('--selftest') || sizeSelftest || routineSelftest || bubbleSelftest;
const monitorRequested=selftest||bubbleDemo||process.argv.some(arg=>arg.startsWith('--monitor=')||arg.startsWith('--display-id='));
const DisplayTarget=monitorRequested?require('./display-target.cjs'):null;
const chat = process.argv.includes('--chat');
const port = Number(process.env.YATO_CHIBI_LAB_PORTA || (selftest ? 18139 : bubbleDemo ? 8142 : 8139));
app.setPath('userData', process.env.YATO_MINI_DATA?path.join(process.env.YATO_MINI_DATA,'electron'):path.join(app.getPath('appData'), selftest?'yato-chibi-lab-selftest':bubbleDemo?'yato-chibi-bubble-preview':chat?'yato-chibi-chat':'yato-chibi-lab'));
const sizeFile = selftest ? path.join(app.getPath('temp'),`yato-size-selftest-${process.pid}.json`) : path.join(app.getPath('userData'),'desktop-settings.json');
let sizePercent = selftest ? 100 : DesktopSize.readPercent(sizeFile);
let automatic = desktop && !selftest && !bubbleDemo && DesktopSize.readSettings(sizeFile).automatic !== false;
let effectsEnabled = DesktopSize.readSettings(sizeFile).effectsEnabled !== false;
const routine = new YatoRoutine(routineSelftest?{idle:[1.8,1.9],walk:[1.0,1.1]}:{});
const requestedMovement = {walking:false,wandering:false,speed:1};
let win, server, timer, bubbles, lastMove = 0, testHover = null;
let lastPresence=0, desktopReady=false, closing=false, menuOpen=false, dragUntil=0;
let targetDisplay=null,positionTimer=null;
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.json':'application/json', '.wav':'audio/wav' };
const allowed = new Set(['index.html','style.css','avatar.js','motion.js','effects.js','assets/yato-caminhada-bracos-v3.png','assets/yato-caminhada-lateral-v1.png','assets/yato-caminhada-ciclo-v2.png','assets/yato-chibi-sprites-v1.png','assets/yato-chibi-conceito-v1.png','assets/yato-chibi-reacoes-v1.png','assets/fala-demo.wav','assets/fala-demo.json']);
const send = (res, code, value) => { res.writeHead(code, { 'Content-Type':'text/plain; charset=utf-8' }); res.end(value); };
for(const name of ['neutral','frames','reactionFrames','walkFrames','cycleFrames','cycleRestFrames','approvedCycleFrames','approvedRestFrames'])allowed.add(`assets/prepared/${name}.png`);

async function request(req, res) {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if(url.pathname==='/assistant-action'){
      if(req.method!=='POST'||req.headers.origin||!process.env.YATO_ASSISTANT_TOKEN||req.headers.authorization!==`Bearer ${process.env.YATO_ASSISTANT_TOKEN}`)return send(res,403,'Não autorizado');
      if(!bubbles)return send(res,503,'Avatar indisponível');
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>8192)return send(res,413,'Pedido muito longo');}
      const text=await bubbles.assistantAction(JSON.parse(body));
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});return res.end(JSON.stringify({text}));
    }
    if (url.pathname === '/balao') return await receiveBubble(req,res);
    if (req.method !== 'GET') return send(res, 405, 'Método não permitido');
    if(url.pathname==='/saude'){
      if(!win||win.isDestroyed()||win.webContents.isLoading())return send(res,503,'Inicializando');
      const debug=await win.webContents.executeJavaScript('window.avatarDebug?.()');
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({avatar:'lab',ready:Boolean(debug?.ready),chat,debug,sizePercent,bounds:win.getBounds(),bubble:bubbles?.snapshot()??null,bubbleDemo,
        monitor:targetDisplay?{id:targetDisplay.id,label:targetDisplay.label,bounds:targetDisplay.bounds,contained:DisplayTarget.contains(targetDisplay,win.getBounds())}:null,
        routine:{enabled:automatic,...routine.snapshot()},presence:{visible:win.isVisible(),minimized:win.isMinimized(),alwaysOnTop:win.isAlwaysOnTop(),focusable:win.isFocusable(),focused:win.isFocused()}}));return;
    }
    if (url.pathname === '/controle') {
      if (!win || win.isDestroyed() || win.webContents.isLoading()) return send(res, 503, 'Avatar indisponível');
      let script;
      const action = url.searchParams.get('acao');
      if(action==='informacao'){
        if(!bubbles||bubbles.editing||bubbles.busy)return send(res,409,'Conversa em andamento');
        bubbles.model.show(require('./bubble-model.cjs').information(4),'ambient');bubbles.sync();return send(res,200,'ok');
      }
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

async function receiveBubble(req,res) {
  if(req.method!=='POST')return send(res,405,'Use POST');
  if(!bubbles||!win||win.isDestroyed()||win.webContents.isLoading())return send(res,503,'Avatar indisponível');
  if(req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${port}`)return send(res,403,'Origem não permitida');
  if(req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')return send(res,415,'Use application/json');
  let length=0;const chunks=[];
  for await(const chunk of req){
    length+=chunk.length;
    if(length>262144)return send(res,413,'Texto muito longo');
    chunks.push(chunk);
  }
  let data;
  try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(res,400,'JSON inválido');}
  if(!data||typeof data.texto!=='string'||data.texto.length>32768||!Number.isSafeInteger(data.revisao)||data.revisao<0)return send(res,400,'Mensagem inválida');
  bubbles.setText(data.texto,data.revisao);
  return send(res,200,'ok');
}

function applySize(percent) {
  if(!desktop||!win||win.isDestroyed())return;
  DesktopSize.savePercent(sizeFile,percent);
  const before=win.getBounds(),work=(targetDisplay||screen.getDisplayMatching(before)).workArea;
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
async function setEffects(value, syncRenderer=true) {
  if(typeof value!=='boolean')throw new TypeError('Preferência de efeitos inválida.');
  DesktopSize.saveSettings(sizeFile,{effectsEnabled:value});
  effectsEnabled=value;
  if(syncRenderer)await win.webContents.executeJavaScript(`window.setEffects(${value})`);
}
function effectsError() {
  dialog.showErrorBox('Efeitos do Yato','Não consegui salvar a preferência dos efeitos. Tente novamente.');
}
async function pulseEffects() {
  await setEffects(true,false);
  await win.webContents.executeJavaScript('window.materializar()');
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
    { label:'Yato chibi · beta-2 LAB', enabled:false },
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
    {label:'Brilho e partículas',type:'checkbox',checked:effectsEnabled,click:item=>setEffects(item.checked).catch(effectsError)},
    {label:'Pulso digital',click:()=>pulseEffects().catch(effectsError)},
    ...(bubbles?[{type:'separator'},...bubbles.menuItems()]:[]),
    {type:'separator'},
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
function validPosition(value) {
  return value&&['x','y','width','height'].every(key=>Number.isFinite(value[key]))&&value.width>0&&value.height>0;
}
function initialDesktopBounds() {
  if(targetDisplay)return DisplayTarget.windowBounds(targetDisplay,DesktopSize.dimensions(sizePercent),{desktop:true});
  const saved=DesktopSize.readSettings(sizeFile).position;
  if(validPosition(saved))return DesktopSize.resizeBounds(saved,screen.getDisplayMatching(saved).workArea,sizePercent);
  const area=screen.getPrimaryDisplay().workArea;
  const anchor={x:area.x+area.width-340,y:area.y+area.height-500,width:300,height:500};
  return DesktopSize.resizeBounds(anchor,area,sizePercent);
}
function avatarURL() {
  return `http://127.0.0.1:${port}/?${new URLSearchParams({...desktop?{desktop:'1'}:{},...chat?{chat:'1'}:{},effects:effectsEnabled?'1':'0'})}`;
}
function createWindow() {
  const initial=desktop ? initialDesktopBounds() : targetDisplay?DisplayTarget.windowBounds(targetDisplay,{width:1120,height:940}):{width:1120,height:940};
  win = new BrowserWindow({ ...initial,
    minWidth:desktop ? 150 : 720, minHeight:desktop ? 250 : 700,
    title:'Yato · Beta-2 LAB', backgroundColor:desktop ? '#00000000' : '#101015',
    transparent:desktop, frame:!desktop, alwaysOnTop:desktop, resizable:!desktop,
    focusable:!desktop,skipTaskbar:desktop,minimizable:!desktop,
    show:!selftest&&!desktop, autoHideMenuBar:true,
    webPreferences:{ preload:path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false, sandbox:true, backgroundThrottling:false, offscreen:selftest },
  });
  win.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('context-menu', contextMenu);
  win.on('close',()=>{closing=true;bubbles?.destroy();});
  if(desktop) {
    bubbles=new BubbleHost({parent:win,getDisplay:()=>targetDisplay||screen.getDisplayMatching(win.getBounds()),
      settings:DesktopSize.readSettings(sizeFile),saveSettings:values=>DesktopSize.saveSettings(sizeFile,values),hidden:selftest});
    // Forward right clicks on the native drag region to the webContents menu.
    win.on('system-context-menu',event=>event.preventDefault());
    win.once('ready-to-show',()=>{desktopReady=true;ensureDesktopPresence();});
    win.on('always-on-top-changed',(_event,value)=>{if(!value)ensureDesktopPresence();});
    win.on('minimize',ensureDesktopPresence);
    win.on('blur',ensureDesktopPresence);
    win.webContents.once('did-finish-load',()=>{
      if(automatic)win.webContents.executeJavaScript('window.setMovimento("wandering",true)').catch(console.error);
      if(bubbleDemo)bubbles.demonstrate();
    });
  }
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') app.quit();
  });
  win.loadURL(avatarURL());
  if (desktop) {
    ensureDesktopPresence();
    win.setIgnoreMouseEvents(true, { forward:true });
    let solid = false;
    walker.place(win.getPosition()[0]);
    win.on('will-move', (event,nextBounds) => {
      if(targetDisplay&&!DisplayTarget.contains(targetDisplay,nextBounds)){
        event.preventDefault();win.setBounds(DisplayTarget.constrainBounds(nextBounds,targetDisplay.workArea));
      }
      dragUntil=Date.now()+500;routine.reset();walker.place(win.getBounds().x);
      if(!automatic)win.webContents.executeJavaScript('window.setMovimento("walking",false)').catch(() => {});
      if(!selftest){
        clearTimeout(positionTimer);
        positionTimer=setTimeout(()=>{
          if(!win||win.isDestroyed())return;
          try{DesktopSize.saveSettings(sizeFile,{position:win.getBounds()});}catch(error){console.error('Não foi possível salvar a posição do avatar:',error.message);}
        },500);
      }
    });
    timer = setInterval(() => {
      if (!win || win.isDestroyed()) return;
      const bounds = win.getBounds(), cursor = screen.getCursorScreenPoint();
      const inside = selftest&&testHover!==null ? testHover : cursor.x > bounds.x + bounds.width * .32 && cursor.x < bounds.x + bounds.width * .68 && cursor.y > bounds.y + bounds.height * .37 && cursor.y < bounds.y + bounds.height * .73;
      const interactive=inside||menuOpen;
      if (interactive !== solid) { solid = interactive; win.setIgnoreMouseEvents(!interactive, { forward:true }); }
      const now = Date.now(), dt = Math.min((now - (lastMove || now)) / 1000, .1); lastMove = now;
      if(now-lastPresence>=1000){ensureDesktopPresence();lastPresence=now;}
      const work = (targetDisplay||screen.getDisplayMatching(bounds)).workArea;
      if(Math.abs(walker.x-bounds.x)>2)walker.place(bounds.x);
      const interrupted=inside||menuOpen||Boolean(bubbles?.hovered)||now<dragUntil;
      const activity=automatic?routine.step(dt,interrupted||!requestedMovement.walking):null;
      walker.configure({...requestedMovement,walking:requestedMovement.walking&&(!automatic||activity.phase==='walking')});
      if(activity?.startedWalking)walker.face(activity.direction);
      const snapshot=walker.step(dt,work.x,Math.max(work.x,work.x+work.width-bounds.width),interrupted);
      snapshot.routine={enabled:automatic,...routine.snapshot()};
      const y=Math.max(work.y,Math.min(Math.max(work.y,work.y+work.height-bounds.height),bounds.y));
      if(Math.round(snapshot.x)!==bounds.x||y!==bounds.y)win.setPosition(Math.round(snapshot.x),y);
      win.webContents.send('chibi-motion',snapshot);
      bubbles.setContext({moving:snapshot.mode!=='idle',blocked:interrupted});
      bubbles.tick(dt);
    }, 33);
  }
  if (selftest) win.webContents.once('did-finish-load', () => (bubbleSelftest?require('./qa/bubble-integration.cjs')({win,bubbles,port,targetDisplay,applySize,menuTemplate}):routineSelftest?runRoutineSelftest():sizeSelftest?runSizeSelftest():runSelftest()).then(()=>{if(bubbleSelftest)app.quit();}).catch(error => { console.error(error); app.exit(1); }));
}
ipcMain.on('chibi-close', () => app.quit());
ipcMain.on('chibi-effects', (event,value) => {
  if(event.sender!==win?.webContents||typeof value!=='boolean')return;
  // The studio already updated its renderer. Persist without resetting its
  // clock or cancelling a pulse that the same click just started.
  setEffects(value,false).catch(()=>{
    win.webContents.executeJavaScript(`window.setEffects(${effectsEnabled})`).catch(()=>{});
    effectsError();
  });
});
ipcMain.on('chibi-movement', (event, data) => {
  if(event.sender!==win?.webContents||!data||typeof data!=='object')return;
  for(const key of ['walking','wandering'])if(typeof data[key]==='boolean')requestedMovement[key]=data[key];
  if(Number.isFinite(data.speed))requestedMovement.speed=Math.max(.6,Math.min(1.5,data.speed));
  if(data.direction===1||data.direction===-1)walker.face(data.direction);
  const context={};
  if(['ociosa','ouvindo','pensando','falando'].includes(data.conversation))context.conversation=data.conversation;
  if(typeof data.sleep==='boolean')context.sleep=data.sleep;
  if(typeof data.reaction==='string')context.reaction=data.reaction;
  bubbles?.setContext(context);
});
app.whenReady().then(() => {
  if(monitorRequested){
    targetDisplay=DisplayTarget.selectDisplay(screen);
    screen.on('display-removed',(_event,display)=>{if(display.id===targetDisplay.id)app.quit();});
  }
  server = http.createServer(request);
  server.once('error', error => { console.error(`Não foi possível abrir a porta ${port}: ${error.message}`); app.exit(1); });
  server.listen(port, '127.0.0.1', createWindow);
}).catch(error=>{console.error(error.message);app.exit(1);});
app.on('before-quit', () => { closing=true;clearInterval(timer);clearTimeout(positionTimer);bubbles?.destroy();server?.close(); if(selftest&&fs.existsSync(sizeFile))fs.unlinkSync(sizeFile); });
app.on('window-all-closed', () => app.quit());

async function waitForSelftest(condition,message='Condição do avatar não atingida',timeout=2500) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    if(await condition())return;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw new Error(message);
}

async function runRoutineSelftest() {
  const assert=require('node:assert/strict');
  assert.ok(desktop,'Use --desktop para o teste da rotina');
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const js=code=>win.webContents.executeJavaScript(code);
  const until=waitForSelftest;
  testHover=false;
  assert.ok(targetDisplay&&DisplayTarget.contains(targetDisplay,win.getBounds()),'Routine test must stay on monitor 2');
  await until(async()=>Boolean((await js('window.avatarDebug()')).ready));
  await setAutomatic(true);
  const phases=new Set();let moving=false,restingAfterWalk=false;
  for(let n=0;n<100;n++) {
    await pause(40);phases.add(routine.phase);
    if(Math.abs(walker.velocity)>10)moving=true;
    if(moving&&routine.phase==='idle'&&walker.velocity===0)restingAfterWalk=true;
  }
  assert.deepEqual([...phases].sort(),['idle','walking']);
  assert.ok(moving&&restingAfterWalk,'Deve caminhar e parar sozinho');
  testHover=true;await until(()=>walker.blocked&&walker.velocity===0&&walker.travelVelocity===0,'Hover deve concluir o passo e parar',2000);
  assert.equal(walker.velocity,0);assert.equal(routine.phase,'idle');
  const frozen=win.getBounds().x,remaining=routine.remaining;await pause(180);
  assert.equal(win.getBounds().x,frozen);assert.equal(routine.remaining,remaining);
  testHover=false;await pause(100);assert.equal(walker.velocity,0);
  await until(()=>Math.abs(walker.velocity)>5);
  await js('window.setEstadoConversa("pensando")');await until(()=>walker.mode==='idle','Pensar deve parar o passeio',2000);
  assert.equal(walker.velocity,0);assert.equal(routine.blocked,true);
  const thinkingX=win.getBounds().x;await pause(180);assert.equal(win.getBounds().x,thinkingX);
  await js('window.setEstadoConversa("ociosa")');await pause(100);assert.equal(walker.velocity,0);
  await until(()=>Math.abs(walker.velocity)>5);
  await js('window.reagir("sleep")');await until(()=>walker.mode==='idle','Cochilar deve parar o passeio',2000);assert.equal(walker.velocity,0);
  await js('window.reagir("wake")');await pause(100);assert.equal(walker.velocity,0);
  await until(()=>Math.abs(walker.velocity)>5);
  const base=`http://127.0.0.1:${port}`;
  assert.equal((await fetch(base+'/controle?acao=rotina&valor=2')).status,400);
  assert.equal((await fetch(base+'/controle?acao=rotina&valor=0')).status,200);
  await until(()=>walker.mode==='idle','Desligar passeio deve concluir a parada',2000);assert.equal(automatic,false);assert.equal(walker.velocity,0);
  assert.equal(DesktopSize.readSettings(sizeFile).automatic,false);
  await setAutomatic(true);await pause(80);assert.equal(DesktopSize.readSettings(sizeFile).automatic,true);
  assert.equal((await fetch(base+'/controle?acao=movimento&nome=wandering&valor=1')).status,200);
  assert.equal(automatic,false);await until(()=>Math.abs(walker.velocity)>5);
  assert.equal(win.isFocusable(),false);assert.equal(win.isMinimizable(),false);
  assert.equal(win.isAlwaysOnTop(),true);
  win.setAlwaysOnTop(false);await pause(100);assert.equal(win.isAlwaysOnTop(),true);
  // Keep automated routine checks hidden. The explicit extra flag permits the
  // existing native focus test when an interactive check is actually wanted.
  const visibleFocus=process.argv.includes('--visible-focus-selftest');
  if(visibleFocus){
    let cover;
    try {
      win.showInactive();
      const b=win.getBounds();
      const coverBounds=DisplayTarget.constrainBounds({x:b.x-20,y:b.y-20,width:400,height:650},targetDisplay.workArea);
      cover=new BrowserWindow({...coverBounds,show:false,title:'Yato — teste de troca de janela',webPreferences:{sandbox:true}});
      await cover.loadURL('data:text/html,<body style="background:%23242430;color:white;font:20px sans-serif;padding:24px">Verificando o avatar sobre outras janelas.</body>');
      for(let n=0;n<3;n++) {
        cover.show();await pause(80);
        assert.equal(cover.isFocused(),true);assert.equal(win.isFocused(),false);
        assert.equal(win.isVisible(),true);assert.equal(win.isAlwaysOnTop(),true);
        applySize(n===1?50:75);await pause(80);
        assert.equal(cover.isFocused(),true);assert.equal(win.isAlwaysOnTop(),true);
        cover.hide();await pause(80);
      }
    } finally {cover?.destroy();win.hide();}
  }
  applySize(75);assert.equal(win.isAlwaysOnTop(),true);
  assert.ok(DisplayTarget.contains(targetDisplay,win.getBounds()));
  const result={ok:true,monitor:{id:targetDisplay.id,label:targetDisplay.label,bounds:win.getBounds()},checks:['idle/walk cycles','hover freezes and resumes after rest','thinking pauses','sleep pauses','manual override and persistence','non-focusable desktop','topmost recovery','resize preserves topmost',...(visibleFocus?['native cover focus preserved']:[])],date:new Date().toISOString()};
  fs.mkdirSync(path.join(__dirname,'qa'),{recursive:true});
  fs.writeFileSync(path.join(__dirname,'qa','routine-result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));app.quit();
}

async function runSizeSelftest() {
  const assert=require('node:assert/strict');
  assert.ok(desktop,'Use --desktop para o teste de tamanho');
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const js=code=>win.webContents.executeJavaScript(code);
  const until=waitForSelftest;
  testHover=false;
  assert.ok(targetDisplay&&DisplayTarget.contains(targetDisplay,win.getBounds()),'Size test must stay on monitor 2');
  for(let i=0;i<100&&!(await js('window.avatarDebug().ready'));i++)await pause(50);
  assert.ok((await js('window.avatarDebug()')).ready);
  fs.mkdirSync(path.join(__dirname,'qa'),{recursive:true});
  for(const percent of [50,75,100,125]) {
    const before=win.getBounds(),work=screen.getDisplayMatching(before).workArea;
    const item=menuTemplate().find(item=>item.submenu).submenu.find(item=>item.label.includes(`${percent}%`));
    item.click();
    assert.deepEqual(win.getBounds(),DesktopSize.resizeBounds(before,work,percent));
    assert.equal(DesktopSize.readPercent(sizeFile),percent);
    assert.ok(menuTemplate().find(item=>item.submenu).submenu.find(item=>item.checked).label.includes(`${percent}%`));
    await pause(180);
    const state=await js('window.avatarDebug()');
    assert.equal(state.width,win.getBounds().width);
    assert.equal(state.height,win.getBounds().height);
    fs.writeFileSync(path.join(__dirname,'qa',`size-${percent}.png`),(await win.webContents.capturePage()).toPNG());
  }
  await js('window.setMovimento("walking",true)');await until(()=>walker.mode==='walking');
  const prior={...walker.snapshot()},options={...walker.options};
  applySize(50);
  assert.equal(walker.velocity,prior.velocity);
  assert.equal(walker.travelVelocity,prior.travelVelocity);
  assert.equal(walker.cycle,prior.cycle);
  assert.deepEqual(walker.options,options);
  await pause(150);assert.ok((await js('window.avatarDebug()')).motion.pace>0);
  testHover=true;await until(()=>walker.blocked&&walker.velocity===0&&walker.travelVelocity===0,'Hover deve parar antes de redimensionar',2000);assert.equal(walker.velocity,0);
  applySize(125);await pause(150);assert.equal(walker.velocity,0);
  testHover=false;await until(()=>Math.abs(walker.velocity)>0);
  await js('window.setMovimento("walking",false)');await until(()=>walker.mode==='idle','Parada após resize',2000);
  const work=screen.getDisplayMatching(win.getBounds()).workArea;
  for(const [right,bottom] of [[false,false],[true,false],[false,true],[true,true]]) {
    applySize(50);
    const b=win.getBounds();
    win.setPosition(right?work.x+work.width-b.width:work.x,bottom?work.y+work.height-b.height:work.y);
    walker.x=win.getBounds().x;
    applySize(125);
    const result=win.getBounds();
    assert.ok(result.x>=work.x&&result.y>=work.y);
    assert.ok(result.x+result.width<=work.x+work.width&&result.y+result.height<=work.y+work.height);
  }
  const base=`http://127.0.0.1:${port}`;
  for(const invalid of ['',0,49,126,'NaN','Infinity',75.5])assert.equal((await fetch(base+'/controle?acao=tamanho&valor='+invalid)).status,400);
  assert.equal((await fetch(base+'/controle?acao=tamanho&valor=75')).status,200);
  const health=await(await fetch(base+'/saude')).json();assert.equal(health.sizePercent,75);
  assert.ok(DisplayTarget.contains(targetDisplay,win.getBounds()));
  const result={ok:true,monitor:{id:targetDisplay.id,label:targetDisplay.label,bounds:win.getBounds()},checks:['native menu: 50/75/100/125%','renderer follows window size','center and foot baseline preserved','preferences saved','walk cycle and velocity preserved','hover pause and resume','all four screen edges','HTTP validation'],date:new Date().toISOString()};
  fs.writeFileSync(path.join(__dirname,'qa','size-result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));app.quit();
}

async function runSelftest() {
  testHover=false;
  testHover=false;
  const assert = require('node:assert/strict');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const js = code => win.webContents.executeJavaScript(code);
  const until=waitForSelftest;
  const state=()=>js('window.avatarDebug()');
  assert.ok(targetDisplay&&DisplayTarget.contains(targetDisplay,win.getBounds()),'Integration test must stay on monitor 2');
  assert.ok(validPosition({x:3605,y:626,width:225,height:375}));
  for(const invalid of [null,{}, {x:NaN,y:0,width:225,height:375},{x:0,y:0,width:0,height:1}])assert.ok(!validPosition(invalid));
  const mode = desktop ? 'desktop' : 'studio';
  const capture = async name => fs.writeFileSync(path.join(__dirname,'qa',`${mode}-${name}.png`), (await win.webContents.capturePage()).toPNG());
  for (let i = 0; i < 100 && !(await js('window.avatarDebug?.().ready')); i++) await pause(50);
  assert.equal((await js('window.avatarDebug()')).frames, 8);
  assert.equal((await js('window.avatarDebug()')).reactionFrames, 4);
  assert.equal((await js('window.avatarDebug()')).walkFrames, 12);
  assert.equal((await state()).cycleFrames,16);
  assert.equal((await state()).cycleRestFrames,2);
  assert.equal((await state()).framesPerDirection,8);
  assert.equal((await state()).walkSource,'arm-cycle-v3');
  assert.equal((await state()).refined,true);
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(base+'/assets/yato-caminhada-ciclo-v2.png')).status,200);
  assert.equal((await fetch(base+'/assets/yato-caminhada-bracos-v3.png')).status,200);
  assert.equal((await fetch(base+'/effects.js')).status,200);
  assert.equal((await state()).effects,true);
  assert.equal(new URL(win.webContents.getURL()).searchParams.get('effects'),'1');
  // Persist only this preference; size, routine and saved position must survive.
  const preferences={sizePercent,automatic,position:win.getBounds()};
  DesktopSize.saveSettings(sizeFile,preferences);
  await menuTemplate().find(item=>item.label==='Brilho e partículas').click({checked:false});
  assert.equal((await state()).effects,false);
  assert.equal(DesktopSize.readSettings(sizeFile).effectsEnabled,false);
  for(const key of Object.keys(preferences))assert.deepEqual(DesktopSize.readSettings(sizeFile)[key],preferences[key]);
  assert.equal(menuTemplate().find(item=>item.label==='Brilho e partículas').checked,false);
  await win.loadURL(avatarURL());
  await until(async()=>Boolean(await js('window.avatarDebug?.().ready')),'Renderer deve recarregar com efeitos desativados');
  assert.equal((await state()).effects,false);
  assert.equal(new URL(win.webContents.getURL()).searchParams.get('effects'),'0');
  await js('document.getElementById("effects").click()');
  await until(async()=>effectsEnabled&&DesktopSize.readSettings(sizeFile).effectsEnabled===true,'Controle visual deve salvar efeitos pelo preload');
  assert.equal((await state()).effects,true);
  await js('window.setBoca(.4)');
  await menuTemplate().find(item=>item.label==='Brilho e partículas').click({checked:false});
  await menuTemplate().find(item=>item.label==='Pulso digital').click();
  await until(async()=>(await state()).effectState.materializing,'Pulso do menu deve aparecer');
  assert.equal((await state()).mouth,.4,'Efeitos não devem interferir na boca');
  assert.equal(DesktopSize.readSettings(sizeFile).effectsEnabled,true);
  await until(async()=>!(await state()).effectState.materializing,'Pulso deve terminar',2000);
  await js('document.getElementById("materialize").click()');
  await until(async()=>(await state()).effectState.materializing,'IPC da UI não deve cancelar o pulso');
  await pause(100);assert.equal((await state()).effectState.materializing,true);
  for(const key of Object.keys(preferences))assert.deepEqual(DesktopSize.readSettings(sizeFile)[key],preferences[key]);
  assert.equal((await fetch(base + '/controle?acao=boca&valor=0.7')).status, 200);
  assert.equal((await js('window.avatarDebug()')).mouth, .7);
  assert.equal((await fetch(base + '/controle?acao=boca&valor=NaN')).status, 400);
  assert.equal((await fetch(base + '/controle?acao=boca&valor=Infinity')).status, 400);
  assert.equal((await fetch(base + '/controle?acao=expressao&nome=pensando')).status, 200);
  assert.equal((await js('window.avatarDebug()')).expression, 'pensando');
  assert.equal((await fetch(base + '/controle?acao=expressao&nome=invalida')).status, 400);
  assert.equal((await fetch(base + '/controle?acao=reacao&nome=invalida')).status, 400);
  assert.equal((await fetch(base + '/controle?acao=estado&nome=invalida')).status, 400);
  assert.equal((await fetch(base + '/main.js')).status, 404);
  await js('window.reagir("wake"); window.setBoca(0); window.setExpressao("ociosa"); window.setMovimento("blinking", false)');
  await pause(180);
  fs.mkdirSync(path.join(__dirname,'qa'), { recursive:true });
  await capture('neutral');
  await js('window.setBoca(.8)'); await pause(200);
  await js('window.piscar()');
  await pause(45);
  const blinkingTalk = await js('window.avatarDebug()');
  assert.equal(blinkingTalk.blinkActive, true); assert.ok(blinkingTalk.visibleMouth > .5);
  await capture('blink-talk');
  await js('window.setBoca(0)');
  const previousPosition = win.getBounds().x;
  await js('window.setMovimento("walking",true); window.setMovimento("wandering",true)');
  await until(async()=>{const s=await state();return s.motion.pace>.2&&s.view==='walk-1'&&(desktop?win.getBounds().x!==previousPosition:Math.abs(s.x)>1);});
  const moving = await js('window.avatarDebug()'); assert.equal(moving.walking, true);
  assert.ok(moving.frame >= 0 && moving.frame < 8);
  assert.ok(moving.motion.pace>0);
  assert.equal(moving.view, 'walk-1');
  if (!desktop) assert.ok(Math.abs(moving.x) > 1);
  else {
    assert.notEqual(win.getBounds().x, previousPosition);
    const bounds = win.getBounds(), work = screen.getDisplayMatching(bounds).workArea;
    assert.ok(bounds.x >= work.x && bounds.x + bounds.width <= work.x + work.width);
  }
  await capture('walk-right');
  await js('window.setMovimento("wandering",false);window.setDirecao(-1);window.setMovimento("walking",true)');
  let observedTurn=false;
  await until(async()=>{const s=await state();if(s.motion.mode==='turning'){observedTurn=true;assert.equal(s.motion.velocity,0);}return s.direction===-1&&s.view==='walk--1'&&s.motion.pace>0;},'Virada deve terminar parada e retomar para esquerda');
  assert.ok(observedTurn);
  assert.equal((await js('window.avatarDebug()')).direction,-1);
  assert.equal((await js('window.avatarDebug()')).view,'walk--1');
  await capture('walk-left');
  await js('window.setMovimento("wandering",true)');await pause(200);
  if(desktop){
    testHover=true;await until(async()=>{const m=(await state()).motion;return m.blocked&&m.velocity===0&&m.travelVelocity===0;},'Hover deve concluir a passada',2000);
    assert.equal((await js('window.avatarDebug()')).motion.blocked,true);
    const frozen=win.getBounds().x;await pause(200);assert.equal(win.getBounds().x,frozen);
    assert.equal((await js('window.avatarDebug()')).motion.pace,0);
    testHover=false;await until(async()=>(await state()).motion.pace>0);
    const b=win.getBounds(),work=screen.getDisplayMatching(b).workArea,maxX=work.x+work.width-b.width;
    walker.configure({walking:false});win.setPosition(maxX-4,b.y);walker.place(maxX-4);walker.face(1);
    walker.configure({walking:true,wandering:true,speed:1});await until(async()=>{const s=await state();return s.direction===-1&&s.view==='walk--1'&&win.getBounds().x<maxX-4;},'Borda deve parar, virar e retomar');
    const edge=await js('window.avatarDebug()');assert.equal(edge.direction,-1);assert.equal(edge.view,'walk--1');
    assert.ok(win.getBounds().x<maxX-4&&win.getBounds().x>=work.x);
    await capture('edge-turn');
  }
  assert.equal((await fetch(base + '/controle?acao=reacao&nome=wave')).status, 200);
  await pause(250);
  assert.equal((await js('window.avatarDebug()')).effectiveWalking, false);
  await capture('wave');
  for(let i=0;i<75&&(await js('window.avatarDebug()')).reaction;i++)await pause(40);
  assert.equal((await js('window.avatarDebug()')).effectiveWalking, true);
  for(const action of ['think','celebrate','sleep']) {
    await js(`window.reagir(${JSON.stringify(action)})`);await pause(250);
    assert.equal((await js('window.avatarDebug()')).reaction, action);await capture(action);
  }
  await until(async()=>(await state()).motion.mode==='idle','Cochilo deve concluir a parada',2000);
  const sleepingX = desktop ? win.getBounds().x : (await js('window.avatarDebug()')).x;
  await pause(300);
  assert.equal((await js('window.avatarDebug()')).sleep, true);
  assert.equal((await js('window.avatarDebug()')).effectiveWalking, false);
  assert.equal(desktop ? win.getBounds().x : (await js('window.avatarDebug()')).x, sleepingX);
  await js('window.reagir("wake")');await pause(100);
  assert.equal((await js('window.avatarDebug()')).effectiveWalking, true);
  await js('window.setMovimento("walking",false)');await until(async()=>(await state()).motion.mode==='idle','Parada deve chegar ao repouso',2000);
  assert.equal((await js('window.avatarDebug()')).motion.pace,0);
  await pause(220);assert.equal((await js('window.avatarDebug()')).view,'front');
  await capture('stopped');
  if(desktop){
    const startX=win.getBounds().x;
    menuTemplate().find(item=>item.label==='Caminhar / parar').click();
    await until(async()=>{const current=await state();return current.walking&&current.wandering&&Math.abs(win.getBounds().x-startX)>2;},'Caminhar do menu deve deslocar o avatar');
    assert.ok((await state()).motion.travelVelocity!==0);
    assert.equal((await fetch(base+'/controle?acao=movimento&nome=wandering&valor=0')).status,200);
    await until(async()=>(await state()).motion.mode==='idle','Desligar passeio deve parar pernas e janela',2000);
    const stopped=await state();assert.equal(stopped.walking,false);assert.equal(stopped.wandering,false);
  }
  await js('window.setMovimento("walking",true)');await until(async()=>(await state()).motion.pace>0);
  assert.ok((await js('window.avatarDebug()')).motion.pace>0);
  for (const conversation of ['ouvindo','pensando','falando']) {
    assert.equal((await fetch(base + '/controle?acao=estado&nome=' + conversation)).status,200);
    await js('window.setBoca(0)');await until(async()=>(await state()).motion.mode==='idle','Conversa deve parar o passeio',2000);
    const current=await state();
    assert.equal(current.conversation,conversation);
    assert.equal(current.motion.pace,0);
    assert.equal(current.walking,true);
    if(conversation==='pensando')assert.equal(current.reaction,'think');
    await js('window.setBoca(.7)');
    assert.equal((await state()).mouth,conversation==='falando'?.7:0);
  }
  await js('window.setEstadoConversa("ociosa")');await until(async()=>(await state()).motion.pace>0);
  assert.ok((await js('window.avatarDebug()')).motion.pace>0);
  await js('window.setVelocidade(9)');assert.equal((await js('window.avatarDebug()')).speed,1.5);
  await js('window.setVelocidade(1)');
  if(!desktop){win.setSize(760,800);await pause(150);const resized=await js('window.avatarDebug()');assert.ok(Math.abs(resized.x)<=resized.bound);win.setSize(1120,940);}
  await js('window.setMovimento("walking", false); window.falarDemo()');
  if(chat){
    assert.equal((await state()).audioPlaying,false,'O chat não deve tocar a demonstração');
    assert.ok(!menuTemplate().some(item=>item.label==='Ouvir / parar a fala'));
    assert.equal((await state()).mouth,0);
  }else{
    await until(async()=>{const s=await state();return s.audioPlaying&&s.audioTime>0;},'Áudio de demonstração deve iniciar');
    await until(async()=>(await state()).mouth>.1,'O áudio deve realmente abrir a boca',4000);
    await capture('talk');
    await js('window.falarDemo()');
    assert.equal((await state()).mouth,0);
  }
  assert.ok(DisplayTarget.contains(targetDisplay,win.getBounds()));
  const result = { ok:true, mode, chat, monitor:{id:targetDisplay.id,label:targetDisplay.label,bounds:win.getBounds()}, checks:['8 coherent gait poses + matching rest','8 walk frames per direction','HTTP lip-sync','invalid input','expression bridge','static allowlist','right and left profile','turn stops before direction changes','acceleration and smooth stop','movement bounds','gesture pauses and resumes walking','sleep stops movement','wake resumes','simultaneous blink and speech','speed clamp','saved position validation',...(chat?['chat blocks demo audio','chat hides demo menu','mouth follows speaking and stays closed while listening/thinking']:['audio playback','audio opens mouth','mouth reset']),...(desktop?['native hover pauses window and gait','native edge turn synchronizes direction','walking menu travels','disabling wandering stops gait and travel']:[])], date:new Date().toISOString() };
  result.checks.push('conversation pauses through silence and resumes walk preference');
  result.checks.push('arm-cycle-v3 atlas served','effects toggle and pulse in native menu','effects preload IPC persists without cancelling pulse','effects preference survives reload','effects preserve size routine and saved position','effects leave lip-sync unchanged');
  fs.writeFileSync(path.join(__dirname,'qa', `${mode}${chat?'-chat':''}-result.json`), JSON.stringify(result,null,2));
  console.log(JSON.stringify(result)); app.quit();
}
