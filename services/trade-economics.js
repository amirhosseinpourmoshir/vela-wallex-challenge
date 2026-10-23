// Estimates, not forecasts: entry is the actual adverse-adjusted fill price.
export function tradeEconomics({side,entry,stopLoss,takeProfit,quantity=1,entryCost=0,exitFeeRate=0,exitSlippage=0,funding=0}){
 if(!['long','short','buy'].includes(side)||![entry,stopLoss,takeProfit,quantity].every(n=>Number.isFinite(n)&&n>0)||![entryCost,exitFeeRate,exitSlippage,funding].every(n=>Number.isFinite(n)&&n>=0)||exitFeeRate>=1||exitSlippage>=1)throw Error('دادهٔ محاسبهٔ سود خالص معتبر نیست.');
 const sign=side==='short'?-1:1,adjust=1-sign*exitSlippage;
 const net=raw=>{const fill=raw*adjust;return (fill-entry)*quantity*sign-entryCost-fill*quantity*exitFeeRate-funding};
 const targetNet=net(takeProfit),stopNet=net(stopLoss),netRisk=Math.max(0,-stopNet);
 const breakEvenPrice=(entry*sign+(entryCost+funding)/quantity)/(adjust*(sign-exitFeeRate));
 return {targetNet,stopNet,netRisk,netRewardRisk:netRisk>0?targetNet/netRisk:null,breakEvenPrice,stopLocksProfit:stopNet>0,entryCost,funding};
}
export function requireNetEdge(plan,minimum=1.5){if(!Number.isFinite(minimum)||minimum<1||minimum>3)throw Error('حداقل نسبت نامعتبر است.');const result=tradeEconomics(plan);const sign=plan.side==='short'?-1:1;if((plan.entry-plan.stopLoss)*sign<=0||(plan.takeProfit-plan.entry)*sign<=0||result.targetNet<=0||result.netRisk<=0||result.netRewardRisk<minimum)throw Error('سود خالص هدف یا نسبت سود به زیان خالص پس از هزینه‌ها کافی نیست؛ حداقل نسبت: '+minimum+'.');return result;}
