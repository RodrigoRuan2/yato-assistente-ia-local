'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PERCENT = 75;
const OPTIONS = [
  {percent:50, label:'Mini — 50%'},
  {percent:75, label:'Pequeno — 75%'},
  {percent:100, label:'Original — 100%'},
  {percent:125, label:'Grande — 125%'},
];
const validPercent = value => Number.isInteger(value) && value >= 50 && value <= 125;
function dimensions(percent) {
  if (!validPercent(percent)) throw new RangeError('Tamanho deve ficar entre 50 e 125%.');
  return {width:Math.round(300*percent/100), height:Math.round(500*percent/100)};
}
function resizeBounds(current, work, percent) {
  const desired = dimensions(percent);
  const fit = Math.min(1, work.width/desired.width, work.height/desired.height);
  const width = Math.round(desired.width*fit), height = Math.round(desired.height*fit);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  return {
    x:clamp(Math.round(current.x+current.width/2-width/2), work.x, work.x+work.width-width),
    y:clamp(current.y+current.height-height, work.y, work.y+work.height-height),
    width, height,
  };
}
function readSettings(file) {
  try {
    const value=JSON.parse(fs.readFileSync(file,'utf8'));
    return value && typeof value==='object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
function readPercent(file) {
  const value=readSettings(file).sizePercent;
  return validPercent(value) ? value : DEFAULT_PERCENT;
}
function savePercent(file, percent) {
  if (!validPercent(percent)) throw new RangeError('Tamanho inválido.');
  saveSettings(file,{sizePercent:percent});
}
function saveSettings(file, values) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary,JSON.stringify({...readSettings(file),...values},null,2)+'\n');
    fs.renameSync(temporary,file);
  } finally { if(fs.existsSync(temporary))fs.unlinkSync(temporary); }
}
module.exports={DEFAULT_PERCENT,OPTIONS,validPercent,dimensions,resizeBounds,readPercent,savePercent,readSettings,saveSettings};
