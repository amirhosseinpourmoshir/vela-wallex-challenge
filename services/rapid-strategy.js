import {indicators} from './trader-analysis.js';
// Deterministic nominations, never authority to trade. All bars must already be closed.
export function rapidPlan({bars,features,asOf,riskLevel=3,hasInventory=false,feeRate=.003}){
 let diagnostics=null;const hold=reason=>({action:'hold',strategy:'none',score:0,reasons:[reason],...(diagnostics?{diagnostics}: {})});
 if(!Array.isArray(bars)||bars.length<100||!features?.['300']?.ready||!features?.['900']?.ready)return hold('دادهٔ بستهٔ چندافقی کافی نیست.');
 const last=bars.at(-1),previous=bars.at(-2);if(last.t+60>asOf||asOf-last.t-60>180)return hold('دادهٔ دقیقه‌ای تازه و بسته نیست.');
 const tail=bars.slice(-30);if(tail.some((r,i)=>i&&r.t-tail[i-1].t!==60))return hold('پیوستگی دادهٔ دقیقه‌ای کامل نیست.');
 const minute=indicators(bars.slice(-120)),five=features['300'],quarter=features['900'],hour=features['3600'];
 if(!minute.ready||!Number.isFinite(minute.atr14)||minute.atr14<=0)return hold('نوسان معتبر نیست.');
 const recent=bars.slice(-3),baseline=bars.slice(-53,-3),baseVolume=baseline.reduce((n,r)=>n+r.v,0)/baseline.length,volume3m=baseVolume>0?recent.reduce((n,r)=>n+r.v,0)/(3*baseVolume):0,recentLow=Math.min(...recent.map(r=>r.l)),recentHigh=Math.max(...recent.map(r=>r.h)),referenceSupport=Math.min(...baseline.map(r=>r.l)),referenceResistance=Math.max(...baseline.map(r=>r.h));
 const aggressive=Number(riskLevel)>=8,volume=Math.max(minute.volumeRatio||0,volume3m),body=(last.c-last.l)/Math.max(last.h-last.l,last.c*.00001),up=last.c>minute.ema20,aligned=five.close>five.ema20&&quarter.close>quarter.ema20;
 diagnostics={volume1m:minute.volumeRatio,volume3m,effectiveVolume:volume,aboveMinuteEma:last.c>minute.ema20,fiveMinuteTrend:five.ema20>five.ema50,quarterRsi:quarter.rsi14,referenceSupport,referenceResistance};
 const evidence={diagnostics,minute:{open:last.o,high:last.h,low:last.l,close:last.c,ema20:minute.ema20,rsi14:minute.rsi14,atr14:minute.atr14,volumeRatio:minute.volumeRatio,cmf20:minute.cmf20,priorSupport:minute.priorSupport,priorResistance:minute.priorResistance},lastClosedAt:last.t+60};
 const nominations=[];
 if(last.c>referenceResistance&&recentLow<=referenceResistance+minute.atr14*.5&&volume>=(aggressive?1.3:1.8)&&up&&minute.cmf20>0&&Math.max(body,(last.c-recentLow)/Math.max(recentHigh-recentLow,last.c*.00001))>=.6)nominations.push({strategy:'volume-breakout',score:4+(aligned?1:0),reasons:['شکست مقاومت قبلی دقیقه‌ای با حجم و جریان پول مثبت','بسته‌شدن در بخش بالایی دامنهٔ کندل']});
 if(five.ema20>five.ema50&&up&&last.c>bars.at(-4).c&&recentLow<=minute.ema20+minute.atr14*.5&&volume>=(aggressive?.7:1.1)&&quarter.rsi14>45)nominations.push({strategy:'trend-pullback',score:3+(aligned?1:0),reasons:['بازگشت بالای میانگین دقیقه‌ای پس از پولبک','ساختار میانگین‌های پنج‌دقیقه صعودی است']});
 if(recentLow<referenceSupport&&last.c>referenceSupport&&body>.65&&last.c>previous.c&&volume>=(aggressive?1:1.5))nominations.push({strategy:'support-reclaim',score:4,reasons:['بازپس‌گیری حمایت قبلی پس از نفوذ ناموفق','تأیید بدنهٔ برگشتی و مشارکت حجمی']});
 if(hasInventory&&last.c<referenceSupport&&last.c<five.ema20&&volume>=1.3)return {action:'sell',evidence,strategy:'structure-exit',score:5,referencePrice:last.c,reasons:['شکست حمایت دقیقه‌ای و افت زیر میانگین پنج‌دقیقه','فروش صرفاً از موجودی تأییدشدهٔ همین جلسه'],fingerprint:'structure-exit:'+Math.floor(last.t/300),observedAt:asOf,expiresAt:asOf+120};
 const best=nominations.sort((a,b)=>b.score-a.score)[0];if(!best||best.score<(aggressive?3:4))return hold('ساختار یا تأیید حجم کافی نیست؛ نسبت حجم ۱دقیقه '+Number(minute.volumeRatio||0).toFixed(2)+' و ۳دقیقه '+volume3m.toFixed(2)+' است.');
 const entry=last.c,atr=Math.max(minute.atr14,five.atr14*.45,entry*.003),structural=Math.min(minute.priorSupport,last.l),stopLoss=Math.min(entry-atr*(aggressive?1.3:1.8),structural-atr*.15);
 if(stopLoss<=0)return hold('حد ضرر ساختاری معتبر نیست.');
 const risk=entry-stopLoss,costFraction=2*feeRate+.0005;
 // This is an ATR projection, never presented as an observed resistance.
 const takeProfit=entry+Math.max(risk*2.8,costFraction*entry*3,atr*3),ratio=((takeProfit-entry)/entry-costFraction)/((entry-stopLoss)/entry+costFraction);
 if(!Number.isFinite(ratio)||ratio<1.5)return hold('سناریوی محلی پس از کارمزد نسبت سود به زیان خالص کافی ندارد.');
 const counter=[];if(hour?.regime==='downtrend')counter.push('زمینهٔ ساعتی نزولی است؛ مدل باید ورود خلاف جهت را رد یا مستند کند.');if(five.volumeRatio<.5)counter.push('حجم پنج‌دقیقه ضعیف است.');
 return {...best,evidence,action:'buy',referencePrice:entry,stopLoss,takeProfit,targetBasis:'ATR projection, not observed resistance',netRewardRiskEstimate:ratio,counterEvidence:counter,fingerprint:best.strategy+':'+Math.floor(last.t/300),observedAt:asOf,expiresAt:asOf+120};
}
export function rapidWake({asOf,lastReview=0,fingerprint,lastFingerprint='',score=0,supervisoryOnly=false}){if(supervisoryOnly){if(!lastReview)return {wake:true,reason:'initial-supervision'};const gap=asOf-lastReview;if(gap>=600)return {wake:true,reason:'supervisory-heartbeat'};if(gap>=300&&score>=3&&fingerprint!==lastFingerprint)return {wake:true,reason:'local-filter-supervision'};return {wake:false,reason:'supervision-cooldown'};}if(!fingerprint||score<3)return {wake:false,reason:'no-local-plan'};if(!lastReview)return {wake:true,reason:'local-plan-initial'};const gap=asOf-lastReview;if(gap<120)return {wake:false,reason:'rapid-cooldown'};if(fingerprint===lastFingerprint&&gap<600)return {wake:false,reason:'same-local-plan'};return {wake:true,reason:'local-plan-review'};}
export function estimateMarketSweep({side,quantity,book,maxSlippageBps=50}){
 if(!['buy','sell'].includes(side)||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(maxSlippageBps)||maxSlippageBps<1||maxSlippageBps>100)throw Error('پارامتر سفارش فوری معتبر نیست.');
 const levels=side==='buy'?book?.ask:book?.bid;if(!Array.isArray(levels)||!levels.length)throw Error('عمق بازار برای سفارش فوری موجود نیست.');let left=quantity,total=0,previous=null;const best=Number(levels[0].price);let worst=best;
 for(const level of levels){const price=Number(level.price),size=Number(level.quantity);if(!Number.isFinite(price)||price<=0||!Number.isFinite(size)||size<0||previous!==null&&(side==='buy'?price<previous:price>previous))throw Error('عمق بازار ناسازگار است.');previous=price;const take=Math.min(left,size);if(take>0){total+=take*price;left-=take;worst=price;}if(left<=quantity*1e-10)break;}
 if(left>quantity*1e-10)throw Error('حجم قابل مشاهدهٔ دفتر سفارش برای معاملهٔ فوری کافی نیست.');
 const slippageBps=(side==='buy'?worst/best-1:1-worst/best)*10000;if(slippageBps>maxSlippageBps)throw Error('لغزش برآوردی سفارش فوری از سقف انتخابی بیشتر است.');
 return {averagePrice:total/quantity,worstPrice:worst,notional:total,slippageBps,note:'Snapshot estimate only; MARKET execution price is not guaranteed.'};
}
