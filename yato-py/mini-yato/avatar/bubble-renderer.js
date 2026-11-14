'use strict';
const bubble = document.getElementById('bubble');
const message = document.getElementById('message');
const previous = document.getElementById('previous');
const next = document.getElementById('next');
const pagination = document.getElementById('pagination');
let signature = '';
let expanded=false;
const expand=document.getElementById('expand');
function resize(){requestAnimationFrame(()=>{
  expand.hidden=bubble.classList.contains('quick')||(message.scrollHeight<=message.clientHeight+1&&!expanded);
  window.yatoBubble.size(Math.ceil(bubble.getBoundingClientRect().height+16));
});}
expand.addEventListener('click',()=>{
  expanded=!expanded;bubble.classList.toggle('expanded',expanded);
  expand.textContent=expanded?'Recolher ↑':'Ler tudo ↓';expand.setAttribute('aria-expanded',String(expanded));resize();
});
const input=document.getElementById('command-input'),form=document.getElementById('command-form');
window.yatoBubble.onState(view => {
  const nextSignature = JSON.stringify([view.fullText??view.text,view.kind]);
  if (signature !== nextSignature) { message.textContent = view.fullText??view.text; message.scrollTop = 0; signature = nextSignature;expanded=false;bubble.classList.remove('expanded');expand.textContent='Ler tudo ↓';expand.setAttribute('aria-expanded','false'); }
  bubble.dataset.side = view.side;
  bubble.classList.toggle('quick',Boolean(view.quick));
  bubble.style.setProperty('--tail-x',`${view.tailX||110}px`);
  document.getElementById('source-row').hidden=Boolean(view.quick)||!view.hasSource;
  document.getElementById('source-label').textContent=view.source?`${view.source} · ${view.updated}`:'';
  form.hidden=!view.editing||Boolean(view.quick);document.getElementById('compose').hidden=Boolean(view.editing)||Boolean(view.quick);
  input.disabled=Boolean(view.busy);document.getElementById('send-command').disabled=Boolean(view.busy);
  pagination.hidden = true;
  previous.disabled = view.page <= 1;
  next.disabled = view.page >= view.total;
  document.getElementById('page').textContent = `${view.page} / ${view.total}`;
  resize();
});
document.getElementById('close').addEventListener('click', () => window.yatoBubble.action('close'));
bubble.addEventListener('click',()=>{if(bubble.classList.contains('quick'))window.yatoBubble.action('close');});
previous.addEventListener('click', () => window.yatoBubble.action('previous'));
next.addEventListener('click', () => window.yatoBubble.action('next'));
window.addEventListener('keydown', event => { if(event.key === 'Escape')window.yatoBubble.action('close'); });
document.getElementById('compose').addEventListener('click',()=>window.yatoBubble.action('compose'));
document.getElementById('source').addEventListener('click',()=>window.yatoBubble.action('source'));
window.yatoBubble.onFocus(()=>requestAnimationFrame(()=>input.focus()));
form.addEventListener('submit',async event=>{
  event.preventDefault();const text=input.value.trim();if(!text||input.disabled)return;
  input.disabled=true;
  try{if(await window.yatoBubble.command(text))input.value='';}finally{input.disabled=false;if(!form.hidden)input.focus();}
});
window.yatoBubble.ready();
