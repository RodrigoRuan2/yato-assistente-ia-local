/* Prévia independente. Mesmo contrato visual do avatar existente: setBoca e setExpressao. */
'use strict';
const desktop = new URLSearchParams(location.search).has('desktop');
document.documentElement.classList.toggle('desktop', desktop);
const canvas = document.getElementById('avatar');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const voice = document.getElementById('voice');
const sheet = new Image();
const state = { ready: false, breathing: true, blinking: true, walking: false,
  wandering: false, mouth: 0, expression: 'ociosa', blinkUntil: 0,
  nextBlink: performance.now() + 2200, x: 0, direction: 1, frame: 0 };
let frames = [], envelope = null, width = 0, height = 0, lastTime = 0;
let audioError = null;
const status = text => { document.getElementById('status').textContent = text; };

// Alpha bounds are measured in memory, without modifying the original PNG.
function readFrames() {
  const temp = document.createElement('canvas');
  temp.width = sheet.width; temp.height = sheet.height;
  const tc = temp.getContext('2d', { willReadFrequently: true });
  tc.drawImage(sheet, 0, 0);
  const pixels = tc.getImageData(0, 0, sheet.width, sheet.height).data;
  const cw = sheet.width / 4, ch = sheet.height / 2;
  for (let n = 0; n < 8; n++) {
    const ox = (n % 4) * cw, oy = Math.floor(n / 4) * ch;
    let x0 = cw, y0 = ch, x1 = 0, y1 = 0;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      if (pixels[((oy + y) * sheet.width + ox + x) * 4 + 3] > 180) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y);
        x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    frames.push({ x: ox, y: oy, w: cw, h: ch, center: (x0 + x1) / 2, top: y0, bottom: y1 });
  }
}

function resize() {
  const r = stage.getBoundingClientRect(); width = r.width; height = r.height;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
new ResizeObserver(resize).observe(stage);

window.setBoca = value => {
  const n = Number(value);
  state.mouth = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
  document.getElementById('mouth').value = state.mouth;
  document.getElementById('mouth-value').value = `${Math.round(state.mouth * 100)}%`;
};
window.setExpressao = name => {
  if (!['ociosa', 'pensando', 'falando', 'feliz'].includes(name)) return;
  state.expression = name;
  document.getElementById('action-label').textContent = {
    ociosa: 'Presença tranquila.', pensando: 'Pensando com você.',
    falando: 'Uma voz. Um rosto.', feliz: 'Bom ter você por aqui.'
  }[name];
};
window.setMovimento = (name, value) => {
  if (!['breathing', 'blinking', 'walking', 'wandering'].includes(name)) return;
  state[name] = Boolean(value);
  document.getElementById(name).checked = state[name];
  if (name === 'wandering' && value) window.setMovimento('walking', true);
  if (name === 'walking' && !value) window.setMovimento('wandering', false);
  if (name === 'wandering' && !value) state.x = 0;
  window.chibiNative?.movement({ walking: state.walking, wandering: state.wandering });
};
window.piscar = () => { state.blinkUntil = performance.now() + 145; };
window.avatarDebug = () => ({ ...state, width, height, frames: frames.length,
  audioPlaying: !voice.paused, audioTime: voice.currentTime, audioError });

for (const name of ['breathing','blinking','walking','wandering']) {
  document.getElementById(name).addEventListener('change', e => window.setMovimento(name, e.target.checked));
}
document.getElementById('mouth').addEventListener('input', e => window.setBoca(e.target.value));
document.getElementById('blink').addEventListener('click', window.piscar);
for (const button of document.querySelectorAll('[data-bg]')) button.addEventListener('click', () => {
  stage.dataset.bg = button.dataset.bg;
  document.querySelectorAll('[data-bg]').forEach(b => b.classList.toggle('active', b === button));
});

function endSpeech() {
  voice.pause(); voice.currentTime = 0; window.setBoca(0); window.setExpressao('ociosa');
  document.getElementById('speak').innerHTML = '<span>▶</span> Ouvir o Yato <small>DEMO</small>';
}
window.falarDemo = async () => {
  if (!voice.paused) { endSpeech(); return; }
  try {
    if (!envelope) {
      const response = await fetch('assets/fala-demo.json');
      if (!response.ok) throw new Error('Envelope de áudio indisponível');
      envelope = await response.json();
    }
    await voice.play(); audioError = null; window.setExpressao('falando');
    document.getElementById('speak').innerHTML = '<span>■</span> Parar a fala <small>DEMO</small>';
  } catch (error) {
    audioError = error.message; endSpeech();
    document.getElementById('audio-note').textContent = 'Não foi possível tocar a voz. Use o controle de boca para testar.';
  }
};
document.getElementById('speak').addEventListener('click', window.falarDemo);
voice.addEventListener('ended', endSpeech);
voice.addEventListener('error', () => { audioError = 'Arquivo de áudio indisponível'; endSpeech(); });
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.chibiNative?.close();
  if (event.code === 'Space' && !['INPUT','BUTTON'].includes(event.target.tagName)) {
    event.preventDefault(); window.falarDemo();
  }
});
window.chibiNative?.onAction(action => {
  if (action === 'speak') window.falarDemo();
  else if (action === 'blink') window.piscar();
  else window.setMovimento(action, !state[action]);
});

function drawFrame(index, scale, baseline, center, clipHead = false) {
  const f = frames[index];
  const dx = center - f.center * scale, dy = baseline - f.bottom * scale;
  ctx.save();
  if (clipHead) {
    const faceHeight = (f.bottom - f.top) * .265;
    ctx.beginPath(); ctx.rect(0, 0, width, dy + (f.top + faceHeight) * scale); ctx.clip();
  }
  ctx.drawImage(sheet, f.x, f.y, f.w, f.h, dx, dy, f.w * scale, f.h * scale);
  ctx.restore();
}

function render(now) {
  const dt = Math.min((now - (lastTime || now)) / 1000, .05); lastTime = now;
  ctx.clearRect(0, 0, width, height);
  if (state.ready) {
    if (!voice.paused && envelope) {
      const index = Math.floor(voice.currentTime * 1000 / envelope.ms);
      window.setBoca(envelope.values[index] || 0);
    }
    if (state.blinking && now > state.nextBlink) {
      window.piscar(); state.nextBlink = now + 2800 + Math.random() * 3400;
    }
    const blink = now < state.blinkUntil;
    const base = frames[0];
    const targetHeight = desktop ? height * .94 : Math.min(height * .79, 440);
    const breathing = state.breathing ? Math.sin(now / 650) * .0045 : 0;
    const scale = targetHeight / (base.bottom - base.top);
    const baseline = desktop ? height - 7 : height - 66;
    const bound = Math.max(0, width / 2 - targetHeight * .3);
    if (state.wandering && !desktop) {
      state.x += dt * 30 * state.direction;
      if (Math.abs(state.x) >= bound) { state.x = Math.sign(state.x) * bound; state.direction *= -1; }
    }
    let frame = state.walking ? 4 + Math.floor(now / 175) % 4 : 0;
    state.frame = frame;
    const center = width / 2 + state.x;
    const bob = state.walking ? Math.abs(Math.sin(now / 350 * Math.PI)) * 2 : 0;
    ctx.save(); ctx.translate(0, baseline); ctx.scale(1, 1 + breathing); ctx.translate(0, -baseline);
    // Only replace the head during speech/blinks, so the clothing stays still.
    const face = blink ? 1 : state.mouth > .42 ? 3 : state.mouth > .07 ? 2 : 0;
    if (face && !state.walking) {
      const split = baseline - targetHeight * .735;
      ctx.save(); ctx.beginPath(); ctx.rect(0, split, width, height - split); ctx.clip();
      drawFrame(0, scale, baseline, center); ctx.restore();
      drawFrame(face, scale, baseline, center, true);
    } else {
      drawFrame(frame, scale, baseline - bob, center);
      if (face) drawFrame(face, scale, baseline - bob, center, true);
    }
    ctx.restore();
    status(!voice.paused || state.mouth > .07 ? 'Falando' : state.walking ? 'Caminhando' : 'Respirando · em repouso');
  }
  requestAnimationFrame(render);
}
sheet.onload = () => { readFrames(); state.ready = true; resize(); status('Pronto'); };
sheet.onerror = () => { status('Falha ao carregar a arte. Confira a pasta assets.'); };
sheet.src = 'assets/yato-chibi-sprites-v1.png';
requestAnimationFrame(render);
