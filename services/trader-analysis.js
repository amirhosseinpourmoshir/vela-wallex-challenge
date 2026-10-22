export function aggregate(rows,seconds,asOf){
  const groups=new Map();for(const r of rows){if(r.t+60>asOf)continue;const t=Math.floor(r.t/seconds)*seconds;if(t+seconds>asOf)continue;if(!groups.has(t))groups.set(t,[]);groups.get(t).push(r)}
  return [...groups].filter(([,r])=>r.length===seconds/60).map(([t,r])=>({t,o:r[0].o,h:Math.max(...r.map(c=>c.h)),l:Math.min(...r.map(c=>c.l)),c:r.at(-1).c,v:r.reduce((s,c)=>s+c.v,0)}));
}
const mean=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:null;
function ema(a,n){if(a.length<n)return null;let e=mean(a.slice(0,n));for(const x of a.slice(n))e=x*2/(n+1)+e*(1-2/(n+1));return e}
export function indicators(rows){
  if(rows.length<20)return {ready:false,bars:rows.length};const close=rows.map(r=>r.c),last=rows.at(-1),diff=close.slice(-15).slice(1).map((x,i)=>x-close.slice(-15)[i]);
  const gain=mean(diff.map(d=>Math.max(0,d))),loss=mean(diff.map(d=>Math.max(0,-d))),sma=mean(close.slice(-20)),std=Math.sqrt(mean(close.slice(-20).map(v=>(v-sma)**2)));
  const ranges=rows.slice(1).map((r,i)=>Math.max(r.h-r.l,Math.abs(r.h-rows[i].c),Math.abs(r.l-rows[i].c)));
  const e12=ema(close,12),e26=ema(close,26),tail=rows.slice(-50),volume=tail.reduce((s,r)=>s+r.v,0);
  const macds=close.map((_,i)=>i>=25?ema(close.slice(0,i+1),12)-ema(close.slice(0,i+1),26):null).filter(n=>n!==null);
  return {ready:true,bars:rows.length,close:last.c,sma20:sma,sma50:close.length>=50?mean(close.slice(-50)):null,ema20:ema(close,20),ema50:ema(close,50),rsi14:loss===0?(gain===0?50:100):100-100/(1+gain/loss),atr14:mean(ranges.slice(-14)),macd:e26===null?null:e12-e26,macdSignal:ema(macds,9),bollinger:{middle:sma,upper:sma+2*std,lower:sma-2*std},observedSupport:Math.min(...tail.map(r=>r.l)),observedResistance:Math.max(...tail.map(r=>r.h)),vwap50:volume?tail.reduce((s,r)=>s+((r.h+r.l+r.c)/3)*r.v,0)/volume:null,volumeRatio:last.v/(mean(tail.slice(0,-1).map(r=>r.v))||1),lastClosedAt:last.t};
}
export function analyze(rows,asOf){return Object.fromEntries([300,900,3600,14400].map(tf=>{const bars=aggregate(rows,tf,asOf).slice(-250);return [String(tf),{...indicators(bars),lastClosedAt:bars.length?bars.at(-1).t+tf:null,recentClosedBars:bars.slice(-6)}]}))}
export const RISK_PROFILES=[{name:'محافظه‌کار',risk:.0025,allocation:.1,leverage:1,drawdown:.03},{name:'متعادل',risk:.005,allocation:.2,leverage:2,drawdown:.06},{name:'جسور',risk:.01,allocation:.3,leverage:3,drawdown:.1}];
export function validateDecision(d,price,profile,maxLeverage=3){
  if(!d||!['hold','long','short','close'].includes(d.action)||typeof d.reason!=='string'||d.reason.length>1600)throw Error('ساختار پاسخ مدل معتبر نیست.');
  if(d.action==='hold'||d.action==='close')return {...d,reason:d.reason.slice(0,1600)};
  if(![d.stopLoss,d.takeProfit,d.leverage,d.allocation].every(n=>typeof n==='number'&&Number.isFinite(n)))throw Error('اعداد تصمیم مدل معتبر نیست.');
  if(!Number.isInteger(d.leverage)||d.leverage<1||d.leverage>Math.min(profile.leverage,maxLeverage)||d.allocation<=0||d.allocation>profile.allocation)throw Error('تصمیم مدل از سقف ریسک انتخاب‌شده فراتر است.');
  if(d.stopLoss<=0||d.takeProfit<=0||(d.action==='long'?!(d.stopLoss<price&&d.takeProfit>price):!(d.stopLoss>price&&d.takeProfit<price)))throw Error('جهت حد سود و ضرر معتبر نیست.');
  if(Math.abs(price-d.stopLoss)/price<.002||Math.abs(d.takeProfit-price)/Math.abs(price-d.stopLoss)<1.5)throw Error('فاصلهٔ حد ضرر یا نسبت سود به ریسک کافی نیست.');
  return d;
}
export function exitTrigger(position,candle){
  const long=position.side==='long';const stop=long?candle.l<=position.sl:candle.h>=position.sl;const tp=long?candle.h>=position.tp:candle.l<=position.tp;
  if(stop)return {price:long?Math.min(position.sl,candle.o):Math.max(position.sl,candle.o),reason:'حد ضرر؛ در برخورد همزمان، خروج محافظه‌کارانه'};
  if(tp)return {price:position.tp,reason:'حد سود'};return null;
}
