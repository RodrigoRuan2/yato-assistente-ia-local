'use strict';

const path = require('node:path');
const {BrowserWindow, ipcMain, screen, dialog, shell, app} = require('electron');
const {Commands,parse}=require('./commands.cjs');
const {ask}=require('./assistant-client.cjs');
const {calculate}=require('./calculator.cjs');
const {OnlineInfo}=require('./online-info.cjs');
const {BubbleModel, placement,information} = require('./bubble-model.cjs');

class BubbleHost {
  constructor({parent, getDisplay, settings = {}, saveSettings = () => {}, hidden = false}) {
    this.parent = parent;
    this.getDisplay = getDisplay;
    this.saveSettings = saveSettings;
    this.hidden = hidden;
    this.ready = false;
    this.destroyed = false;
    this.model = new BubbleModel(settings);
    this.online=new OnlineInfo({settings,save:saveSettings});
    this.model.onlineInfo=false;
    this.commandInfo=null;
    this.editing=false;this.busy=false;this.commandResult='';
    this.commands=new Commands({shell,dialog,parent,home:app.getPath('home'),saveSettings,folders:settings.commandFolders});
    this.height = 170;
    this.lastView = '';
    const initial = this.position();
    this.side = initial.side;
    const {side, ...bounds} = initial;
    this.window = new BrowserWindow({...bounds, title:'Yato · Balão', show:false,
      transparent:true, frame:false, backgroundColor:'#00000000', resizable:false,
      focusable:false, skipTaskbar:true, minimizable:false, maximizable:false,
      alwaysOnTop:true, hasShadow:false, autoHideMenuBar:true,
      webPreferences:{preload:path.join(__dirname, 'bubble-preload.cjs'),
        contextIsolation:true, nodeIntegration:false, sandbox:true,
        backgroundThrottling:false, offscreen:hidden},
    });
    this.window.setAlwaysOnTop(true, 'pop-up-menu');
    this.window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    this.window.webContents.on('will-navigate', event => event.preventDefault());
    this.onReady = event => {
      if (!this.owns(event)) return;
      this.ready = true;
      this.sync();
    };
    this.onHeight = (event, height) => {
      if (!this.owns(event) || !Number.isFinite(height)) return;
      height = Math.round(Math.max(48, Math.min(480, height)));
      if (this.height === height) return;
      this.height = height;
      this.sync();
    };
    this.onAction = (event, action) => {
      if (!this.owns(event)) return;
      if (action === 'close') {this.editing=false;this.commandResult='';this.commandInfo=null;this.window.setFocusable(false);this.model.dismiss();}
      else if(action==='compose'){this.compose();return;}
      else if(action==='source'){
        const info=this.editing?this.commandInfo:this.model.message?.info;
        if(info&&this.safeSource(info.link))shell.openExternal(info.link).catch(()=>{});
        return;
      }
      else if (action === 'previous') this.model.page(-1);
      else if (action === 'next') this.model.page(1);
      else return;
      this.sync();
    };
    ipcMain.on('yato-bubble-ready', this.onReady);
    ipcMain.on('yato-bubble-height', this.onHeight);
    ipcMain.on('yato-bubble-action', this.onAction);
    ipcMain.handle('yato-bubble-command',async(event,text)=>{
      if(!this.owns(event)||!this.editing||this.busy||typeof text!=='string'||!text.trim()||text.length>2000)return false;
      this.busy=true;this.commandResult='Já vou…';this.commandInfo=null;this.sync();
      try{
        if(process.env.YATO_ASSISTANT_URL){
          const result=await ask(text);this.commandResult=result.text;
          return result.accepted!==false;
        }
        // Standalone previews retain local tools; conversation needs the main app.
        const intent=parse(text).kind;
        const kind=['weather','news'].includes(intent)?intent:null;
        if(kind){const info=await this.online.get(kind);this.commandInfo=info;this.commandResult=info?.text||'Nenhuma manchete nova por enquanto.';if(info)this.online.shown(info);}
        else if(intent==='help')this.commandResult=(await ask(text)).text;
        else this.commandResult=await this.commands.execute(text);
      }catch{this.commandResult=process.env.YATO_ASSISTANT_URL?'Perdi a conexão com o Yato. Confira o chat principal antes de reenviar; seu pedido pode ter sido recebido.':'Não consegui consultar ou concluir isso agora. Tente novamente em alguns minutos.';return false;}
      finally{this.busy=false;if(!this.destroyed)this.sync();}
      return true;
    });
    this.onParentClosed = () => this.destroy();
    parent.once('closed', this.onParentClosed);
    this.window.on('closed', () => { if (!this.destroyed) this.destroy(); });
    this.window.loadFile(path.join(__dirname, 'bubble.html')).catch(error => {
      console.error('Não foi possível abrir o balão do Yato:', error.message);
    });
  }
  owns(event) { return !this.destroyed && !this.window.isDestroyed() && event.sender === this.window.webContents; }
  async assistantAction(data){
    if(!data||typeof data!=='object'||typeof data.action!=='string'||(data.value!==undefined&&typeof data.value!=='string'))throw Error('Ação inválida');
    const value=data.value||'';if(value.length>500)throw Error('Valor muito longo');
    if(data.action==='calculate'){
      const result=calculate(value);return result?(result.error||`Resultado: ${result.text}`):'Expressão inválida. Use números e operadores.';
    }
    if(data.action==='weather'||data.action==='news'){
      const info=await this.online.get(data.action);return info?`${info.text}\nFonte: ${info.source}\n${info.link}`:'Nenhuma informação disponível agora.';
    }
    if(data.action==='folder'){
      if(!value.trim()||/[\x00-\x1f]/.test(value))throw Error('Informe uma pasta válida');
      return this.commands.execute(`abre a pasta ${value}`);
    }
    const actions={google:'abre o google',explorer:'abre o explorador',time:'que horas são',date:'que dia é hoje'};
    if(!Object.hasOwn(actions,data.action))throw Error('Ação não disponível');
    return this.commands.execute(actions[data.action]);
  }
  position() {
    if(this.quick){
      const parent=this.parent.getBounds(),area=this.getDisplay().workArea;
      const width=Math.min(244,area.width),height=Math.min(this.height,area.height);
      const x=Math.round(Math.max(area.x,Math.min(area.x+area.width-width,parent.x+parent.width/2-width/2)));
      const y=Math.round(Math.max(area.y,Math.min(area.y+area.height-height,parent.y+parent.height*.06-height)));
      return {x,y,width,height,side:'above'};
    }
    return placement(this.parent.getBounds(), this.getDisplay().workArea, {width:316, height:this.height});
  }
  get hovered() {
    if(this.editing||this.busy)return true;
    if (this.destroyed || !this.window || this.window.isDestroyed() || !this.window.isVisible()) return false;
    const point = screen.getCursorScreenPoint(), b = this.window.getBounds();
    return point.x >= b.x && point.x < b.x+b.width && point.y >= b.y && point.y < b.y+b.height;
  }
  setText(text, revision) {
    const accepted = this.model.setText(text, revision);
    if (accepted) this.sync();
    return accepted;
  }
  setContext(context) {
    if (!Object.keys(context).some(key => this.model.context[key] !== context[key])) return;
    this.model.setContext(context);
    this.sync();
  }
  tick(dt) { this.model.tick(dt, this.hovered);this.pollOnline();this.sync(); }
  safeSource(link){try{const u=new URL(link);return u.protocol==='https:'&&['canaltech.com.br','news.xbox.com','open-meteo.com'].includes(u.hostname);}catch{return false;}}
  async pollOnline(){
    if(!this.model.onlineInfo||!this.model.enabled||!this.model.occasional||this.editing||this.hovered||!this.model.quiet()||this.model.message)return;
    const kind=this.online.due();if(!kind)return;
    this.online.pending=true;const revision=this.model.revision;
    try{
      const info=await this.online.get(kind);
      if(!info){this.online.retryAt=Date.now()+15*60000;return;}
      if(this.destroyed||revision!==this.model.revision||!this.model.onlineInfo||!this.model.enabled||!this.model.occasional||this.editing||this.hovered||!this.model.quiet()||this.model.message){this.online.retryAt=Date.now()+60000;return;}
      this.online.shown(info);this.model.show(info.text,'ambient');this.model.message.info=info;this.sync();
    }catch{this.online.retryAt=Date.now()+15*60000;}
    finally{this.online.pending=false;}
  }
  async showOnline(kind){
    if(this.busy)return;
    if(!this.model.enabled&&!this.configure({bubblesEnabled:true}))return;
    this.compose();this.busy=true;this.commandInfo=null;this.commandResult='Consultando…';this.sync();
    try{const info=await this.online.get(kind);if(this.destroyed)return;this.commandInfo=info;this.commandResult=info?.text||'Nenhuma manchete nova por enquanto.';if(info)this.online.shown(info);}
    catch{this.commandResult='A consulta não está disponível agora. Tente novamente em alguns minutos.';}
    finally{this.busy=false;if(!this.destroyed)this.sync();}
  }
  sync() {
    if (this.destroyed || this.parent.isDestroyed() || this.window.isDestroyed()) return;
    const view = {...this.model.view(), side:this.side,editing:this.editing,busy:this.busy};
    view.fullText=this.model.message?.pages.join('')||'';
    if(this.editing){view.visible=true;view.text=this.commandResult||'Oi! O que você quer fazer?';view.fullText=view.text;view.kind='command';view.page=1;view.total=1;}
    this.quick=view.quick=!this.editing&&['ambient','hint'].includes(view.kind);
    const info=this.editing?this.commandInfo:this.model.message?.info;
    view.source=info?.source||'';view.hasSource=Boolean(info&&this.safeSource(info.link));
    view.updated=info?new Date(info.published).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
    // An empty bubble is a hidden native window. Avoid querying displays and
    // moving it on every avatar frame; reposition before it becomes visible.
    if (view.visible) {
      const {side, ...bounds} = this.position();
      this.side = view.side = side;
      view.tailX=Math.max(24,Math.min(bounds.width-24,this.parent.getBounds().x+this.parent.getBounds().width/2-bounds.x-8));
      const old = this.window.getBounds();
      if (Object.keys(bounds).some(key => old[key] !== bounds[key])) this.window.setBounds(bounds);
    }
    const signature = JSON.stringify(view);
    if (this.ready && this.lastView !== signature) {
      this.window.webContents.send('yato-bubble-state', view);
      this.lastView = signature;
    }
    const visible = this.ready && view.visible && !this.hidden && this.parent.isVisible() && !this.parent.isMinimized();
    if (visible) {
      if (!this.window.isAlwaysOnTop()) this.window.setAlwaysOnTop(true, 'pop-up-menu');
      if (!this.window.isVisible()) this.window.showInactive();
    } else if (this.window.isVisible()) this.window.hide();
  }
  configure(values) {
    try {
      this.saveSettings(values);
      this.model.onlineInfo=false;
      if(values.bubblesEnabled===false){this.editing=false;this.commandResult='';this.window.setFocusable(false);}
      this.model.configure(values);
      this.sync();
      return true;
    } catch (error) {
      console.error('Não foi possível salvar os balões:', error.message);
      if (!this.hidden) dialog.showErrorBox('Balões do Yato', 'Não consegui salvar esta preferência. Tente novamente.');
      return false;
    }
  }
  demonstrate() {
    if (!this.model.enabled && !this.configure({bubblesEnabled:true})) return false;
    this.model.demonstrate();
    this.sync();
    return true;
  }
  compose(){
    if(!this.model.enabled&&!this.configure({bubblesEnabled:true}))return;
    this.editing=true;this.sync();this.window.setFocusable(true);
    if(!this.hidden){this.window.show();this.window.focus();}
    this.window.webContents.send('yato-bubble-focus');
  }
  menuItems() {
    return [
      {label:'Falar com o Yato…',click:()=>this.compose()},
      {label:'Ver clima agora',click:()=>this.showOnline('weather')},
      {label:'Ver notícia agora',click:()=>this.showOnline('news')},
      {label:'Balões de texto', type:'checkbox', checked:this.model.enabled,
        click:item => this.configure({bubblesEnabled:item.checked})},
      {label:'Comentários curtos de companhia', type:'checkbox', checked:this.model.occasional,
        enabled:this.model.enabled, click:item => this.configure({occasionalPhrases:item.checked})},
      ...(!this.model.onlineInfo?[{label:'Intervalo das informações',submenu:[30,60].map(minutes=>({label:`${minutes}–${minutes*2} minutos`,type:'radio',checked:this.model.infoIntervalMinutes===minutes,click:()=>this.configure({infoIntervalMinutes:minutes})}))}]:[]),
      {label:'Mostrar informação agora',enabled:this.model.enabled,click:()=>{if(this.model.onlineInfo){this.showOnline('weather');return;}this.model.show(information(4),'ambient');this.model.nextPhrase=this.model.interval();this.sync();}},
      {label:'Rever última resposta', enabled:this.model.enabled && Boolean(this.model.lastAnswer),
        click:() => { this.model.revisit(); this.sync(); }},
      {label:'Testar balão', click:() => this.demonstrate()},
    ];
  }
  snapshot() {
    return {...this.model.snapshot(), editing:this.editing,busy:this.busy,ready:this.ready, nativeVisible:!this.destroyed && !this.window.isDestroyed() && this.window.isVisible(),
      bounds:!this.destroyed && !this.window.isDestroyed() ? this.window.getBounds() : null, side:this.side, hovered:this.hovered};
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    ipcMain.removeListener('yato-bubble-ready', this.onReady);
    ipcMain.removeListener('yato-bubble-height', this.onHeight);
    ipcMain.removeListener('yato-bubble-action', this.onAction);
    ipcMain.removeHandler('yato-bubble-command');
    this.parent.removeListener('closed', this.onParentClosed);
    if (!this.window.isDestroyed()) this.window.destroy();
  }
}

module.exports = BubbleHost;
