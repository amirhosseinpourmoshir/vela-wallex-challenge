export function aggregate(rows,seconds,asOf){
  const groups=new Map();for(const r of rows){if(r.t+60>asOf)continue;const t=Math.floor(r.t/seconds)*seconds;if(t+seconds>asOf)continue;if(!groups.has(t))groups.set(t,[]);groups.get(t).push(r)}
  return [...groups].filter(([,r])=>r.length===seconds/60).map(([t,r])=>({t,o:r[0].o,h:Math.max(...r.map(c=>c.h)),l:Math.min(...r.map(c=>c.l)),c:r.at(-1).c,v:r.reduce((s,c)=>s+c.v,0)}));
}
const mean=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:null;
function ema(a,n){if(a.length<n)return null;let e=mean(a.slice(0,n));for(const x of a.slice(n))e=x*2/(n+1)+e*(1-2/(n+1));return e}
function wilder(a,n){if(a.length<n)return null;let e=mean(a.slice(0,n));for(const x of a.slice(n))e=(e*(n-1)+x)/n;return e}
export function indicators(rows){
  if(rows.length<20)return {ready:false,bars:rows.length};const close=rows.map(r=>r.c),last=rows.at(-1),diff=close.slice(-15).slice(1).map((x,i)=>x-close.slice(-15)[i]);
  const deltas=close.slice(1).map((x,i)=>x-close[i]);const gain=wilder(deltas.map(d=>Math.max(0,d)),14),loss=wilder(deltas.map(d=>Math.max(0,-d)),14),sma=mean(close.slice(-20)),std=Math.sqrt(mean(close.slice(-20).map(v=>(v-sma)**2)));
  const ranges=rows.slice(1).map((r,i)=>Math.max(r.h-r.l,Math.abs(r.h-rows[i].c),Math.abs(r.l-rows[i].c)));
  const e12=ema(close,12),e26=ema(close,26),tail=rows.slice(-50),volume=tail.reduce((s,r)=>s+r.v,0);
  const macds=close.map((_,i)=>i>=25?ema(close.slice(0,i+1),12)-ema(close.slice(0,i+1),26):null).filter(n=>n!==null);
  const plus=[],minus=[];for(let i=1;i<rows.length;i++){const u=rows[i].h-rows[i-1].h,d=rows[i-1].l-rows[i].l;plus.push(u>d&&u>0?u:0);minus.push(d>u&&d>0?d:0)}const dx=[];let diPlus=null,diMinus=null;for(let i=14;i<=ranges.length;i++){const tr=wilder(ranges.slice(0,i),14)||1;diPlus=100*wilder(plus.slice(0,i),14)/tr;diMinus=100*wilder(minus.slice(0,i),14)/tr;dx.push(100*Math.abs(diPlus-diMinus)/(diPlus+diMinus||1))}
  const highest=Math.max(...rows.slice(-14).map(r=>r.h)),lowest=Math.min(...rows.slice(-14).map(r=>r.l));const stochasticD=mean([rows.length-3,rows.length-2,rows.length-1].map(i=>{const range=rows.slice(i-13,i+1),h=Math.max(...range.map(r=>r.h)),l=Math.min(...range.map(r=>r.l));return h===l?50:(rows[i].c-l)/(h-l)*100}));const typical=rows.slice(-20).map(r=>(r.h+r.l+r.c)/3),tpMean=mean(typical),deviation=mean(typical.map(v=>Math.abs(v-tpMean)));let obv=0;for(let i=Math.max(1,rows.length-20);i<rows.length;i++)obv+=Math.sign(rows[i].c-rows[i-1].c)*rows[i].v;const cmfVolume=rows.slice(-20).reduce((s,r)=>s+r.v,0);const adx=wilder(dx,14);const e20=ema(close,20),e50=ema(close,50);
  return {ready:true,bars:rows.length,close:last.c,sma20:sma,sma50:close.length>=50?mean(close.slice(-50)):null,ema20:e20,ema50:e50,ema200:ema(close,200),rsi14:loss===0?(gain===0?50:100):100-100/(1+gain/loss),atr14:wilder(ranges,14),macd:e26===null?null:e12-e26,macdSignal:ema(macds,9),adx14:adx,diPlus,diMinus,stochasticD,stochasticK:highest===lowest?50:(last.c-lowest)/(highest-lowest)*100,williamsR:highest===lowest?-50:(highest-last.c)/(highest-lowest)*-100,cci20:deviation?(typical.at(-1)-tpMean)/(.015*deviation):0,roc12:close.length>12?(last.c/close.at(-13)-1)*100:null,obvDelta20:obv,cmf20:cmfVolume?rows.slice(-20).reduce((s,r)=>s+(r.h===r.l?0:(2*r.c-r.l-r.h)/(r.h-r.l))*r.v,0)/cmfVolume:null,bollinger:{middle:sma,upper:sma+2*std,lower:sma-2*std,widthPercent:std*4/sma*100},observedSupport:Math.min(...tail.map(r=>r.l)),observedResistance:Math.max(...tail.map(r=>r.h)),priorSupport:Math.min(...rows.slice(-51,-1).map(r=>r.l)),priorResistance:Math.max(...rows.slice(-51,-1).map(r=>r.h)),vwap50:volume?tail.reduce((s,r)=>s+((r.h+r.l+r.c)/3)*r.v,0)/volume:null,volumeRatio:last.v/(mean(tail.slice(0,-1).map(r=>r.v))||1),regime:adx===null||e50===null?'unknown':adx<20?'range':adx>=25?(e20>e50?'uptrend':'downtrend'):'transition',lastClosedAt:last.t};
}
export function analyze(rows,asOf){return Object.fromEntries([300,900,3600,14400].map(tf=>{const bars=aggregate(rows,tf,asOf).slice(-250);return [String(tf),{...indicators(bars),lastClosedAt:bars.length?bars.at(-1).t+tf:null,recentClosedBars:bars.slice(-6)}]}))}
export const RISK_PROFILES=['حفاظتی','بسیار محتاط','محتاط','سنجیده','میانه','فعال','پویا','جسور','بسیار جسور','حداکثر مجاز'].map((name,i)=>({name,level:i+1,risk:Number((.001+i*.00075).toFixed(5)),allocation:Number((.1+i*.015).toFixed(3)),leverage:i+1,drawdown:Number((.02+i*.004).toFixed(3)),bookRisk:Number((.004+i*.0015).toFixed(4)),maxExposure:2,cashReserve:.15}));
export function validateDecision(d,price,profile,maxLeverage=10){
  if(!d||!['hold','long','short','add','reduce','protect','close'].includes(d.action)||typeof d.reason!=='string'||d.reason.length>1600)throw Error('ساختار پاسخ مدل معتبر نیست.');
  if(d.action==='hold'||d.action==='close')return {...d,reason:d.reason.slice(0,1600)};
  if(d.action==='reduce'){if(!Number.isFinite(d.fraction)||d.fraction<.1||d.fraction>=1)throw Error('سهم خروج پله‌ای باید بین ۱۰٪ و کمتر از ۱۰۰٪ باشد.');return d}
  if(d.action==='protect'){if(!Number.isFinite(d.stopLoss)||!Number.isFinite(d.takeProfit)||d.stopLoss<=0||d.takeProfit<=0)throw Error('حدهای محافظتی معتبر نیستند.');return d}
  if(![d.stopLoss,d.takeProfit,d.leverage,d.allocation].every(n=>typeof n==='number'&&Number.isFinite(n)))throw Error('اعداد تصمیم مدل معتبر نیست.');
  if(!Number.isInteger(d.leverage)||d.leverage<1||d.leverage>Math.min(profile.leverage,maxLeverage)||d.allocation<=0||d.allocation>profile.allocation)throw Error('تصمیم مدل از سقف ریسک انتخاب‌شده فراتر است.');
  const side=d.action==='add'?d.side:d.action;if(!['long','short'].includes(side))throw Error('جهت ورود پله‌ای مشخص نیست.');
  if(d.stopLoss<=0||d.takeProfit<=0||(side==='long'?!(d.stopLoss<price&&d.takeProfit>price):!(d.stopLoss>price&&d.takeProfit<price)))throw Error('جهت حد سود و ضرر معتبر نیست.');
  if(Math.abs(price-d.stopLoss)/price<.002||Math.abs(d.takeProfit-price)/Math.abs(price-d.stopLoss)<1.5)throw Error('فاصلهٔ حد ضرر یا نسبت سود به ریسک کافی نیست.');
  if(Math.abs(price-d.stopLoss)/price*d.leverage>.5)throw Error('حد ضرر نسبت به ضریب بیش از حد دور است.');
  return d;
}
export function exitTrigger(position,candle){
  const long=position.side==='long';const stop=long?candle.l<=position.sl:candle.h>=position.sl;const tp=long?candle.h>=position.tp:candle.l<=position.tp;
  if(stop)return {price:long?Math.min(position.sl,candle.o):Math.max(position.sl,candle.o),reason:'حد ضرر؛ در برخورد همزمان، خروج محافظه‌کارانه'};
  if(tp)return {price:position.tp,reason:'حد سود'};return null;
}
