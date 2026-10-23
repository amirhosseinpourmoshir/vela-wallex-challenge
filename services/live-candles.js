import {Router} from 'express';
import {readMarketCatalog} from './market-catalog.js';

export function createLiveCandles(db,config,{fetchImpl=fetch,clock=Date.now}={}){
 const router=Router(),cache=new Map(),pending=new Map();
 router.get('/',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const symbol=String(req.query.symbol||''),minutes=Number(req.query.minutes||1);
  const allowed=readMarketCatalog(db).markets.some(m=>m.symbol===symbol&&m.quote==='TMN'&&config.trading.allowedSymbols.includes(symbol)&&!config.trading.blockedSymbols.includes(symbol)&&db.prepare('SELECT 1 FROM coin_preferences WHERE symbol=? AND enabled=1').get(symbol));
  if(!allowed||![1,5,15,60].includes(minutes))return res.status(400).json({message:'ارز فعال یا تایم‌فریم معتبر انتخاب کنید.'});
  const key=symbol+':'+minutes;
  try{
   if(!cache.has(key)||clock()-cache.get(key).receivedAt>=2000){
    if(!pending.has(key))pending.set(key,(async()=>{
     // Wallex does not publish a native 5m interval: aggregate its real 1m bars.
     const resolution=minutes===5||minutes===15?1:minutes,to=Math.floor(clock()/1000),url=new URL(config.wallex.baseUrl+'/v1/udf/history');url.search=new URLSearchParams({symbol,resolution:String(resolution),from:String(to-minutes*60*100),to:String(to)});
     const r=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(config.wallex.httpTimeoutMs)});if(!r.ok)throw Error();const d=await r.json();
     if(d.s!=='no_data'&&(d.s!=='ok'||!['t','o','h','l','c','v'].every(k=>Array.isArray(d[k])&&d[k].length===d.t.length)))throw Error();
     const unique=new Map();for(let i=0;i<(d.t?.length||0);i++){const [t,o,h,l,c,v]=['t','o','h','l','c','v'].map(k=>Number(d[k][i]));if(!Number.isSafeInteger(t)||t%60||t>to||t<to-minutes*60*100||![o,h,l,c,v].every(Number.isFinite)||Math.min(o,h,l,c)<=0||v<0||h<Math.max(o,c)||l>Math.min(o,c))continue;unique.set(t,{t,o,h,l,c,v,closed:t+minutes*60<=to})}
     let candles=[...unique.values()].sort((a,b)=>a.t-b.t);
     const baseCandles=candles,seconds=minutes*60;
     if(minutes>1&&(minutes===5||candles.some((b,i)=>b.t%seconds!==0||(i>0&&b.t-candles[i-1].t<seconds)))){const groups=new Map();for(const b of candles){const start=Math.floor(b.t/seconds)*seconds;if(!groups.has(start))groups.set(start,[]);groups.get(start).push(b)}candles=[...groups].filter(([start,bars])=>start+seconds>to||bars.length===minutes).map(([t,bars])=>({t,o:bars[0].o,h:Math.max(...bars.map(b=>b.h)),l:Math.min(...bars.map(b=>b.l)),c:bars.at(-1).c,v:bars.reduce((sum,b)=>sum+b.v,0),closed:t+seconds<=to}))}
     const result={symbol,minutes,candles,baseCandles,baseMinutes:resolution,receivedAt:clock(),source:'wallex',serverTime:clock()};cache.set(key,result);return result;
    })().finally(()=>pending.delete(key)));
    await pending.get(key);
   }
   res.json({...cache.get(key),serverTime:clock()});
  }catch{res.status(502).json({message:'دریافت کندل زنده از والکس انجام نشد؛ نمودار قبلی را تازه فرض نکنید.'})}
 });
 return {router};
}
