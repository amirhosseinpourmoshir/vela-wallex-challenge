import {tradeEconomics} from './trade-economics.js';
export const LOCAL_TRADER_VERSION='local-multiframe-v1';
// Pure deterministic proposals. Exchange/session authority remains outside this module.
export function localCandidate(c,{profile,budgetTmn}){
 const f=c.features['300'],q=c.features['900'],h=c.features['3600'],entry=Number(c.price.ask),plan=c.localPlan;
 const bars=f?.recentClosedBars||[],last=bars.at(-1),previous=bars.at(-2),warnings=[];
 const reject=reason=>({symbol:c.symbol,score:0,viable:false,reason,blockers:[reason],warnings});
 if(!f?.ready||!q?.ready||!Number.isFinite(entry)||entry<=0||!Number.isFinite(f.atr14)||f.atr14<=0)return reject('دادهٔ چندافقی یا نوسان قابل اتکا نیست.');
 if(plan?.action==='sell'&&c.sessionInventory>0)return {symbol:c.symbol,score:95,viable:true,reason:plan.reasons.join('؛ '),blockers:[],warnings,order:{side:'sell',price:c.price.bid,amountTmn:c.sessionInventory*c.price.bid}};
 if(f.atr14/entry>.03||last&&(last.h-last.l)>f.atr14*4)return reject('نوسان پنج‌دقیقه‌ای غیرعادی است: ATR بیش از ۳٪ یا دامنه بیش از چهار ATR.');
 if(f.close<f.ema20)warnings.push('قیمت زیر میانگین پنج‌دقیقه');if(q.close<q.ema20)warnings.push('زمینهٔ پانزده‌دقیقه ضعیف');if(h?.regime==='downtrend')warnings.push('زمینهٔ ساعتی نزولی');
 const confirmed=plan?.action==='buy',recovering=last&&previous&&last.c>previous.c&&last.c>last.o&&f.volumeRatio>=.5&&f.rsi14>=30&&f.rsi14<75;
 if(!confirmed&&!(profile.level>=8&&recovering))return reject('سیگنال چندشرطی یا بازیابی قیمت با مشارکت حجمی وجود ندارد.');
 const atr=Math.max(f.atr14,entry*.002),support=Number(f.observedSupport),stop=confirmed?plan.stopLoss:Math.min(entry-atr*1.3,support-atr*.15);
 const observedTargets=[f.observedResistance,q.observedResistance,h?.observedResistance].filter(x=>Number.isFinite(x)&&x>entry).sort((a,b)=>a-b);
 const target=confirmed?plan.takeProfit:observedTargets[0];if(!(stop>0&&stop<entry&&target>entry))return reject('حد ضرر یا هدف مستقل قابل دفاع نداریم.');
 const economics=tradeEconomics({side:'long',entry,stopLoss:stop,takeProfit:target,entryCost:entry*c.limits.feeRate,exitFeeRate:c.limits.feeRate,exitSlippage:.0005}),minimum=profile.level===10?1.2:1.5;
 if(economics.netRewardRisk<minimum)return reject('نسبت خالص در قیمت قابل اجرا '+economics.netRewardRisk.toFixed(2)+' کمتر از '+minimum+' است.');
 const cap=Math.min(budgetTmn,c.wallet.availableTmn*.98,c.wallet.equity*profile.allocation*(plan?.allocationScale||.25),c.wallet.equity*profile.risk/economics.netRisk*entry),amount=Math.floor(cap/(1+c.limits.feeRate));
 if(!Number.isFinite(amount)||amount<Number(c.limits.minSpotNotional))return reject('اندازهٔ مجاز بر اساس سرمایه و ریسک از حداقل سفارش کمتر است.');
 const score=Math.min(94,Math.max(1,45+(plan?.score||0)*5+(q.close>q.ema20?8:0)+(h?.close>h?.ema20?5:0)+Math.min(8,Number(f.volumeRatio||0)*2)-warnings.length*4-Number(c.limits.spreadBps||0)/10));
 return {symbol:c.symbol,score,viable:true,reason:(confirmed?plan.reasons.join('؛ '):'بازیابی پنج‌دقیقه با تأیید قیمت و حجم؛ هدف از مقاومت مشاهده‌شده')+'؛ نسبت خالص '+economics.netRewardRisk.toFixed(2),blockers:[],warnings,economics,order:{side:'buy',price:entry,amountTmn:amount,stopLoss:stop,takeProfit:target}};
}
