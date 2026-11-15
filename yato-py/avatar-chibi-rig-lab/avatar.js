/* Independent rig prototype. The approved beta-1 and sprite lab are untouched. */
'use strict';
const desktop = new URLSearchParams(location.search).has('desktop');
const chat = new URLSearchParams(location.search).has('chat');
document.documentElement.classList.toggle('desktop', desktop);
const canvas = document.getElementById('avatar'), ctx = canvas.getContext('2d');
const stage = document.getElementById('stage'), voice = document.getElementById('voice');
const sheet = new Image(), reactions = new Image(), walkSheet = new Image(), rigAtlas=new Image();
const walker = new YatoMotion();
let nativeMotion = walker.snapshot(), motion = walker.snapshot(), lastViewKey = '';
const DURATIONS = { wave:2400, think:3000, celebrate:1700, sleep:Infinity };
const REACTION_FRAME = { wave:0, think:1, celebrate:2, sleep:3 };
const LABELS = { wave:'Ei, estou por aqui.', think:'Deixa eu pensar…', celebrate:'Essa foi boa!', sleep:'Só um cochilo…' };
const state = { ready:false, breathing:true, blinking:true, walking:false, wandering:false,
  idleMotion:true, following:true, mouth:0, visibleMouth:0, expression:'ociosa',
  blinkActive:false, blinkUntil:0, nextBlink:performance.now()+2200, x:0, direction:1,
  frame:0, speed:1, reaction:'', reactionProgress:0, sleep:false, effectiveWalking:false, bound:0,
  conversation:'ociosa',skeleton:false,footLocks:false,demo:false };
let rig=null, usingRig=false, demoAge=0, demoPhase='rest';
let conversationSeen=0;
let frames=[], reactionFrames=[], walkFrames=[], envelope=null, width=0, height=0, lastTime=0;
let phase=0, reactionAge=0, transition=1, transitionFrom=null, transitionDuration=.2, audioError=null;
let cursorTarget=0, cursorLean=0, lastMotion='', speechRequest=0, speechLoading=false;
let speechHoldUntil=0;
const poseCanvas = document.createElement('canvas'); poseCanvas.width=384; poseCanvas.height=560;
const poseCtx=poseCanvas.getContext('2d');
const previousPose=document.createElement('canvas'); previousPose.width=384; previousPose.height=560;
const previousCtx=previousPose.getContext('2d');
const $ = id => document.getElementById(id);
const setText = (id,value) => { const el=$(id); if (el && el.textContent!==value) el.textContent=value; };
const damp=(current,target,rate,dt)=>target+(current-target)*Math.exp(-rate*dt);
const smooth=t=>t*t*(3-2*t);

// Normalize to head center and soles, not the pose's overall width (swinging arms).
// All crops exist only in the renderer; approved source PNGs remain unchanged.
function prepareFrames(image, columns, rows, lateral=false) {
  const raw=document.createElement('canvas'); raw.width=image.width; raw.height=image.height;
  const rc=raw.getContext('2d',{willReadFrequently:true}); rc.drawImage(image,0,0);
  const rgba=rc.getImageData(0,0,image.width,image.height).data, result=[], bounds=[];
  for (let n=0;n<columns*rows;n++) {
    const ox=Math.round((n%columns)*image.width/columns), oy=Math.round(Math.floor(n/columns)*image.height/rows);
    const cw=Math.round((n%columns+1)*image.width/columns)-ox;
    const ch=Math.round((Math.floor(n/columns)+1)*image.height/rows)-oy;
    let top=ch,bottom=0;
    for(let y=0;y<ch;y++) for(let x=0;x<cw;x++) if(rgba[((oy+y)*image.width+ox+x)*4+3]>180){top=Math.min(top,y);bottom=Math.max(bottom,y);}
    let headLeft=cw, headRight=0;
    for(let y=top;y<top+(bottom-top)*.17;y++) for(let x=0;x<cw;x++) if(rgba[((oy+y)*image.width+ox+x)*4+3]>180){headLeft=Math.min(headLeft,x);headRight=Math.max(headRight,x);}
    bounds.push({ox,oy,cw,ch,top,bottom,headLeft,headRight});
  }
  for(let n=0;n<bounds.length;n++){
    const {ox,oy,cw,ch,top,bottom,headLeft,headRight}=bounds[n];
    const row=bounds.slice(Math.floor(n/columns)*columns,(Math.floor(n/columns)+1)*columns);
    const heights=row.map(b=>b.bottom-b.top).sort((a,b)=>a-b);
    const referenceHeight=lateral?heights[Math.floor(heights.length/2)]:bottom-top;
    const normalized=document.createElement('canvas');normalized.width=384;normalized.height=560;
    const nc=normalized.getContext('2d'), scale=512/Math.max(1,referenceHeight);
    if(lateral) {
      // The lateral sheet is drawn with a head 25% larger relative to its body.
      // Match the approved frontal head, keeping the crown and soles anchored.
      // Sample the original once; blend the width correction through the hood.
      const headScale=scale*.8, neck=top+referenceHeight*.34;
      const crown=532-(bottom-top)*scale, neckY=crown+(neck-top)*headScale;
      const bodyScale=(532-neckY)/(bottom-neck), center=(headLeft+headRight)/2;
      nc.imageSmoothingQuality='high';
      for(let y=0;y<560;y++) {
        const sy=y<neckY?top+(y-crown)/headScale:neck+(y-neckY)/bodyScale;
        const sh=y<neckY?1/headScale:1/bodyScale;
        const blend=smooth(Math.max(0,Math.min(1,(sy-neck)/(referenceHeight*.14))));
        const sx=scale*(.8+.2*blend);
        // Avoid sampling the neighbouring row of the source sprite sheet.
        if(sy<0||sy+sh>ch)continue;
        nc.drawImage(image,ox,oy+sy,cw,sh,192-center*sx,y,cw*sx,1);
      }
    } else nc.drawImage(image,ox,oy,cw,ch,192-(headLeft+headRight)/2*scale,532-bottom*scale,cw*scale,ch*scale);
    result.push(normalized);
  }
  return result;
}

function resize(){
  const r=stage.getBoundingClientRect();width=r.width;height=r.height;
  const dpr=Math.min(devicePixelRatio||1,2); canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  state.bound=Math.max(0,width/2-targetHeight()*.35);
  state.x=Math.max(-state.bound,Math.min(state.bound,state.x));
}
function targetHeight(){return desktop?height*.88:Math.min(height*.79,480);}
new ResizeObserver(resize).observe(stage);
stage.addEventListener('pointermove',e=>{const b=stage.getBoundingClientRect();cursorTarget=Math.max(-1,Math.min(1,(e.clientX-b.left-b.width/2)/(b.width/2)));});
stage.addEventListener('pointerleave',()=>{cursorTarget=0;});

function notifyMotion(){
  state.effectiveWalking=state.walking&&state.conversation==='ociosa'&&!state.reaction&&!state.sleep&&voice.paused&&state.mouth<=.05&&performance.now()>=speechHoldUntil;
  // Keep wandering requested while decelerating so the last step also slows spatially.
  const command={walking:state.effectiveWalking,wandering:state.wandering,speed:state.speed};
  const key=JSON.stringify(command);
  if(key!==lastMotion){if(desktop)window.chibiNative?.movement(command);else walker.configure(command);lastMotion=key;}
}
function rememberPose(duration=.2){
  previousCtx.clearRect(0,0,384,560);previousCtx.drawImage(poseCanvas,0,0);
  transitionFrom=previousPose;transition=0;transitionDuration=duration;
}
window.setBoca=value=>{
  const n=Number(value);state.mouth=Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;
  if(['ouvindo','pensando'].includes(state.conversation))state.mouth=0;
  if(state.mouth>.05)speechHoldUntil=performance.now()+350;
  if(state.mouth>.05&&state.reaction)window.reagir('wake');
  if($('mouth'))$('mouth').value=state.mouth;
  setText('mouth-value',`${Math.round(state.mouth*100)}%`);
};
window.setExpressao=name=>{
  if(!['ociosa','pensando','falando','feliz'].includes(name))return;
  if(name==='pensando')window.reagir('think');
  else if(name==='feliz')window.reagir('celebrate');
  else if(name==='falando'&&state.sleep)window.reagir('wake');
  state.expression=name;
};
window.setMovimento=(name,value)=>{
  if(!['breathing','blinking','walking','wandering','idleMotion','following'].includes(name))return;
  const wasWalking=state.walking;state[name]=Boolean(value);
  if(name==='wandering'&&value){state.walking=true;if($('walking'))$('walking').checked=true;}
  if(name==='walking'&&!value){state.wandering=false;if($('wandering'))$('wandering').checked=false;}
  if(!wasWalking&&state.walking)phase=0;
  if(name==='walking'||name==='wandering')rememberPose();
  if($(name))$(name).checked=state[name];notifyMotion();
};
window.setVelocidade=value=>{
  const n=Number(value);if(!Number.isFinite(n))return;
  state.speed=Math.max(.6,Math.min(1.5,n));if($('speed'))$('speed').value=state.speed;
  setText('speed-value',`${state.speed.toFixed(1)}×`);
  notifyMotion();
};
window.setDirecao=value=>{
  const direction=Number(value);if(direction!==1&&direction!==-1)return;
  if(desktop)window.chibiNative?.movement({direction});else walker.face(direction);
};
window.piscar=()=>{state.blinkUntil=performance.now()+170;state.nextBlink=performance.now()+3000+Math.random()*3500;};
window.reagir=name=>{
  if(state.conversation!=='ociosa'&&name!=='wake')return;
  if(name!=='wake'&&!Object.hasOwn(DURATIONS,name))return;
  rememberPose();reactionAge=0;state.reactionProgress=0;
  if(name==='wake'){state.reaction='';state.sleep=false;state.nextBlink=performance.now()+1500;}
  else {stopSpeech();state.reaction=name;state.sleep=name==='sleep';}
  notifyMotion();
};
window.setEstadoConversa=name=>{
  if(!['ociosa','ouvindo','pensando','falando'].includes(name))return;
  conversationSeen=performance.now();
  if(name===state.conversation)return;
  stopSpeech();window.reagir('wake');
  state.conversation=name;state.expression=name;
  if(name==='pensando'){rememberPose();state.reaction='think';reactionAge=0;state.reactionProgress=.4;}
  notifyMotion();
};
window.avatarDebug=()=>({...state, width,height,frames:frames.length,reactionFrames:reactionFrames.length,walkFrames:walkFrames.length,
  audioPlaying:!voice.paused,audioTime:voice.currentTime,audioError,transition,phase,motion:{...motion},view:lastViewKey,rig:rig?.debug(),demoPhase});

window.setRigDemo=(value,syncMovement=true)=>{
  state.demo=Boolean(value);demoAge=0;demoPhase=state.demo?'walk':'rest';
  $('rig-demo')?.setAttribute('aria-pressed',String(state.demo));
  if($('rig-demo'))$('rig-demo').innerHTML=state.demo?'<span class="button-icon">Ⅱ</span> Pausar demonstração':'<span class="button-icon">▶</span> Reproduzir caminhada';
  if(syncMovement){window.setMovimento('wandering',state.demo);window.setMovimento('walking',state.demo);}
};
function updateDemo(dt){
  if(!state.demo||desktop)return;
  demoAge+=dt;
  if(demoPhase==='walk'&&demoAge>=3.4){window.setMovimento('walking',false);demoPhase='stop';demoAge=0;}
  if(demoPhase==='stop'&&motion.rig?.settled){demoPhase='rest';demoAge=0;}
  if(demoPhase==='rest'&&demoAge>=2.4){
    window.setDirecao(-motion.direction);window.setMovimento('wandering',true);demoPhase='walk';demoAge=0;
  }
}
for(const [id,key] of [['skeleton','skeleton'],['foot-locks','footLocks']])$(id)?.addEventListener('change',e=>{state[key]=e.target.checked;});
$('rig-demo')?.addEventListener('click',()=>window.setRigDemo(!state.demo));
$('natural-stop')?.addEventListener('click',()=>window.setRigDemo(false));

for(const name of ['breathing','blinking','walking','wandering','idleMotion','following'])$(name)?.addEventListener('change',e=>{
  if(state.demo&&['walking','wandering'].includes(name))window.setRigDemo(false,false);
  window.setMovimento(name,e.target.checked);
});
$('speed')?.addEventListener('input',e=>window.setVelocidade(e.target.value));
$('mouth').addEventListener('input',e=>window.setBoca(e.target.value));
$('blink').addEventListener('click',window.piscar);
for(const button of document.querySelectorAll('[data-reaction]'))button.addEventListener('click',()=>window.reagir(button.dataset.reaction));
for(const button of document.querySelectorAll('[data-direction]'))button.addEventListener('click',()=>{
  if(state.demo)window.setRigDemo(false,false);
  window.setDirecao(button.dataset.direction);
});
for(const button of document.querySelectorAll('[data-bg]'))button.addEventListener('click',()=>{
  stage.dataset.bg=button.dataset.bg;
  document.querySelectorAll('[data-bg]').forEach(b=>b.classList.toggle('active',b===button));
});

function stopSpeech(){
  speechRequest++;speechLoading=false;voice.pause();voice.currentTime=0;
  speechHoldUntil=0;
  window.setBoca(0);state.visibleMouth=0;state.expression='ociosa';
  $('speak').innerHTML='<span>▶</span> Ouvir o Yato <small>DEMO</small>';
}
window.falarDemo=async()=>{
  if(chat||state.conversation!=='ociosa')return;
  if(!voice.paused||speechLoading){stopSpeech();return;}
  window.reagir('wake');const request=++speechRequest;speechLoading=true;
  try{
    if(!envelope){const response=await fetch('assets/fala-demo.json');if(!response.ok)throw new Error('Envelope indisponível');envelope=await response.json();}
    if(request!==speechRequest)return;
    await voice.play();if(request!==speechRequest){voice.pause();return;}
    speechLoading=false;audioError=null;window.setExpressao('falando');
    $('speak').innerHTML='<span>■</span> Parar a fala <small>DEMO</small>';
  }catch(error){if(request!==speechRequest)return;audioError=error.message;stopSpeech();setText('audio-note','Áudio indisponível. Use o controle de boca para testar.');}
};
$('speak').addEventListener('click',window.falarDemo);
voice.addEventListener('ended',stopSpeech);
voice.addEventListener('error',()=>{audioError='Arquivo de áudio indisponível';stopSpeech();});
window.addEventListener('keydown',event=>{
  if(event.key==='Escape')window.chibiNative?.close();
  if(event.code==='Space'&&!['INPUT','BUTTON'].includes(event.target.tagName)){event.preventDefault();window.falarDemo();}
});
window.chibiNative?.onAction(action=>{
  if(action==='skeleton'||action==='foot-locks'){
    const key=action==='skeleton'?'skeleton':'footLocks';state[key]=!state[key];if($(action))$(action).checked=state[key];
  }else if(action==='speak')window.falarDemo();else if(action==='blink')window.piscar();
  else if(action==='left'||action==='right')window.setDirecao(action==='left'?-1:1);
  else if(action==='wake'||Object.hasOwn(DURATIONS,action))window.reagir(action);
  else window.setMovimento(action,!state[action]);
});
window.chibiNative?.onMotion(value=>{nativeMotion=value;});

// Eyes and mouth use separate masks, so a blink never erases a spoken syllable.
function patchFace(source,y,h,opacity=1){
  poseCtx.save();poseCtx.globalAlpha=opacity;
  poseCtx.drawImage(source,132,y,120,h,132,y,120,h);poseCtx.restore();
}
function drawPose(now,dt){
  const reacting=Boolean(state.reaction);
  // Keep one articulated body from rest through anticipation, walking and settling.
  // Speech/gestures take over only once both feet have landed.
  usingRig=Boolean(rig)&&(!motion.rig?.settled||(state.conversation==='ociosa'&&!reacting&&voice.paused&&state.mouth<=.05&&now>=speechHoldUntil));
  const key=usingRig?`rig-${motion.direction}`:reacting?state.reaction:'front';
  if(key!==lastViewKey){
    rememberPose((key.startsWith('rig-')||lastViewKey.startsWith('rig-'))?.1:.2);
    lastViewKey=key;
  }
  poseCtx.clearRect(0,0,384,560);
  if(usingRig)rig.draw(poseCtx,motion,{time:now,breathing:state.breathing,skeleton:state.skeleton,footLocks:state.footLocks});
  else poseCtx.drawImage(reacting?reactionFrames[REACTION_FRAME[state.reaction]]:frames[0],0,0);
  // Keep gestures' drawn expressions; speech remains available from the neutral pose.
  if(!reacting&&!usingRig){
    // A held closed-eye drawing avoids ghosted overlapping irises during a blink.
    if(state.blinkActive)patchFace(frames[1],108,28);
    if(state.visibleMouth>.045){
      const face=state.visibleMouth>.4?frames[3]:frames[2];
      patchFace(face,138,20,Math.min(1,state.visibleMouth/.12));
    }
  }
  if(transition<1&&transitionFrom){
    transition=Math.min(1,transition+dt/transitionDuration);
    const mix=smooth(transition);
    // Premultiplied crossfade: neither silhouette remains fully opaque behind
    // the other. The previous source-over blend visually inflated the head.
    poseCtx.save();poseCtx.globalCompositeOperation='destination-in';
    poseCtx.globalAlpha=mix;poseCtx.fillRect(0,0,384,560);
    poseCtx.globalCompositeOperation='lighter';poseCtx.globalAlpha=1-mix;
    poseCtx.drawImage(transitionFrom,0,0);poseCtx.restore();
  }
}
function render(now){
  const dt=Math.min((now-(lastTime||now))/1000,.05);lastTime=now;
  ctx.clearRect(0,0,width,height);
  if(state.ready){
    if(state.conversation!=='ociosa'&&now-conversationSeen>4500)window.setEstadoConversa('ociosa');
    if(!voice.paused&&envelope)window.setBoca(envelope.values[Math.floor(voice.currentTime*1000/envelope.ms)]||0);
    state.visibleMouth=damp(state.visibleMouth,state.mouth,state.mouth>state.visibleMouth?28:18,dt);
    if(state.sleep)state.visibleMouth=0;
    if(state.blinking&&!state.sleep&&now>state.nextBlink)window.piscar();
    state.blinkActive=now<state.blinkUntil;
    if(state.reaction){
      reactionAge+=dt*1000*state.speed;state.reactionProgress=state.sleep?0:Math.min(1,reactionAge/DURATIONS[state.reaction]);
      if(!state.sleep&&state.reactionProgress>=1&&state.conversation!=='pensando'){rememberPose();state.reaction='';state.reactionProgress=0;notifyMotion();}
    }
    notifyMotion();
    const h=targetHeight(), scale=h/512, baseline=desktop?height-12:height-65;
    state.bound=Math.max(0,width/2-h*.35);
    if(!desktop)walker.configure({scale});
    motion=desktop?nativeMotion:walker.step(dt,-state.bound,state.bound);
    updateDemo(dt);
    state.x=desktop?0:motion.x;state.direction=motion.direction;phase=motion.cycle*.9;
    state.frame=Math.min(5,Math.floor(motion.cycle*6));
    cursorLean=damp(cursorLean,state.following&&!state.sleep?cursorTarget:0,5,dt);
    const sway=state.idleMotion&&motion.pace<.025?Math.sin(now/1700)*.009:0;
    const breathe=state.breathing?Math.sin(now/(state.sleep?1050:730))*(state.sleep?.007:.0045):0;
    let tilt=sway+(motion.pace<.025?cursorLean*.018:0), lift=0;
    if(state.reaction==='wave')tilt+=Math.sin(reactionAge/160)*.022;
    if(state.reaction==='think')tilt+=Math.sin(Math.min(1,reactionAge/650)*Math.PI/2)*.026;
    if(state.reaction==='celebrate')lift+=Math.abs(Math.sin(reactionAge/170))*10*Math.sin(Math.PI*state.reactionProgress);
    if(state.sleep)tilt=Math.sin(now/2200)*.012;
    drawPose(now,dt);
    // Moving the whole canvas would slide planted feet and resize the head.
    // The rig applies breathing/weight to its torso while feet stay grounded.
    if(usingRig){tilt=0;lift=0;}
    ctx.save();ctx.translate(width/2+state.x,baseline-lift);ctx.rotate(tilt);ctx.scale(1,usingRig?1:1+breathe);
    ctx.drawImage(poseCanvas,-192*scale,-532*scale,384*scale,560*scale);ctx.restore();
    const gaitLabel={anticipating:'Preparando o passo',turning:'Mudando de direção',stopping:'Concluindo a passada',settling:'Acomodando o corpo'}[motion.mode];
    const mode=state.conversation!=='ociosa'?({ouvindo:'Ouvindo você',pensando:'Pensando',falando:'Falando com você'}[state.conversation]):state.reaction?({wave:'Acenando',think:'Pensando',celebrate:'Comemorando',sleep:'Cochilando'}[state.reaction]):(!voice.paused||state.mouth>.07)?'Falando':gaitLabel|| (motion.pace>.025?(motion.direction>0?'Caminhando →':'← Caminhando'):'Em repouso');
    setText('status',mode);
    setText('action-label',state.conversation==='ouvindo'?'Pode falar, estou ouvindo.':LABELS[state.reaction]||(!voice.paused||state.conversation==='falando'?'Uma voz. Um rosto.':state.effectiveWalking?'Um passo de cada vez.':'Presença tranquila.'));
    for(const button of document.querySelectorAll('[data-reaction]'))button.setAttribute('aria-pressed',String(button.dataset.reaction===state.reaction));
    for(const button of document.querySelectorAll('[data-direction]'))button.setAttribute('aria-pressed',String(Number(button.dataset.direction)===state.direction));
  }
  requestAnimationFrame(render);
}
function loaded(){
  if(state.ready)return;
  if(sheet.complete&&sheet.naturalWidth&&reactions.complete&&reactions.naturalWidth&&walkSheet.complete&&walkSheet.naturalWidth&&rigAtlas.complete&&rigAtlas.naturalWidth){
    frames=prepareFrames(sheet,4,2);reactionFrames=prepareFrames(reactions,2,2);walkFrames=prepareFrames(walkSheet,6,2,true);
    rig=new YatoRig(rigAtlas,walkFrames[2]);state.ready=true;resize();
  }
}
sheet.onload=reactions.onload=walkSheet.onload=rigAtlas.onload=loaded;
sheet.onerror=reactions.onerror=walkSheet.onerror=rigAtlas.onerror=()=>setText('status','Falha ao carregar a arte. Confira a pasta assets.');
sheet.src='assets/yato-chibi-sprites-v1.png';reactions.src='assets/yato-chibi-reacoes-v1.png';
walkSheet.src='assets/yato-caminhada-lateral-v1.png';
rigAtlas.src='assets/yato-rig-parts-v1.png';
requestAnimationFrame(render);
