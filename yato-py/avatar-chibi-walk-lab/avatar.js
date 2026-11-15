/* Sprite refinement in a separate copy. Approved art and prior labs are intact. */
'use strict';
const desktop = new URLSearchParams(location.search).has('desktop');
const chat = new URLSearchParams(location.search).has('chat');
document.documentElement.classList.toggle('desktop', desktop);
const canvas = document.getElementById('avatar'), ctx = canvas.getContext('2d');
const stage = document.getElementById('stage'), voice = document.getElementById('voice');
const sheet = new Image(), reactions = new Image(), walkSheet = new Image(), cycleSheet=new Image(), armSheet=new Image(), idleSheet=new Image();
const walker = new YatoMotion();
let nativeMotion = walker.snapshot(), motion = walker.snapshot(), lastViewKey = '';
const DURATIONS = { wave:2400, think:3000, celebrate:1700, sleep:Infinity };
const REACTION_FRAME = { wave:0, think:1, celebrate:2, sleep:3 };
const LABELS = { wave:'Ei, estou por aqui.', think:'Deixa eu pensar…', celebrate:'Essa foi boa!', sleep:'Só um cochilo…' };
const state = { ready:false, breathing:true, blinking:true, walking:false, wandering:false,
  idleMotion:true, following:true, mouth:0, visibleMouth:0, expression:'ociosa',
  blinkActive:false, blinkUntil:0, nextBlink:performance.now()+2200, x:0, direction:1,
  frame:0, speed:1, reaction:'', reactionProgress:0, sleep:false, effectiveWalking:false, bound:0,
  conversation:'ociosa',refined:true,demo:false,effects:false,idleGestures:true,idleDemo:false };
const idle=new YatoIdle();
let idleState=idle.snapshot(),idleAvailable=false,pendingIdle='';
const IDLE_LABELS={weight:'Mudando o apoio',sleeve:'Ajeitando a manga',pocket:'Mão no bolso',look:'Observando ao redor'};
const effects=new YatoEffects();
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let demoAge=0,demoPhase='rest';
let conversationSeen=0;
let frames=[], reactionFrames=[], walkFrames=[], cycleFrames=[], cycleRestFrames=[], approvedCycleFrames=[], approvedRestFrames=[], idleFrames=[], envelope=null, width=0, height=0, lastTime=0;
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
    const referenceHeight=lateral===true?heights[Math.floor(heights.length/2)]:bottom-top;
    const normalized=document.createElement('canvas');normalized.width=384;normalized.height=560;
    const nc=normalized.getContext('2d'), scale=512/Math.max(1,referenceHeight);
    if(lateral) {
      // The lateral sheet is drawn with a head 25% larger relative to its body.
      // Match the approved frontal head, keeping the crown and soles anchored.
      // Sample the original once; blend the width correction through the hood.
      let headFactor=lateral==='cycle'?Math.max(.6,Math.min(1.1,140/((headRight-headLeft+1)*scale))):.8;
      const renderNormalized=()=>{
        const headScale=scale*headFactor, neck=top+referenceHeight*.34;
        const crown=532-(bottom-top)*scale, neckY=crown+(neck-top)*headScale;
        const bodyScale=(532-neckY)/(bottom-neck), center=(headLeft+headRight)/2;
        nc.clearRect(0,0,384,560);nc.imageSmoothingQuality='high';
        for(let y=0;y<560;y++) {
          const sy=y<neckY?top+(y-crown)/headScale:neck+(y-neckY)/bodyScale;
          const sh=y<neckY?1/headScale:1/bodyScale;
          const blend=smooth(Math.max(0,Math.min(1,(sy-neck)/(referenceHeight*.14))));
          const sx=scale*(headFactor+(1-headFactor)*blend);
          // Avoid sampling the neighbouring row of the source sprite sheet.
          if(sy<0||sy+sh>ch)continue;
          nc.drawImage(image,ox,oy+sy,cw,sh,192-center*sx,y,cw*sx,1);
        }
      };
      renderNormalized();
      if(lateral==='cycle'){
        // Include the whole hair silhouette, not just the crown. Match the
        // original 137–141 px heads without rescaling an already-rendered pose.
        const pixels=nc.getImageData(0,20,384,140).data;
        let left=384,right=0;
        for(let y=0;y<140;y++)for(let x=0;x<384;x++)if(pixels[(y*384+x)*4+3]>180){left=Math.min(left,x);right=Math.max(right,x);}
        headFactor*=139/Math.max(1,right-left+1);renderNormalized();
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
  if(desktop&&['walking','wandering'].includes(name)){
    state.walking=state.wandering=Boolean(value);
    if($('walking'))$('walking').checked=state.walking;
    if($('wandering'))$('wandering').checked=state.wandering;
  }
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
  cycleFrames:cycleFrames.length,cycleRestFrames:cycleRestFrames.length,framesPerDirection:8,
  walkSource:state.refined?'arm-cycle-v3':'coherent-cycle-v2',demoPhase,effectState:effects.snapshot(),idle:idleState,idleAvailable,idleFrames:idleFrames.length,
  audioPlaying:!voice.paused,audioTime:voice.currentTime,audioError,transition,phase,motion:{...motion},view:lastViewKey});

window.setRefined=value=>{
  rememberPose();state.refined=Boolean(value);if($('refined'))$('refined').checked=state.refined;
};
window.setEffects=value=>{
  state.effects=Boolean(value);effects.reset();
  if($('effects'))$('effects').checked=state.effects;
};
window.materializar=()=>{if(!state.effects)window.setEffects(true);effects.triggerMaterialize();};
window.setIdleGestures=value=>{
  state.idleGestures=Boolean(value);idle.configure({enabled:state.idleGestures});
  if(!state.idleGestures){pendingIdle='';state.idleDemo=false;idle.configure({showcase:false});idle.cancel();}
  if($('idle-gestures'))$('idle-gestures').checked=state.idleGestures;
  $('idle-demo')?.setAttribute('aria-pressed',String(state.idleDemo));
  if(!state.idleDemo&&$('idle-demo'))$('idle-demo').textContent='Demonstrar movimentos de repouso';
};
window.setIdleDemo=value=>{
  state.idleDemo=Boolean(value);pendingIdle='';
  if(state.idleDemo){window.setWalkDemo(false);window.setIdleGestures(true);}
  idle.cancel();idle.configure({showcase:state.idleDemo});
  $('idle-demo')?.setAttribute('aria-pressed',String(state.idleDemo));
  if($('idle-demo'))$('idle-demo').textContent=state.idleDemo?'Voltar aos intervalos naturais':'Demonstrar movimentos de repouso';
};
window.playIdleGesture=kind=>{
  if(!Object.hasOwn(IDLE_LABELS,kind))return;
  window.setIdleDemo(false);window.setWalkDemo(false);window.setIdleGestures(true);pendingIdle=kind;
};
window.setWalkDemo=(value,syncMovement=true)=>{
  if(value&&state.idleDemo)window.setIdleDemo(false);
  state.demo=Boolean(value);demoAge=0;demoPhase=state.demo?'walk':'rest';
  $('walk-demo')?.setAttribute('aria-pressed',String(state.demo));
  if($('walk-demo'))$('walk-demo').innerHTML=state.demo?'<span class="button-icon">Ⅱ</span> Pausar demonstração':'<span class="button-icon">▶</span> Reproduzir caminhada';
  if(syncMovement){window.setMovimento('wandering',state.demo);window.setMovimento('walking',state.demo);}
};
function updateDemo(dt){
  if(!state.demo||desktop)return;
  if(state.conversation!=='ociosa'||state.reaction||!voice.paused||state.mouth>.05)return;
  demoAge+=dt;
  if(demoPhase==='walk'&&demoAge>=3.5){window.setMovimento('walking',false);demoPhase='stop';demoAge=0;}
  if(demoPhase==='stop'&&motion.mode==='idle'){demoPhase='rest';demoAge=0;}
  if(demoPhase==='rest'&&demoAge>=2.5){window.setDirecao(-motion.direction);window.setMovimento('wandering',true);demoPhase='walk';demoAge=0;}
}
$('refined')?.addEventListener('change',e=>window.setRefined(e.target.checked));
$('effects')?.addEventListener('change',e=>window.setEffects(e.target.checked));
$('materialize')?.addEventListener('click',()=>window.materializar());
$('idle-gestures')?.addEventListener('change',e=>window.setIdleGestures(e.target.checked));
$('idle-demo')?.addEventListener('click',()=>window.setIdleDemo(!state.idleDemo));
for(const button of document.querySelectorAll('[data-idle]'))button.addEventListener('click',()=>window.playIdleGesture(button.dataset.idle));
$('walk-demo')?.addEventListener('click',()=>window.setWalkDemo(!state.demo));
$('natural-stop')?.addEventListener('click',()=>window.setWalkDemo(false));

for(const name of ['breathing','blinking','walking','wandering','idleMotion','following'])$(name)?.addEventListener('change',e=>{
  if(state.demo&&['walking','wandering'].includes(name))window.setWalkDemo(false,false);
  window.setMovimento(name,e.target.checked);
});
$('speed')?.addEventListener('input',e=>window.setVelocidade(e.target.value));
$('mouth').addEventListener('input',e=>window.setBoca(e.target.value));
$('blink').addEventListener('click',window.piscar);
for(const button of document.querySelectorAll('[data-reaction]'))button.addEventListener('click',()=>window.reagir(button.dataset.reaction));
for(const button of document.querySelectorAll('[data-direction]'))button.addEventListener('click',()=>{
  if(state.demo)window.setWalkDemo(false,false);window.setDirecao(button.dataset.direction);
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
  if(action==='speak')window.falarDemo();else if(action==='blink')window.piscar();
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
  const staged=['anticipating','settling'].includes(motion.mode);
  const stride=['starting','walking','stopping'].includes(motion.mode);
  const sideways=state.conversation==='ociosa'&&!reacting&&voice.paused&&state.mouth<=.05&&now>=speechHoldUntil&&(stride||staged)&&motion.mode!=='turning';
  const stepKind=staged?motion.mode:'walk';
  const idling=idleAvailable&&state.idleGestures;
  const key=reacting?state.reaction:sideways?`${stepKind}-${motion.direction}`:idling?'quiet':state.idleGestures?'neutral':'front';
  if(key!==lastViewKey){
    // A short profile transition avoids lingering double faces when turning.
    rememberPose((sideways||lastViewKey.includes('walk-'))?.1:.2);
    lastViewKey=key;
  }
  poseCtx.clearRect(0,0,384,560);
  // Rest and speech share the same neutral body while the idle experiment is
  // enabled; returning to talk must not switch the clothing's palette.
  let body=state.idleGestures?idleFrames[0]:frames[0];
  if(reacting)body=reactionFrames[REACTION_FRAME[state.reaction]];
  else if(sideways){
    const row=motion.direction<0?1:0;
    if(staged)body=(state.refined?cycleRestFrames:approvedRestFrames)[row];
    else body=(state.refined?cycleFrames:approvedCycleFrames)[row*8+state.frame];
  }
  if(idling){
    const {frameA,frameB,mix}=idleState;
    if(frameA===frameB)poseCtx.drawImage(idleFrames[frameA],0,0);
    else {
      // Weighted premultiplied blend keeps opacity constant through small
      // posture changes. Never stack two fully opaque silhouettes.
      poseCtx.save();poseCtx.globalAlpha=1-mix;poseCtx.drawImage(idleFrames[frameA],0,0);
      poseCtx.globalCompositeOperation='lighter';poseCtx.globalAlpha=mix;poseCtx.drawImage(idleFrames[frameB],0,0);poseCtx.restore();
    }
  } else poseCtx.drawImage(body,0,0);
  // Keep gestures' drawn expressions; speech remains available from the neutral pose.
  if(!reacting&&!sideways){
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
    motion=desktop?nativeMotion:walker.step(dt,-state.bound,state.bound);
    updateDemo(dt);
    const quietContext=state.conversation==='ociosa'&&!state.reaction&&!state.sleep&&voice.paused&&state.mouth<=.05&&state.visibleMouth<=.05&&now>=speechHoldUntil;
    idleAvailable=quietContext&&motion.mode==='idle'&&!state.walking;
    if(!quietContext||!state.idleGestures)pendingIdle='';
    if(pendingIdle&&idleAvailable){idle.request(pendingIdle);pendingIdle='';}
    idleState=idle.step(dt,{available:idleAvailable,reducedMotion:reducedMotion.matches});
    state.x=desktop?0:motion.x;state.direction=motion.direction;phase=motion.cycle*.9;
    const count=8;state.frame=Math.min(count-1,Math.floor(motion.cycle*count));
    cursorLean=damp(cursorLean,state.following&&!state.sleep?cursorTarget:0,5,dt);
    const sway=state.idleMotion&&motion.pace<.025&&!idleState.active?Math.sin(now/1700)*.009:0;
    const breathe=state.breathing&&motion.pace<=.025?Math.sin(now/(state.sleep?1050:730))*(state.sleep?.007:.0045):0;
    let tilt=sway+(motion.pace<.025?cursorLean*.018:0), lift=0;
    if(motion.pace>.025)tilt+=Math.sin(motion.cycle*Math.PI*2)*.0025*Math.min(1,motion.pace);
    if(state.reaction==='wave')tilt+=Math.sin(reactionAge/160)*.022;
    if(state.reaction==='think')tilt+=Math.sin(Math.min(1,reactionAge/650)*Math.PI/2)*.026;
    if(state.reaction==='celebrate')lift+=Math.abs(Math.sin(reactionAge/170))*10*Math.sin(Math.PI*state.reactionProgress);
    if(state.sleep)tilt=Math.sin(now/2200)*.012;
    drawPose(now,dt);
    ctx.save();ctx.translate(width/2+state.x,baseline-lift);ctx.rotate(tilt);ctx.scale(1,1+breathe);
    effects.render(ctx,poseCanvas,-192*scale,-532*scale,scale,dt,{enabled:state.effects,reducedMotion:reducedMotion.matches,
      walking:motion.pace>.025,speaking:state.visibleMouth>.05,
      poseKey:transition<1||idleState.active?undefined:[state.refined,lastViewKey,state.frame,state.blinkActive,state.visibleMouth>.4,state.visibleMouth>.045,state.reaction].join(':')});
    ctx.drawImage(poseCanvas,-192*scale,-532*scale,384*scale,560*scale);ctx.restore();
    const motionLabel={anticipating:'Preparando o passo',settling:'Acomodando o corpo',turning:'Virando',stopping:'Concluindo a passada'}[motion.mode];
    const mode=state.conversation!=='ociosa'?({ouvindo:'Ouvindo você',pensando:'Pensando',falando:'Falando com você'}[state.conversation]):state.reaction?({wave:'Acenando',think:'Pensando',celebrate:'Comemorando',sleep:'Cochilando'}[state.reaction]):(!voice.paused||state.mouth>.07)?'Falando':motionLabel|| (motion.pace>.025?(motion.direction>0?'Caminhando →':'← Caminhando'):IDLE_LABELS[idleState.kind]||'Em repouso');
    setText('status',mode);
    setText('action-label',state.conversation==='ouvindo'?'Pode falar, estou ouvindo.':LABELS[state.reaction]||(!voice.paused||state.conversation==='falando'?'Uma voz. Um rosto.':state.effectiveWalking?'Um passo de cada vez.':IDLE_LABELS[idleState.kind]||'Presença tranquila.'));
    for(const button of document.querySelectorAll('[data-idle]'))button.setAttribute('aria-pressed',String(idleState.kind===button.dataset.idle));
    for(const button of document.querySelectorAll('[data-reaction]'))button.setAttribute('aria-pressed',String(button.dataset.reaction===state.reaction));
    for(const button of document.querySelectorAll('[data-direction]'))button.setAttribute('aria-pressed',String(Number(button.dataset.direction)===state.direction));
  }
  requestAnimationFrame(render);
}
function loaded(){
  if(state.ready)return;
  if(sheet.complete&&sheet.naturalWidth&&reactions.complete&&reactions.naturalWidth&&walkSheet.complete&&walkSheet.naturalWidth&&cycleSheet.complete&&cycleSheet.naturalWidth&&armSheet.complete&&armSheet.naturalWidth&&idleSheet.complete&&idleSheet.naturalWidth){
    frames=prepareFrames(sheet,4,2);reactionFrames=prepareFrames(reactions,2,2);walkFrames=prepareFrames(walkSheet,6,2,true);
    const poses=prepareFrames(armSheet,3,3,'cycle'), approved=prepareFrames(cycleSheet,3,3,'cycle');
    const mirror=frame=>{const result=document.createElement('canvas');result.width=384;result.height=560;
      const g=result.getContext('2d');g.translate(384,0);g.scale(-1,1);g.drawImage(frame,0,0);return result;};
    // A complete cycle uses one palette and one continuous sequence. Never
    // alternate original and redrawn sprites. Mirroring preserves gait/colors.
    cycleFrames=poses.slice(0,8).concat(poses.slice(0,8).map(mirror));
    cycleRestFrames=[poses[8],mirror(poses[8])];
    approvedCycleFrames=approved.slice(0,8).concat(approved.slice(0,8).map(mirror));
    approvedRestFrames=[approved[8],mirror(approved[8])];
    idleFrames=prepareFrames(idleSheet,3,3);
    state.ready=true;resize();
    if(new URLSearchParams(location.search).has('effects'))window.setEffects(true);
    if(!desktop&&new URLSearchParams(location.search).has('demo'))window.setWalkDemo(true);
    if(!desktop&&new URLSearchParams(location.search).has('idle-demo'))window.setIdleDemo(true);
  }
}
sheet.onload=reactions.onload=walkSheet.onload=cycleSheet.onload=armSheet.onload=idleSheet.onload=loaded;
sheet.onerror=reactions.onerror=walkSheet.onerror=cycleSheet.onerror=armSheet.onerror=idleSheet.onerror=()=>setText('status','Falha ao carregar a arte. Confira a pasta assets.');
sheet.src='assets/yato-chibi-sprites-v1.png';reactions.src='assets/yato-chibi-reacoes-v1.png';
walkSheet.src='assets/yato-caminhada-lateral-v1.png';
cycleSheet.src='assets/yato-caminhada-ciclo-v2.png';
armSheet.src='assets/yato-caminhada-bracos-v3.png';
idleSheet.src='assets/yato-repouso-v1.png';
requestAnimationFrame(render);
