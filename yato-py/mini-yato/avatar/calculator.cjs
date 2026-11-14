'use strict';
// Small arithmetic grammar; never evaluates JavaScript or invokes a shell.
function calculate(input){
  let s=input.replace(/^(?:(?:quanto (?:e|da|fica)|calcula|calcule|calcular|resolve|resolva)(?: a conta)?\s*)/,'')
    .replace(/dividido por/g,'/').replace(/multiplicado por|vezes/g,'*').replace(/mais/g,'+').replace(/menos/g,'-')
    .replace(/elevado a/g,'^').replace(/por cento/g,'%').replace(/,/g,'.').replace(/×|\bx\b/g,'*').replace(/÷/g,'/');
  const percent=s.match(/^\s*([+-]?\d+(?:\.\d+)?)\s*%\s*de\s*([+-]?\d+(?:\.\d+)?)\s*$/);
  if(percent)s=`(${percent[1]}/100)*(${percent[2]})`;
  if(!/^[\d\s.+*/()^%\-]+$/.test(s)||!/[\d]/.test(s))return null;
  const tokens=s.match(/\d+(?:\.\d+)?|[()+*/^%\-]/g)||[];
  if(tokens.join('')!==s.replace(/\s/g,''))return {error:'Não entendi esse número. Use, por exemplo, 12,5 + 3.'};
  let pos=0,depth=0;
  function primary(){
    if(++depth>40)throw Error('Conta muito longa.');
    let n;
    if(tokens[pos]==='('){pos++;n=sum();if(tokens[pos++]!==')')throw Error('Confira os parênteses.');}
    else {const t=tokens[pos++];if(!/^\d/.test(t||''))throw Error('Confira os números e operadores.');n=Number(t);}
    if(tokens[pos]==='%'){pos++;n/=100;}
    depth--;return n;
  }
  function unary(){if(tokens[pos]==='+'||tokens[pos]==='-'){const sign=tokens[pos++];if(++depth>40)throw Error('Conta muito longa.');const n=unary();depth--;return sign==='-'?-n:n;}return power();}
  function power(){let n=primary();if(tokens[pos]==='^'){pos++;n=n**unary();}return n;}
  function product(){let n=unary();while(['*','/'].includes(tokens[pos])){const op=tokens[pos++],v=unary();if(op==='/'&&v===0)throw Error('Não dá para dividir por zero.');n=op==='*'?n*v:n/v;}return n;}
  function sum(){let n=product();while(['+','-'].includes(tokens[pos])){const op=tokens[pos++],v=product();n=op==='+'?n+v:n-v;}return n;}
  try{const value=sum();if(pos!==tokens.length)throw Error('Confira os números e operadores.');if(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)throw Error('O resultado ultrapassa a precisão desta calculadora.');return {value,text:value.toLocaleString('pt-BR',{maximumSignificantDigits:12})};}catch(e){return {error:e.message};}
}
module.exports={calculate};
