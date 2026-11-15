'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {calculate}=require('./calculator.cjs');
const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
function parse(text){
  if(typeof text!=='string'||text.length>500)return {kind:'help'};
  const raw=text.trim().replace(/[.!?]+$/,'').replace(/^(?:oi[,!]?\s+)?(?:yato[,!]?\s+)?(?:por favor[, ]+)?(?:(?:voce )?(?:pode|poderia|consegue)\s+)?/i,'').replace(/\s+(?:pra mim|para mim|por favor)(?:[, ]+(?:pra mim|para mim|por favor))?$/i,'');
  const s=normalize(raw);
  const math=calculate(s);if(math)return {kind:'calculate',...math};
  if(/^(?:(?:abre|abrir|abra|acessa|acessar|acesse|entrar|entra)(?: no| o)?|quero (?:abrir|acessar)(?: o)?) google$/.test(s))return {kind:'google'};
  if(/^(?:(?:me (?:diz|diga|fala)|diga|dizer|saber) )?(?:que horas sao(?: agora)?|qual (?:e )?a hora(?: agora)?|horas|hora)$/.test(s))return {kind:'time'};
  if(/^(?:que dia e hoje|qual (?:e )?a data(?: de hoje)?|data|dia de hoje)$/.test(s))return {kind:'date'};
  if(/^(?:(?:me (?:mostra|mostre|fala|diz)|mostrar|ver|consultar|quero saber) (?:o |a )?)?(?:clima(?: de hoje)?|tempo(?: hoje)?|como (?:esta|ta) o (?:tempo|clima)(?: hoje)?|previsao(?: do tempo)?(?: de hoje)?)$/.test(s))return {kind:'weather'};
  if(/^(?:(?:me (?:mostra|mostre|conta|conte|traz)|mostrar|ver|quero ver) (?:as |uma )?)?(?:noticias|noticia|manchetes|novidades)(?: (?:de|sobre) (?:jogos|ia|tecnologia))?$/.test(s))return {kind:'news'};
  if(/^(?:abre|abrir|abra)(?: o)? explorador(?: de arquivos)?$/.test(s))return {kind:'explorer'};
  const match=raw.match(/^(?:abre|abrir|abra|abrindo|acessa|acesse|acessar|entra|entrar|quero abrir)\s+(?:(?:o\s+)?explorador(?:\s+de\s+arquivos)?\s+(?:na\s+)?pasta\s+|(?:(?:a|na)\s+)?pasta\s+)(.+)$/i);
  if(match)return {kind:'folder',name:match[1].trim().replace(/^"(.*)"$/,'$1')};
  return {kind:'help'};
}
class Commands{
  constructor({shell,dialog,parent,home,saveSettings=()=>{},folders={}}){Object.assign(this,{shell,dialog,parent,home,saveSettings});this.folders={...folders};}
  async isDirectory(p){try{return (await fs.stat(p)).isDirectory();}catch{return false;}}
  async resolve(name){
    const key=normalize(name);
    if(this.folders[key]&&await this.isDirectory(this.folders[key]))return this.folders[key];
    // Open only directories. Nothing is evaluated as a shell command or URL.
    if(/^[a-z]:[\\/]/i.test(name))return await this.isDirectory(name)?path.resolve(name):null;
    if(/[\\/:<>|?*\x00-\x1f]/.test(name))return null;
    const aliases={downloads:'Downloads',documentos:'Documents','area de trabalho':'Desktop',imagens:'Pictures',videos:'Videos',musicas:'Music'};
    if(aliases[key]){const p=path.join(this.home,aliases[key]);if(await this.isDirectory(p))return p;}
    const roots=[this.home,path.join(this.home,'Documents'),path.join(this.home,'Desktop')];
    for(let code=67;code<=90;code++)roots.push(String.fromCharCode(code)+':\\');
    const matches=[];
    for(const root of roots){
      try{for(const entry of await fs.readdir(root,{withFileTypes:true}))if(entry.isDirectory()&&normalize(entry.name)===key)matches.push(path.join(root,entry.name));}catch{}
    }
    return matches.length===1?matches[0]:null;
  }
  async execute(text){
    const command=parse(text);
    if(command.kind==='calculate')return command.error||`O resultado é ${command.text}.`;
    if(command.kind==='google'){await this.shell.openExternal('https://www.google.com/');return 'Google aberto no navegador.';}
    if(command.kind==='time')return `Agora são ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}.`;
    if(command.kind==='date')return `Hoje é ${new Date().toLocaleDateString('pt-BR',{dateStyle:'full'})}.`;
    if(command.kind==='explorer'||command.kind==='folder'){
      let folder=command.kind==='explorer'?this.home:await this.resolve(command.name);
      if(!folder){
        const result=await this.dialog.showOpenDialog(this.parent,{title:`Escolha a pasta: ${command.name}`,properties:['openDirectory']});
        if(result.canceled||!result.filePaths[0])return 'Tudo bem, não abri nenhuma pasta.';
        folder=result.filePaths[0];
        if(!await this.isDirectory(folder))return 'Essa pasta não está disponível.';
        const folders={...this.folders,[normalize(command.name)]:folder};
        this.saveSettings({commandFolders:folders});this.folders=folders;
      }
      const error=await this.shell.openPath(folder);
      return error?'Não consegui abrir essa pasta. Confira se ela está disponível.':`Pasta aberta: ${folder}`;
    }
    return 'Ainda não entendi esse pedido. Posso abrir o Google ou pastas, consultar clima e notícias, dizer a hora e calcular. Tente “pode abrir a pasta jogos?” ou “quanto é 18 vezes 27?”.';
  }
}
module.exports={Commands,parse,normalize};
