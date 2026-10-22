export function carryCost(p,time,bps){return (p.lots||[{collateral:p.collateral,openedAt:p.openedAt}]).reduce((sum,lot)=>sum+lot.collateral*Math.max(0,p.leverage-1)*bps/10000*Math.max(0,(time-lot.openedAt)/3600),0)}
export function liquidationEquity(state,settings,time){let equity=state.cash;for(const p of Object.values(state.positions)){const quote=state.lastPrices[p.symbol]||p.entry,price=quote*(p.side==='long'?1-settings.slippageBps/10000:1+settings.slippageBps/10000);equity+=p.collateral+(price-p.entry)*p.quantity*(p.side==='long'?1:-1)-p.quantity*price*settings.feeBps/10000-carryCost(p,time,settings.hourlyInterestBps)}return equity}
export function stopRisk(p,price,feeBps){return Math.max(0,(price-p.sl)*(p.side==='long'?1:-1))*p.quantity+p.quantity*price*2*feeBps/10000}
export function additionSize(state,settings,symbol,d,entry,profile){
 const equity=state.equity,old=state.positions[symbol],proposed=old?{...old,sl:d.stopLoss}:null;
 let totalRisk=0,totalExposure=0,groupRisk=0;for(const p of Object.values(state.positions)){const v=p.symbol===symbol?proposed:p,price=state.lastPrices[p.symbol]||p.entry,risk=stopRisk(v,price,settings.feeBps);totalRisk+=risk;totalExposure+=p.quantity*price;const key=[symbol,p.symbol].sort().join(':');const corr=p.symbol===symbol?1:state.correlations?.[key];const direction=d.action==='add'?old.side:d.action;const aligned=(corr??1)*(direction===p.side?1:-1);if(aligned>.8)groupRisk+=risk}
 const ownRisk=proposed?stopRisk(proposed,state.lastPrices[symbol]||entry,settings.feeBps):0;
 const riskRemaining=Math.min(equity*profile.risk-ownRisk,equity*profile.bookRisk-totalRisk,equity*profile.bookRisk*.65-groupRisk);
 const riskPerCollateral=Math.abs(entry-d.stopLoss)/entry*d.leverage+2*d.leverage*(settings.feeBps+settings.slippageBps)/10000;
 return Math.max(0,Math.min(equity*d.allocation,equity*profile.allocation-(old?.collateral||0),state.cash-equity*profile.cashReserve,riskRemaining/riskPerCollateral,(equity*profile.maxExposure-totalExposure)/d.leverage));
}
export function tightenedProtection(p,d,price){if(![d.stopLoss,d.takeProfit].every(n=>Number.isFinite(n)&&n>0))return false;return p.side==='long'?d.stopLoss>=p.sl&&d.stopLoss<price&&d.takeProfit>price:d.stopLoss<=p.sl&&d.stopLoss>price&&d.takeProfit<price}
