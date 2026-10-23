export function executionContext(settings,asOf){
 const feeBps=settings.feeBps,slippageBps=settings.slippageBps,hourlyInterestBps=settings.hourlyInterestBps;
 return {simulation:true,feeBpsPerSide:feeBps,adverseSlippageBpsPerSide:slippageBps,hourlyInterestBpsOnBorrowed:hourlyInterestBps,roundTripApproxPercent:2*(feeBps+slippageBps)/100,remainingMinutes:Math.max(0,(settings.to-asOf)/60),fill:'market: next candle open with adverse slippage; limit: price touch, fill at limit or better, no queue simulation; stop first, no same-bar TP credit for an intrabar limit entry',liquidation:'not modeled exactly',note:'Known simulator assumptions, not verified exchange tariffs. Financing depends on actual holding time and leverage; leverage amplifies both returns and costs.'};
}
export function opportunityContext(history,features,asOf,remainingMinutes,execution){
 const bars=history.filter(c=>c.t+60<=asOf).slice(-60),last=bars.at(-1);if(!last)return {available:false};
 const low=Math.min(...bars.map(b=>b.l)),high=Math.max(...bars.map(b=>b.h)),atr=features['300']?.atr14;
 const rangePercent=(high/low-1)*100,atrPercent=Number.isFinite(atr)?atr/last.c*100:null;
 return {available:true,lookbackMinutes:60,closedCandles:bars.length,activeCandles:bars.filter(b=>b.v>0).length,recentRangePercent:rangePercent,atr5mPercent:atrPercent,roundTripApproxPercent:execution.roundTripApproxPercent,rangeToCost:rangePercent/execution.roundTripApproxPercent,remainingMinutes,note:'Past range and ATR are descriptive, not forecast bounds. Costs and absence of activity must inform an entry; a future move can exceed past range.'};
}
export function materiallyChanged(board,lastReviewPrices={},roundTripPercent=.3){
 return Object.entries(board).some(([symbol,b])=>{if(b.watch.kinds?.includes('position-risk'))return true;const old=lastReviewPrices[symbol];if(!old)return true;const movement=Math.abs(b.price/old-1)*100,threshold=Math.max(.025,roundTripPercent*.25,(b.watch.atrPercent||0)*.5);return movement>=threshold||b.watch.kinds?.includes('regime')||b.watch.kinds?.some(k=>k.startsWith('break-'))&&b.watch.score>=3});
}
