'use strict';

// Shared by the experimental host and renderer QA. A requested monitor must be
// resolved before any BrowserWindow is created, including hidden test windows.
function inventory(screen) {
  const primary=screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map(display=>({id:display.id,label:display.label,
    bounds:display.bounds,workArea:display.workArea,scaleFactor:display.scaleFactor,
    primary:display.id===primary}));
}

function selectDisplay(screen,args=process.argv) {
  const displays=screen.getAllDisplays(),primary=screen.getPrimaryDisplay().id;
  const monitor=args.find(arg=>arg.startsWith('--monitor='))?.split('=')[1]??'2';
  const explicitId=args.find(arg=>arg.startsWith('--display-id='))?.split('=')[1];
  if(explicitId!==undefined) {
    const display=displays.find(item=>String(item.id)===explicitId);
    if(!display)throw new Error(`Display solicitado não está conectado: ${explicitId}`);
    return display;
  }
  if(monitor==='1')return screen.getPrimaryDisplay();
  if(monitor!=='2')throw new Error('Use --monitor=1 ou --monitor=2.');
  // Electron does not expose the Windows numbered display identity. With two
  // displays the single secondary display is unambiguous; never use array order.
  if(displays.length!==2)throw new Error('Monitor 2 não pode ser identificado: conecte exatamente duas telas ou informe --display-id após conferir o inventário.');
  const secondary=displays.filter(display=>display.id!==primary);
  if(secondary.length!==1)throw new Error('Monitor secundário não identificado; nenhuma janela foi aberta.');
  return secondary[0];
}

function constrainBounds(bounds,area) {
  const width=Math.min(bounds.width,area.width),height=Math.min(bounds.height,area.height);
  return {x:Math.round(Math.max(area.x,Math.min(area.x+area.width-width,bounds.x))),
    y:Math.round(Math.max(area.y,Math.min(area.y+area.height-height,bounds.y))),
    width:Math.round(width),height:Math.round(height)};
}

function windowBounds(display,size,{desktop=false}={}) {
  const area=display.workArea;
  const width=Math.min(size.width,Math.max(1,area.width-32));
  const height=Math.min(size.height,Math.max(1,area.height-32));
  return constrainBounds({width,height,
    x:desktop?area.x+area.width-width-24:area.x+(area.width-width)/2,
    y:desktop?area.y+area.height-height-16:area.y+(area.height-height)/2},area);
}

function contains(display,bounds) {
  const area=display.workArea;
  return bounds.x>=area.x&&bounds.y>=area.y&&bounds.x+bounds.width<=area.x+area.width&&bounds.y+bounds.height<=area.y+area.height;
}

module.exports={inventory,selectDisplay,windowBounds,constrainBounds,contains};

if(require.main===module||process.argv.some(arg=>require('node:path').resolve(arg)===__filename)) {
  const {app,screen}=require('electron');
  app.whenReady().then(()=>{
    const displays=inventory(screen);
    let target=null,error=null;
    try{target=selectDisplay(screen).id;}catch(problem){error=problem.message;}
    console.log(JSON.stringify({displays,target,error},null,2));app.quit();
  }).catch(error=>{console.error(error);app.exit(1);});
}
