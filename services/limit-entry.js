export function validateLimitEntry(d,time,end){
 if(d.entryType!==undefined&&!['market','limit'].includes(d.entryType))throw Error('نوع ورود معتبر نیست.');
 if(d.entryType!=='limit')return null;
 if(!Number.isFinite(d.entryPrice)||d.entryPrice<=0||!Number.isInteger(d.validForMinutes)||d.validForMinutes<1||d.validForMinutes>1440)throw Error('سفارش محدود به قیمت مثبت و اعتبار ۱ تا ۱۴۴۰ دقیقه نیاز دارد.');
 return {limit:d.entryPrice,expiresAt:Math.min(end,time+d.validForMinutes*60)};
}
export function limitFill(side,limit,candle,slippage=0){
 if(side==='long'){if(candle.l>limit)return null;const atOpen=candle.o<=limit;return {price:Math.min(limit,(atOpen?candle.o:limit)*(1+slippage)),atOpen}}
 if(side==='short'){if(candle.h<limit)return null;const atOpen=candle.o>=limit;return {price:Math.max(limit,(atOpen?candle.o:limit)*(1-slippage)),atOpen}}
 throw Error('جهت سفارش محدود معتبر نیست.');
}
