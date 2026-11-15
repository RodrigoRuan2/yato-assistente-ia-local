// Supplemental visual QA: never writes to beta-1 or to the original preview.
const {app,BrowserWindow}=require('electron');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
let server;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  server=http.createServer((req,res)=>{
    const name=req.url==='/'?'index.html':req.url.slice(1);
    const file=path.resolve(root,name);
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);res.end();return;}res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; object-src 'none'");res.end(data);});
  });
  await new Promise(r=>server.listen(18140,'127.0.0.1',r));
  const win=new BrowserWindow({show:false,width:1120,height:940,webPreferences:{offscreen:true,backgroundThrottling:false}});
  const js=code=>win.webContents.executeJavaScript(code);
  win.webContents.on('console-message',(_event,...args)=>console.log(...args));
  await win.loadURL('http://127.0.0.1:18140/');
  for(let i=0;i<100&&!(await js('window.avatarDebug().ready'));i++)await sleep(50);
  if(!(await js('window.avatarDebug().ready')))throw Error('Renderer not ready');
  await js('window.setMovimento("blinking",false)');
  await sleep(200);
  fs.writeFileSync(path.join(__dirname,'visual-neutral.png'),(await win.webContents.capturePage()).toPNG());
  for(const action of ['wave','think','celebrate','sleep']){
    await js(`window.reagir(${JSON.stringify(action)})`);await sleep(600);
    fs.writeFileSync(path.join(__dirname,`visual-${action}.png`),(await win.webContents.capturePage()).toPNG());
  }
  await js('window.reagir("wake");window.setBoca(.8)');await sleep(250);
  await js('window.piscar()');await sleep(80);
  fs.writeFileSync(path.join(__dirname,'visual-blink-talk.png'),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify(await js('window.avatarDebug()')));server.close();app.quit();
}).catch(error=>{console.error(error);server?.close();app.exit(1);});
