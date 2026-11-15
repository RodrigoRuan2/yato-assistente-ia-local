'use strict';
// Own application only: all windows start hidden/offscreen on monitor 2.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const Target=require('../display-target.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,message){
  const deadline=Date.now()+7000;
  while(Date.now()<deadline){if(await check())return;await pause(40);}
  throw new Error(message);
}

module.exports=async function({win,bubbles,port,targetDisplay,applySize,menuTemplate}){
  const base=`http://127.0.0.1:${port}`;
  const js=code=>bubbles.window.webContents.executeJavaScript(code);
  const avatar=code=>win.webContents.executeJavaScript(code);
  const post=(texto,revisao,extra={})=>fetch(base+'/balao',{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify({texto,revisao})});
  const text=()=>js('document.getElementById("message").textContent');
  await until(async()=>bubbles.snapshot().ready&&(await avatar('window.avatarDebug()'))?.ready,'Renderers não inicializaram');
  assert(Target.contains(targetDisplay,win.getBounds()));
  assert(Target.contains(targetDisplay,bubbles.window.getBounds()));
  assert.equal(win.isVisible(),false);assert.equal(bubbles.window.isVisible(),false);
  assert.equal(bubbles.window.isFocusable(),false);
  const original=win.getBounds();

  const literal='Oi! <img src=x onerror="window.executou=true"> Tudo certo por aqui. 👋';
  assert.equal((await post(literal,1)).status,200);
  await until(async()=>await text()===literal,'Texto literal/Unicode não chegou');
  assert.equal(await js('Boolean(window.executou||document.querySelector("#message img"))'),false);
  assert.deepEqual(win.getBounds(),original,'Balão não pode redimensionar o personagem');
  assert.equal((await post('obsoleto',0)).status,200);
  assert.equal((await post('duplicado',1)).status,200);
  await pause(80);assert.equal(await text(),literal);
  for(const [payload,code] of [[{texto:3,revisao:2},400],[{texto:'x',revisao:-1},400],[{texto:'x',revisao:1.5},400],[{texto:'x'.repeat(32769),revisao:2},400]]){
    assert.equal((await fetch(base+'/balao',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).status,code);
  }
  assert.equal((await fetch(base+'/balao')).status,405);
  assert.equal((await post('origem externa',2,{Origin:'https://example.org'})).status,403);
  assert.equal((await fetch(base+'/balao',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
  assert.equal(await text(),literal);

  // Exercise the real Python sender against the live Electron receiver.
  const python=path.resolve(__dirname,'../../.venv/Scripts/python.exe');
  await promisify(execFile)(python,['-c',`import avatar2d; avatar2d._enviar_texto('${base}/controle', 'Resposta pelo chat, mesmo sem voz.', 2)`],{cwd:path.resolve(__dirname,'../..'),windowsHide:true});
  await until(async()=>await text()==='Resposta pelo chat, mesmo sem voz.','Ponte Python real não chegou');
  const health=await(await fetch(base+'/saude')).json();
  assert(!JSON.stringify(health.bubble).includes('Resposta pelo chat'),'Saúde não deve expor conteúdo');

  const long='Esta é uma resposta longa, com acentos e uma ideia completa em cada trecho. '.repeat(12)+'Fim. 👋';
  await post(long,3);await until(()=>bubbles.snapshot().total>1,'Paginação não foi criada');
  const pages=[];
  for(let i=0;i<bubbles.snapshot().total;i++){
    pages.push(await text());
    const fits=await js('(()=>{const e=document.getElementById("message");return e.scrollHeight<=e.clientHeight+1&&e.scrollWidth<=e.clientWidth+1;})()');
    assert(fits,'Texto cortado dentro da página');
    if(i<bubbles.snapshot().total-1){await js('document.getElementById("next").click()');await pause(50);}
  }
  assert.equal(pages.join(''),long,'Paginação perdeu texto');
  await js('document.getElementById("previous").click()');await pause(50);
  assert.equal(await text(),pages.at(-2));
  await js('document.getElementById("close").click()');await pause(70);
  assert.equal(bubbles.snapshot().visible,false);
  const replay=menuTemplate().find(item=>item.label==='Rever última resposta');
  assert(replay&&replay.enabled!==false);replay.click();await pause(80);
  assert.equal(bubbles.snapshot().visible,true);
  await post('',4);await pause(70);assert.equal(bubbles.snapshot().visible,false);
  assert.equal(menuTemplate().find(item=>item.label==='Rever última resposta').enabled,false);

  await post('Ei, estou por aqui. Pode falar comigo no chat. Se precisar, eu apareço neste balão.',5);
  await pause(100);
  // Every size and corner stays on monitor 2, and scale never changes on text.
  const work=targetDisplay.workArea;
  for(const percent of [50,75,100,125]){
    applySize(percent);
    for(const [right,bottom] of [[false,false],[true,false],[false,true],[true,true]]){
      const b=win.getBounds();
      win.setPosition(right?work.x+work.width-b.width:work.x,bottom?work.y+work.height-b.height:work.y);
      await pause(70);
      assert(Target.contains(targetDisplay,bubbles.window.getBounds()),'Balão saiu do monitor');
      assert.equal(win.getBounds().width,b.width);
    }
  }
  applySize(75);
  await pause(100);
  fs.writeFileSync(path.join(__dirname,'bubble-preview.png'),(await bubbles.window.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(__dirname,'bubble-avatar.png'),(await win.webContents.capturePage()).toPNG());
  // Presence reporting follows native gesture/conversation state and mouth still works.
  await fetch(base+'/controle?acao=estado&nome=falando');
  await fetch(base+'/controle?acao=boca&valor=0.7');await pause(160);
  assert((await avatar('window.avatarDebug()')).mouth>.6);
  assert.equal(bubbles.snapshot().kind,'answer');
  await fetch(base+'/controle?acao=estado&nome=ociosa');
  await avatar('window.reagir("sleep")');await pause(90);
  assert.equal(bubbles.snapshot().visible,false);
  await avatar('window.reagir("wake")');await pause(90);
  // Preferences change only their own fields.
  const toggle=menuTemplate().find(item=>item.label==='Frases ocasionais');
  assert(toggle);toggle.click({checked:false});await pause(80);
  assert.equal(bubbles.snapshot().occasionalPhrases,false);
  assert.equal((await(await fetch(base+'/saude')).json()).sizePercent,75);
  const result={ok:true,monitor:{id:targetDisplay.id,label:targetDisplay.label},checks:[
    'real Python POST sender','text with and without audio','literal HTML and Unicode','revision ordering and duplicate delivery',
    'invalid inputs and origin','pagination without loss','dismiss and replay','explicit clear removes replay',
    'all avatar sizes at monitor corners','independent avatar bounds','lip sync','sleep hides bubble','preferences',
    'hidden offscreen requested monitor','no response content in health'],bubble:bubbles.snapshot(),date:new Date().toISOString()};
  fs.writeFileSync(path.join(__dirname,'bubble-integration-result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
};
