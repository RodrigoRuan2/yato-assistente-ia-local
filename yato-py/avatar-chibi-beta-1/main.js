'use strict';
const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const desktop = process.argv.includes('--desktop');
const selftest = process.argv.includes('--selftest');
const port = Number(process.env.YATO_CHIBI_PORTA || (selftest ? 18138 : 8138));
let win, server, timer, wandering = false, direction = 1, lastMove = 0;
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.json':'application/json', '.wav':'audio/wav' };
const allowed = new Set(['index.html','style.css','avatar.js','assets/yato-chibi-sprites-v1.png','assets/yato-chibi-conceito-v1.png','assets/fala-demo.wav','assets/fala-demo.json']);
const send = (res, code, value) => { res.writeHead(code, { 'Content-Type':'text/plain; charset=utf-8' }); res.end(value); };

async function request(req, res) {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method !== 'GET') return send(res, 405, 'Método não permitido');
    if (url.pathname === '/controle') {
      if (!win || win.isDestroyed() || win.webContents.isLoading()) return send(res, 503, 'Avatar indisponível');
      let script;
      const action = url.searchParams.get('acao');
      if (action === 'boca') {
        const raw = url.searchParams.get('valor');
        const value = Number(raw);
        if (raw === null || raw.trim() === '' || !Number.isFinite(value)) return send(res, 400, 'Valor inválido');
        script = `window.setBoca(${Math.max(0, Math.min(1, value))})`;
      } else if (action === 'expressao') {
        const name = url.searchParams.get('nome');
        if (!['ociosa','pensando','falando','feliz'].includes(name)) return send(res, 400, 'Expressão inválida');
        script = `window.setExpressao(${JSON.stringify(name)})`;
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

function contextMenu() {
  Menu.buildFromTemplate([
    { label:'Yato chibi · prévia v1', enabled:false },
    ...[['Ouvir / parar a fala','speak'],['Piscar','blink'],['Caminhar / parar','walking'],['Passear / parar','wandering']].map(([label, action]) => ({ label, click:() => win.webContents.send('chibi-action', action) })),
    { type:'separator' }, { label:'Fechar', click:() => app.quit() },
  ]).popup({ window:win });
}
function createWindow() {
  win = new BrowserWindow({ width:desktop ? 300 : 1120, height:desktop ? 500 : 940,
    minWidth:desktop ? 300 : 720, minHeight:desktop ? 500 : 700,
    title:'Yato · Estúdio chibi', backgroundColor:desktop ? '#00000000' : '#101015',
    transparent:desktop, frame:!desktop, alwaysOnTop:desktop, resizable:!desktop,
    show:!selftest, autoHideMenuBar:true,
    webPreferences:{ preload:path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false, sandbox:true, backgroundThrottling:false, offscreen:selftest },
  });
  win.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('context-menu', contextMenu);
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') app.quit();
  });
  win.loadURL(`http://127.0.0.1:${port}/${desktop ? '?desktop=1' : ''}`);
  if (desktop) {
    const area = screen.getPrimaryDisplay().workArea;
    win.setPosition(area.x + area.width - 340, area.y + area.height - 500);
    win.setIgnoreMouseEvents(true, { forward:true });
    let solid = false, position = win.getPosition()[0];
    win.on('will-move', () => { wandering = false; win.webContents.executeJavaScript('window.setMovimento("wandering",false)').catch(() => {}); });
    timer = setInterval(() => {
      if (!win || win.isDestroyed()) return;
      const bounds = win.getBounds(), cursor = screen.getCursorScreenPoint();
      const inside = cursor.x > bounds.x + bounds.width * .32 && cursor.x < bounds.x + bounds.width * .68 && cursor.y > bounds.y + bounds.height * .37 && cursor.y < bounds.y + bounds.height * .73;
      if (inside !== solid) { solid = inside; win.setIgnoreMouseEvents(!inside, { forward:true }); }
      const now = Date.now(), dt = Math.min((now - (lastMove || now)) / 1000, .1); lastMove = now;
      if (wandering && !inside) {
        const work = screen.getDisplayMatching(bounds).workArea;
        if (Math.abs(position - bounds.x) > 3) position = bounds.x;
        position += direction * 32 * dt;
        const max = Math.max(work.x, work.x + work.width - bounds.width);
        if (position <= work.x || position >= max) { position = Math.max(work.x, Math.min(max, position)); direction *= -1; }
        win.setPosition(Math.round(position), Math.max(work.y, Math.min(work.y + work.height - bounds.height, bounds.y)));
      } else position = bounds.x;
    }, 33);
  }
  if (selftest) win.webContents.once('did-finish-load', () => runSelftest().catch(error => { console.error(error); app.exit(1); }));
}
ipcMain.on('chibi-close', () => app.quit());
ipcMain.on('chibi-movement', (_event, data) => { wandering = data?.walking === true && data?.wandering === true; });
app.whenReady().then(() => {
  server = http.createServer(request);
  server.once('error', error => { console.error(`Não foi possível abrir a porta ${port}: ${error.message}`); app.exit(1); });
  server.listen(port, '127.0.0.1', createWindow);
});
app.on('before-quit', () => { clearInterval(timer); server?.close(); });
app.on('window-all-closed', () => app.quit());

async function runSelftest() {
  const assert = require('node:assert/strict');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const js = code => win.webContents.executeJavaScript(code);
  for (let i = 0; i < 100 && !(await js('window.avatarDebug().ready')); i++) await pause(50);
  assert.equal((await js('window.avatarDebug()')).frames, 8);
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(base + '/controle?acao=boca&valor=0.7')).status, 200);
  assert.equal((await js('window.avatarDebug()')).mouth, .7);
  assert.equal((await fetch(base + '/controle?acao=boca&valor=NaN')).status, 400);
  assert.equal((await fetch(base + '/controle?acao=boca&valor=Infinity')).status, 400);
  assert.equal((await fetch(base + '/controle?acao=expressao&nome=pensando')).status, 200);
  assert.equal((await js('window.avatarDebug()')).expression, 'pensando');
  assert.equal((await fetch(base + '/controle?acao=expressao&nome=invalida')).status, 400);
  assert.equal((await fetch(base + '/main.js')).status, 404);
  await js('window.setBoca(0); window.setExpressao("ociosa"); window.setMovimento("blinking", false)');
  await pause(180);
  fs.mkdirSync(path.join(__dirname,'qa'), { recursive:true });
  fs.writeFileSync(path.join(__dirname,'qa', desktop ? 'desktop.png' : 'studio.png'), (await win.webContents.capturePage()).toPNG());
  await js('window.piscar()');
  await pause(45);
  fs.writeFileSync(path.join(__dirname,'qa','blink.png'), (await win.webContents.capturePage()).toPNG());
  const previousPosition = win.getBounds().x;
  await js('window.setMovimento("walking",true); window.setMovimento("wandering",true)');
  await pause(400);
  const moving = await js('window.avatarDebug()'); assert.equal(moving.walking, true);
  assert.ok(moving.frame >= 4 && moving.frame <= 7);
  if (!desktop) assert.ok(Math.abs(moving.x) > 1);
  else {
    assert.notEqual(win.getBounds().x, previousPosition);
    const bounds = win.getBounds(), work = screen.getDisplayMatching(bounds).workArea;
    assert.ok(bounds.x >= work.x && bounds.x + bounds.width <= work.x + work.width);
  }
  fs.writeFileSync(path.join(__dirname,'qa','walk.png'), (await win.webContents.capturePage()).toPNG());
  await js('window.setMovimento("walking", false); window.falarDemo()');
  await pause(650);
  assert.equal((await js('window.avatarDebug()')).audioPlaying, true);
  assert.ok((await js('window.avatarDebug()')).audioTime > 0);
  let mouthDetected = false;
  for (let i = 0; i < 100; i++) {
    if ((await js('window.avatarDebug()')).mouth > .1) { mouthDetected = true; break; }
    await pause(40);
  }
  assert.ok(mouthDetected, 'O áudio deve realmente abrir a boca');
  fs.writeFileSync(path.join(__dirname,'qa','talk.png'), (await win.webContents.capturePage()).toPNG());
  await js('window.falarDemo()');
  assert.equal((await js('window.avatarDebug()')).mouth, 0);
  const result = { ok:true, mode:desktop ? 'desktop' : 'studio', checks:['8 frames','HTTP lip-sync','invalid input','expression bridge','static allowlist','walk cycle','movement','audio playback','audio opens mouth','mouth reset'], date:new Date().toISOString() };
  fs.writeFileSync(path.join(__dirname,'qa', desktop ? 'desktop-result.json' : 'result.json'), JSON.stringify(result,null,2));
  console.log(JSON.stringify(result)); app.quit();
}
