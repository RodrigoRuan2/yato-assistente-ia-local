'use strict';
const http=require('node:http');
function ask(text){
  const address=process.env.YATO_ASSISTANT_URL,token=process.env.YATO_ASSISTANT_TOKEN;
  if(!address||!token)return Promise.resolve({accepted:false,text:'Para conversar comigo, abra o Yato principal atualizado e ligue o Avatar por lá.'});
  const url=new URL(address);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')return Promise.reject(Error('Invalid assistant endpoint'));
  return new Promise((resolve,reject)=>{
    const body=JSON.stringify({text});
    const req=http.request(url,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'Authorization':`Bearer ${token}`}},res=>{
      let body='';res.setEncoding('utf8');res.on('data',part=>{body+=part;if(body.length>262144)res.destroy(Error('Response too large'));});
      res.on('error',reject);res.on('end',()=>{try{const result=JSON.parse(body);if(typeof result.text!=='string')throw Error('Invalid response');resolve(result);}catch(e){reject(e);}});
    });
    req.setTimeout(610000,()=>req.destroy(Error('Assistant timeout')));
    req.on('error',reject);req.end(body);
  });
}
module.exports={ask};
