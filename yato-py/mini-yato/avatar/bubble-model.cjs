'use strict';

const PHRASES = Object.freeze([
  'Se precisar de mim, é só chamar.',
  'Uma pausa para esticar as pernas cai bem.',
  'Um gole de água e seguimos?',
  'Tô por aqui. Pode continuar no seu ritmo.',
  '', '',
]);
function information(index,now=new Date()){
  const hour=now.getHours();
  const time=now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  if(index===4){
    if(hour<6)return `${time}… madrugada tranquila. Vai descansar daqui a pouco?`;
    if(hour<12)return `${time} já! Bom dia pra quem está começando agora.`;
    if(hour<14)return `${time}. Hora de pensar no almoço?`;
    if(hour<18)return `${time}. Como está indo a tarde?`;
    if(hour<22)return `${time}. Vai ser uma noite de jogo ou de descanso?`;
    return `${time}… vai rolar uma partida ou hoje é descanso?`;
  }
  if(index===5)return `${time}. Sem pressa — uma coisa de cada vez.`;
  return PHRASES[index];
}

// Keep every character, including line breaks and surrogate pairs. Rendering is
// plain text: markup from the chat is never interpreted as HTML.
function paginate(text, limit = 220) {
  const points = Array.from(text);
  const pages = [];
  for (let start = 0; start < points.length;) {
    let end = Math.min(points.length, start + limit);
    if (end < points.length) {
      for (let at = end - 1; at >= start + Math.floor(limit * .55); at--) {
        if (/\s/u.test(points[at])) { end = at + 1; break; }
      }
    }
    pages.push(points.slice(start, end).join(''));
    start = end;
  }
  return pages;
}

function placement(parent, area, size = {width:322, height:210}) {
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  const left = parent.x + parent.width * .28 - width - 10;
  const right = parent.x + parent.width * .72 + 10;
  const canLeft = left >= area.x;
  const canRight = right + width <= area.x + area.width;
  const side = canLeft || !canRight ? 'left' : 'right';
  const x = Math.max(area.x, Math.min(area.x + area.width - width, side === 'left' ? left : right));
  const y = Math.max(area.y, Math.min(area.y + area.height - height, parent.y + parent.height * .12 - 42));
  return {x:Math.round(x), y:Math.round(y), width:Math.round(width), height:Math.round(height), side};
}

class BubbleModel {
  constructor({random = Math.random, bubblesEnabled = true, occasionalPhrases = true,infoIntervalMinutes=30} = {}) {
    this.random = random;
    this.infoIntervalMinutes=[2,5,10,30,60].includes(infoIntervalMinutes)?infoIntervalMinutes:30;
    this.enabled = bubblesEnabled !== false;
    this.occasional = occasionalPhrases !== false;
    this.context = {conversation:'ociosa', sleep:false, reaction:'', moving:false, blocked:false};
    this.message = null;
    this.lastAnswer = '';
    this.revision = -1;
    this.lastPhrase = -1;
    this.dismissedHint = '';
    this.nextPhrase = this.interval();
  }
  interval() { return this.infoIntervalMinutes*60*(1+Math.max(0, Math.min(1, this.random()))); }
  readingTime(text) { return Math.max(12, Math.min(30, Array.from(text).length * .075)); }
  show(text, kind) {
    const pages = paginate(text);
    this.message = pages.length ? {kind, pages, page:0, remaining:this.readingTime(pages[0])} : null;
  }
  setText(text, revision) {
    if (typeof text !== 'string' || !Number.isSafeInteger(revision) || revision < 0 || revision <= this.revision) return false;
    this.revision = revision;
    this.lastAnswer = text.trim() ? text : '';
    this.message = null;
    this.dismissedHint = '';
    this.nextPhrase = this.interval();
    if (this.lastAnswer) this.show(this.lastAnswer, 'answer');
    else this.updateHint();
    return true;
  }
  setContext(context) {
    const before = this.context.conversation;
    this.context = {...this.context, ...context};
    if (before !== this.context.conversation) this.dismissedHint = '';
    const c = this.context;
    // Hover/menu blocks new remarks and pauses reading; it must not erase a
    // remark precisely when the user moves the pointer over it to read.
    if (this.message?.kind === 'ambient' && (c.conversation !== 'ociosa' || c.sleep || c.reaction || c.moving)) this.message = null;
    this.updateHint();
  }
  quiet() {
    const c = this.context;
    return c.conversation === 'ociosa' && !c.sleep && !c.reaction && !c.moving && !c.blocked;
  }
  updateHint() {
    // The response arrives before the Python state changes from thinking to
    // speaking/idle. A delayed state packet must never replace that answer.
    if (this.message && this.message.kind !== 'hint') return;
    const name = this.context.conversation;
    const text = {ouvindo:'Tô ouvindo…', pensando:'Deixa eu pensar…'}[name];
    if (!text || this.dismissedHint === name) {
      if (this.message?.kind === 'hint') this.message = null;
      return;
    }
    if (this.message?.pages[0] !== text) this.show(text, 'hint');
  }
  configure({bubblesEnabled, occasionalPhrases,infoIntervalMinutes}) {
    if([2,5,10,30,60].includes(infoIntervalMinutes)){this.infoIntervalMinutes=infoIntervalMinutes;this.nextPhrase=this.interval();}
    if (typeof bubblesEnabled === 'boolean') {
      this.enabled = bubblesEnabled;
      if (!bubblesEnabled) this.message = null;
      this.nextPhrase = this.interval();
    }
    if (typeof occasionalPhrases === 'boolean') {
      this.occasional = occasionalPhrases;
      if (!occasionalPhrases && this.message?.kind === 'ambient') this.message = null;
      this.nextPhrase = this.interval();
    }
  }
  dismiss() {
    if (this.message?.kind === 'hint') this.dismissedHint = this.context.conversation;
    this.message = null;
    this.nextPhrase = this.interval();
  }
  page(delta) {
    if (!this.message || ![-1, 1].includes(delta)) return;
    const m = this.message;
    m.page = Math.max(0, Math.min(m.pages.length - 1, m.page + delta));
    m.remaining = this.readingTime(m.pages[m.page]);
  }
  revisit() {
    if (!this.lastAnswer || !this.enabled) return false;
    this.show(this.lastAnswer, 'answer');
    this.nextPhrase = this.interval();
    return true;
  }
  demonstrate() {
    if (!this.enabled) return;
    this.show('Ei! Agora também posso conversar por aqui. Minhas respostas aparecem neste balão — mesmo com a voz desligada.', 'demo');
    this.nextPhrase = this.interval();
  }
  tick(dt, hover = false) {
    dt = Math.max(0, Math.min(1, Number(dt) || 0));
    if (!this.enabled) return;
    const c = this.context;
    if (this.message) {
      if (this.message.kind !== 'hint' && !hover && c.conversation !== 'falando' && !c.blocked) {
        this.message.remaining -= dt;
        if (this.message.remaining <= 0) { this.message = null; this.nextPhrase = this.interval(); }
      }
      return;
    }
    if (!this.occasional || c.conversation !== 'ociosa' || c.sleep || c.reaction || c.blocked || hover) return;
    this.nextPhrase = Math.max(0, this.nextPhrase - dt);
    if (this.nextPhrase > 0 || !this.quiet()) return;
    if(this.onlineInfo)return;
    let index = Math.floor(Math.max(0, Math.min(.999999, this.random())) * PHRASES.length);
    if (index === this.lastPhrase) index = (index + 1) % PHRASES.length;
    this.lastPhrase = index;
    this.show(information(index), 'ambient');
    this.nextPhrase = this.interval();
  }
  view() {
    const m = this.message;
    return {visible:this.enabled && !this.context.sleep && Boolean(m), text:m?.pages[m.page] || '', kind:m?.kind || '',
      page:(m?.page ?? 0) + 1, total:m?.pages.length || 0};
  }
  snapshot() {
    const {text, ...view} = this.view();
    return {...view, infoIntervalMinutes:this.infoIntervalMinutes,enabled:this.enabled, occasionalPhrases:this.occasional, canRevisit:Boolean(this.lastAnswer), revision:this.revision,
      remaining:this.message?.remaining ?? 0, nextPhrase:this.nextPhrase};
  }
}

module.exports = {BubbleModel, paginate, placement, PHRASES,information};
