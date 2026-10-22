import {indicators,aggregate} from './trader-analysis.js';

// Watcher thresholds nominate a REVIEW, never an entry or an order.
export function inspectMarket(rows,features,asOf,previous={},position=null,pastCandles=0){
 const m=indicators(rows.slice(-100)),five=features['300'],hour=features['3600'];if(!m.ready||!five?.ready||!hour?.ready)return {ready:false,score:0,reasons:['دادهٔ بستهٔ کافی نیست'],fingerprint:'not-ready'};
 const last=rows.at(-1),before=rows.at(-2),atr=Math.max(m.atr14,last.c*.0005),pulse=(last.c-before.c)/atr,reasons=[],kinds=[];let score=0;
 const add=(kind,label,points)=>{kinds.push(kind);reasons.push(label);score+=points};
 if(Math.abs(pulse)>=.35)add(pulse>0?'pulse-up':'pulse-down',pulse>0?'پالس مثبت فراتر از نویز ATR':'پالس منفی فراتر از نویز ATR',Math.min(3,Math.abs(pulse)));
 if(last.c>m.priorResistance&&m.volumeRatio>=1.2)add('break-up','عبور از مقاومت گذشته با افزایش حجم',2.5);
 if(last.c<m.priorSupport&&m.volumeRatio>=1.2)add('break-down','شکست حمایت گذشته با افزایش حجم',2.5);
 if(m.volumeRatio>=2)add('volume','جهش حجم نسبت به پنجرهٔ قبلی',1.5);
 const side=Math.sign(five.close-five.ema20);if(previous.side!==undefined&&side!==previous.side)add('ema-cross','تغییر سمت قیمت نسبت به میانگین ۵دقیقه',1.5);
 const band=m.rsi14>70?'high':m.rsi14<30?'low':'normal';if(previous.band&&band!==previous.band)add('momentum-shift','تغییر ناحیهٔ مومنتوم؛ نیازمند تأیید مستقل',1);
 if(previous.regime&&previous.regime!==hour.regime)add('regime','تغییر رژیم یک‌ساعت',2);
 if(position&&(last.c-position.entry)*(position.side==='long'?1:-1)<-atr*.75)add('position-risk','حرکت نامطلوب موقعیت باز',3);
 const volatility=m.atr14/last.c;if(volatility>.03)add('volatility-risk','نوسان دقیقه‌ای بسیار زیاد؛ احتیاط در ورود',3);
 const state={side,band,regime:hour.regime};return {ready:true,score,reasons,kinds,state,pulseAtr:pulse,atrPercent:volatility*100,fingerprint:kinds.sort().join('|')||'quiet',qualityWeight:1+Math.min(.5,Math.log2(1+pastCandles/1440)/12),latestClosedAt:last.t+60,regime:hour.regime};
}
export function wakePolicy({asOf,lastReview=0,lastFingerprint='',fingerprint='',score=0,lastGlobalReview=0,bootstrap=false,horizonMinutes=1440}){
 const short=horizonMinutes<=240,cooldown=short?60:180,heartbeat=short?Math.min(180,Math.max(60,Math.floor(horizonMinutes*60/5))):3600,duplicate=short?120:900;
 if(bootstrap)return !lastGlobalReview||asOf-lastGlobalReview>=cooldown?{wake:true,reason:'initial',priority:100}:{wake:false,reason:'cooldown'};
 const elapsed=asOf-lastReview,globalGap=asOf-lastGlobalReview;
 if(globalGap>=heartbeat)return {wake:true,reason:'heartbeat',priority:10+globalGap/heartbeat};
 if(globalGap<cooldown)return {wake:false,reason:'cooldown'};
 if(fingerprint===lastFingerprint&&elapsed<duplicate)return {wake:false,reason:'duplicate'};
 if(score>=(short?.75:2)&&elapsed>=cooldown)return {wake:true,reason:'market-event',priority:score};
 return {wake:false,reason:'noise'};
}
export function localScenario(history,features,watch){
 const last=history.at(-1),five=features['300'],hour=features['3600'];if(!last||!five?.ready||!hour?.ready)return {bias:'unavailable',reason:'دادهٔ کافی نیست'};
 const atr=Math.max(five.atr14||0,last.c*.002),up=five.close>five.ema20,aligned=up?hour.close>hour.ema20:hour.close<hour.ema20,side=aligned?(up?'long':'short'):'wait',sign=up?1:-1;
 return {bias:side,price:last.c,referenceStop:last.c-sign*atr*1.5,referenceTarget:last.c+sign*atr*3,timeframeAlignment:aligned?'aligned':'conflicting',volumeRatio:five.volumeRatio,signals:watch.reasons,reason:aligned?'جهت دو افق هم‌سو است؛ ورود نیازمند تأیید مدل، هزینه و ابطال است.':'جهت کوتاه و بلند مخالف است؛ شکست یا بازگشت باید توسط مدل تفکیک شود.',binding:false};
}
export function correlations(histories,asOf){const returns={};for(const [symbol,rows] of Object.entries(histories)){const bars=aggregate(rows,300,asOf).slice(-97),m=new Map();for(let i=1;i<bars.length;i++)if(bars[i].t-bars[i-1].t===300)m.set(bars[i].t,Math.log(bars[i].c/bars[i-1].c));returns[symbol]=m}const output={};const symbols=Object.keys(returns);for(let i=0;i<symbols.length;i++)for(let j=i+1;j<symbols.length;j++){const a=symbols[i],b=symbols[j],pairs=[...returns[a]].filter(([t])=>returns[b].has(t)).map(([t,v])=>[v,returns[b].get(t)]);if(pairs.length<30){output[`${a}:${b}`]=null;continue}const ma=pairs.reduce((s,p)=>s+p[0],0)/pairs.length,mb=pairs.reduce((s,p)=>s+p[1],0)/pairs.length,va=pairs.reduce((s,p)=>s+(p[0]-ma)**2,0),vb=pairs.reduce((s,p)=>s+(p[1]-mb)**2,0);output[`${a}:${b}`]=va&&vb?Number((pairs.reduce((s,p)=>s+(p[0]-ma)*(p[1]-mb),0)/Math.sqrt(va*vb)).toFixed(4)):null}return output}
