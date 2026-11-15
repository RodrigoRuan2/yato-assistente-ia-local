'use strict';
const FEEDS=[{url:'https://canaltech.com.br/rss/',host:'canaltech.com.br',name:'Canaltech'},{url:'https://news.xbox.com/pt-br/feed/',host:'news.xbox.com',name:'Xbox Wire'}];
const HOUR=3600000;
const day=ms=>new Date(ms).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
const decode=s=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const c=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return c>0&&c<=0x10ffff?String.fromCodePoint(c):'';}).replace(/&(amp|lt|gt|quot|apos);/g,(_,e)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[e])).replace(/<[^>]*>/g,'').trim();
function parseNews(xml,feed,now=Date.now()){
  const get=(item,tag)=>decode(item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`,'i'))?.[1]||'');
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(m=>{
    const title=get(m[1],'title'),link=get(m[1],'link'),published=Date.parse(get(m[1],'pubDate'));
    let url;try{url=new URL(link);}catch{return null;}
    if(url.protocol!=='https:'||url.hostname!==feed.host||!title||title.length>500||!Number.isFinite(published)||now-published>72*HOUR||published-now>900000)return null;
    if(feed.host==='canaltech.com.br'&&!/^\/(inteligencia-artificial|games|hardware|software|apps|seguranca|internet|mercado|smartphone|notebook|tablet|redes-sociais|inovacao|robotica|realidade-virtual|computadores)\//.test(url.pathname))return null;
    if(/black friday|cupons?|\bofertas?\b|qual .+ comprar|mais baratos/i.test(title))return null;
    const topic=feed.host==='news.xbox.com'||url.pathname.startsWith('/games/')?'jogos':url.pathname.startsWith('/inteligencia-artificial/')?'IA':'tecnologia';
    return {kind:'news',topic,text:title,link:url.href,source:feed.name,published,fetchedAt:now,id:url.href};
  }).filter(Boolean).sort((a,b)=>b.published-a.published);
}
async function download(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Fonte indisponível');
  const reader=response.body.getReader();let size=0;const chunks=[];
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw Error('Resposta grande demais');}chunks.push(Buffer.from(value));}
  return Buffer.concat(chunks).toString('utf8');
}
function weatherDescription(code){
  if(code===0)return 'céu limpo';if(code<=3)return 'com nuvens';if([45,48].includes(code))return 'neblina';
  if(code>=51&&code<=67)return 'chuva';if(code>=71&&code<=77)return 'neve';if(code>=80&&code<=82)return 'pancadas de chuva';if(code>=95)return 'trovoadas';return 'condições variáveis';
}
class OnlineInfo{
  constructor({settings={},save=()=>{},load=download,now=Date.now}={}){
    this.settings={...settings};this.save=save;this.load=load;this.now=now;this.pending=false;this.retryAt=0;this.startAt=now()+60000;this.cache={};
  }
  due(){
    const now=this.now(),s=this.settings.onlineHistory||{};
    if(this.pending||now<this.retryAt||now<this.startAt)return null;
    if(s.lastShown&&now-s.lastShown<20*60000)return null;
    if((s.day!==day(now)||s.newsCount<2)&&(!s.lastNews||now-s.lastNews>=6*HOUR))return 'news';
    if(this.settings.weatherLocation&&(!s.lastWeather||now-s.lastWeather>=1.5*HOUR))return 'weather';
    return null;
  }
  async get(kind){
    const now=this.now();
    if(kind==='weather'){
      const loc=this.settings.weatherLocation;
      if(!loc||!Number.isFinite(loc.latitude)||!Number.isFinite(loc.longitude))throw Error('Configure a cidade para consultar o clima.');
      if(this.cache.weather&&now-this.cache.weather.fetchedAt<900000)return this.cache.weather;
      const url=new URL('https://api.open-meteo.com/v1/forecast');
      url.search=new URLSearchParams({latitude:String(loc.latitude),longitude:String(loc.longitude),current:'temperature_2m,weather_code',daily:'precipitation_probability_max',forecast_days:'1',timezone:'America/Sao_Paulo'});
      const data=JSON.parse(await this.load(url.href)),c=data.current;
      if(!Number.isFinite(c?.temperature_2m)||!Number.isFinite(c?.weather_code)||!c.time)throw Error('Clima indisponível agora.');
      const observed=Date.parse(c.time+'-03:00');
      if(!Number.isFinite(observed)||now-observed>3*HOUR||observed-now>HOUR)throw Error('A fonte retornou dados de clima desatualizados.');
      const rain=data.daily?.precipitation_probability_max?.[0];
      const text=`${loc.label}: ${Math.round(c.temperature_2m)} °C, ${weatherDescription(c.weather_code)}.${Number.isFinite(rain)&&rain>=0&&rain<=100&&data.daily.time?.[0]===c.time.slice(0,10)?` Chance máxima de chuva hoje: ${Math.round(rain)}%.`:''}`;
      return this.cache.weather={kind,text,source:'Open-Meteo · estimativa regional',link:'https://open-meteo.com/',fetchedAt:now,published:observed,id:'weather:'+c.time};
    }
    if(!this.cache.news||now-this.cache.news.at>600000){
      const results=await Promise.allSettled(FEEDS.map(async feed=>parseNews(await this.load(feed.url),feed,now)));
      const items=results.flatMap(r=>r.status==='fulfilled'?r.value:[]).sort((a,b)=>b.published-a.published);
      if(!items.length)throw Error('Não consegui obter manchetes recentes agora.');
      this.cache.news={at:now,items};
    }
    const seen=this.settings.onlineHistory?.seen||[];
    const unread=this.cache.news.items.filter(i=>!seen.includes(i.id));
    return unread.find(i=>i.topic!==this.settings.onlineHistory?.lastTopic)||unread[0]||null;
  }
  shown(info){
    const now=this.now(),old=this.settings.onlineHistory||{};
    const history={...old,day:day(now),lastShown:now,newsCount:old.day===day(now)?old.newsCount||0:0};
    if(info.kind==='news'){history.lastNews=now;history.newsCount++;history.lastTopic=info.topic;history.seen=[...(old.seen||[]),info.id].slice(-80);}
    else history.lastWeather=now;
    this.save({onlineHistory:history});this.settings.onlineHistory=history;
  }
}
module.exports={OnlineInfo,parseNews,FEEDS,download,weatherDescription};
