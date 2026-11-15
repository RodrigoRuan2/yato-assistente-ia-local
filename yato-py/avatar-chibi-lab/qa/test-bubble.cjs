'use strict';
const assert = require('node:assert/strict');
const {BubbleModel, paginate, placement, PHRASES} = require('../bubble-model.cjs');
let checks = 0;
const step = (model, seconds, hover = false) => { for (let i=0;i<seconds;i++) model.tick(1, hover); };
{
  const text = 'Olá, <script>window.bad=true</script>! 🤖\n' + 'Uma resposta completa, com espaços. '.repeat(100) + '\nFim.';
  const pages = paginate(text);
  assert.equal(pages.join(''), text);
  assert.ok(pages.length > 1 && pages.every(page => Array.from(page).length <= 220));
  assert.equal(paginate('🙂'.repeat(221)).join(''), '🙂'.repeat(221));
  assert.deepEqual(paginate(''), []);
  checks++;
}
{
  const m = new BubbleModel({random:()=>0});
  m.setContext({conversation:'pensando'});
  assert.equal(m.view().kind, 'hint');
  assert.equal(m.setText('Resposta pronta.', 2), true);
  m.setContext({conversation:'pensando'});
  assert.equal(m.view().text, 'Resposta pronta.');
  assert.equal(m.setText('Resposta atrasada.', 1), false);
  assert.equal(m.setText('', 2), false);
  assert.equal(m.view().text, 'Resposta pronta.');
  m.setContext({conversation:'falando'});
  step(m, 300);
  assert.equal(m.view().text, 'Resposta pronta.');
  m.setContext({conversation:'ociosa'});
  step(m, 40, true);
  assert.equal(m.view().text, 'Resposta pronta.');
  step(m, 40);
  assert.equal(m.view().visible, false);
  assert.equal(m.revisit(), true);
  assert.equal(m.view().text, 'Resposta pronta.');
  m.setText('', 3);
  assert.equal(m.view().visible, false);
  assert.equal(m.revisit(), false);
  assert.equal('text' in m.snapshot(), false);
  checks++;
}
{
  const m = new BubbleModel({random:()=>0});
  m.setContext({conversation:'ouvindo'});
  m.dismiss();
  m.setContext({conversation:'ouvindo'});
  assert.equal(m.view().visible, false);
  m.setContext({conversation:'pensando'});
  assert.equal(m.view().kind, 'hint');
  m.setContext({conversation:'ociosa'});
  assert.equal(m.view().visible, false);
  m.setText('abcdef '.repeat(150), 1);
  const first = m.view();
  m.page(1);
  assert.equal(m.view().page, 2);
  m.page(-1);
  assert.deepEqual(m.view(), first);
  m.dismiss();
  assert.equal(m.view().visible, false);
  assert.equal(m.revisit(), true);
  checks++;
}
{
  const m = new BubbleModel({random:()=>0});
  step(m, 119);
  assert.equal(m.view().visible, false);
  m.setContext({moving:true});
  step(m, 5);
  assert.equal(m.view().visible, false);
  m.setContext({moving:false});
  step(m, 1);
  assert.equal(m.view().text, PHRASES[0]);
  m.setContext({blocked:true});
  step(m, 30, true);
  assert.equal(m.view().text, PHRASES[0]);
  m.setContext({blocked:false});
  m.dismiss();
  step(m, 120);
  assert.equal(m.view().text, PHRASES[1]);
  m.configure({occasionalPhrases:false});
  assert.equal(m.view().visible, false);
  step(m, 1000);
  assert.equal(m.view().visible, false);
  m.configure({occasionalPhrases:true});
  for (const context of [{sleep:true},{reaction:'wave'},{conversation:'pensando'},{blocked:true}]) {
    m.setContext({sleep:false,reaction:'',conversation:'ociosa',blocked:false,...context});
    step(m, 500);
    assert.notEqual(m.view().kind, 'ambient');
  }
  m.configure({bubblesEnabled:false});
  m.setText('Uma resposta silenciosa.', 1);
  assert.equal(m.view().visible, false);
  checks++;
}
{
  const area = {x:1920, y:0, width:1920, height:1040};
  for (const width of [150,225,300,375]) for (const height of [92,170,350]) {
    for (const x of [1920,2200,3000,3840-width]) for (const y of [0,500,1040-width*5/3]) {
      const parent = {x,y,width,height:Math.round(width*5/3)};
      const b = placement(parent, area, {width:322,height});
      assert.ok(b.x >= area.x && b.y >= area.y && b.x+b.width <= area.x+area.width && b.y+b.height <= area.y+area.height);
      const head = {left:x+width*.28,right:x+width*.72};
      assert.ok(b.x+b.width <= head.left || b.x >= head.right);
    }
  }
  checks++;
}
console.log(JSON.stringify({ok:true, checks, covers:['Unicode pagination without text loss','late replies and state precedence','speech/hover lifetime','dismiss/revisit/clear','occasional phrase timing and interruptions','placement at edges and sizes']}));
