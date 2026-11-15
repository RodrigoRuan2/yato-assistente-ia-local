'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Commands,parse}=require('../commands.cjs');
const {BubbleModel,information}=require('../bubble-model.cjs');
(async()=>{
  assert.equal(parse('Abre o Google!').kind,'google');
  assert.equal(parse('abre o explorador de arquivos na pasta jogos').name,'jogos');
  assert.equal(parse('abra a pasta "Meus Jogos"').name,'Meus Jogos');
  assert.equal(parse('que horas são?').kind,'time');
  for(const text of ['abre https://example.com','cmd /c del *','abre o Google & calc','<script>alert(1)</script>',null,'a'.repeat(501)])assert.equal(parse(text).kind,'help');
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'yato-commands-'));
  try{
    const folder=path.join(home,'qa_jogos_'+process.pid);await fs.mkdir(folder);
    const calls=[],saved=[];
    const commands=new Commands({home,parent:null,shell:{openExternal:async x=>calls.push(x),openPath:async x=>{calls.push(x);return '';}},dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[folder]})},saveSettings:p=>saved.push(p),folders:{jogos:folder}});
    await commands.execute('abre o google');assert.equal(calls.pop(),'https://www.google.com/');
    assert.equal(await commands.resolve('jogos'),folder);
    await commands.execute('abre a pasta jogos');assert.equal(calls.pop(),folder);
    await commands.execute('abre a pasta favoritos');assert.equal(saved[0].commandFolders.favoritos,folder);
    commands.dialog.showOpenDialog=async()=>{throw Error('Alias should be reused');};
    await commands.execute('abre a pasta favoritos');assert.equal(calls.pop(),folder);
    commands.dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});
    const count=calls.length;assert.match(await commands.execute('abre a pasta inexistente'),/nenhuma pasta/);assert.equal(calls.length,count);
    commands.shell.openPath=async()=> 'failed';assert.match(await commands.execute('abre a pasta jogos'),/Não consegui/);
    assert.equal(await commands.resolve('file://invalid'),null);
    const model=new BubbleModel({random:()=>0,infoIntervalMinutes:5});assert.equal(model.nextPhrase,300);
    model.configure({infoIntervalMinutes:10});assert.equal(model.nextPhrase,600);
    assert.match(information(4,new Date(2026,10,14,12,34)),/12:34/);
    assert.match(information(5,new Date(2026,10,14,12,34)),/2026/);
    console.log(JSON.stringify({ok:true,checks:['intent parsing','no shell evaluation','Google fixed URL','directory lookup','folder alias persistence','cancel and failure','intervals','fresh date and time']}));
  }finally{
    assert.equal(path.dirname(path.resolve(home)),path.resolve(os.tmpdir()));
    assert(path.basename(home).startsWith('yato-commands-'));
    await fs.rm(home,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
