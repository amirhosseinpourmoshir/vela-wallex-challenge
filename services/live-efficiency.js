// Live scheduling is intentionally separate from accelerated backtest scheduling.
export function liveWake({asOf,lastReview=0,lastFingerprint='',fingerprint='',score=0,price=0,referencePrice=0}){
 if(!lastReview)return {wake:true,reason:'initial'};
 const elapsed=asOf-lastReview;if(elapsed<300)return {wake:false,reason:'cooldown'};
 if(elapsed>=900)return {wake:true,reason:'heartbeat'};
 const moved=referencePrice>0&&Math.abs(price/referencePrice-1)>=.003;
 if(score>=2&&fingerprint!==lastFingerprint&&moved)return {wake:true,reason:'material-market-event'};
 return {wake:false,reason:'unchanged-market'};
}
export function compactFeatures(features){return Object.fromEntries(Object.entries(features).map(([tf,f])=>[tf,{...f,recentClosedBars:(f.recentClosedBars||[]).slice(-3)}]));}
