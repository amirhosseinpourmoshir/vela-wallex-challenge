import { createHash } from 'node:crypto';

export function normalizeCandles(data, from, to) {
  if (data.s === 'no_data') return { candles: [], rejected: 0, duplicates: 0 };
  if (data.s !== 'ok' || !['t','o','h','l','c','v'].every(k=>Array.isArray(data[k])&&data[k].length===data.t.length)) throw new Error('ساختار OHLCV منبع معتبر نیست.');
  const unique = new Map(); let rejected=0, duplicates=0;
  for(let i=0;i<data.t.length;i++) {
    const t=Number(data.t[i]); const values=['o','h','l','c','v'].map(k=>Number(data[k][i]));
    const [o,h,l,c,v]=values;
    if(!Number.isSafeInteger(t)||t%60!==0||t<from||t>to||!values.every(Number.isFinite)||Math.min(o,h,l,c)<=0||v<0||h<Math.max(o,c)||l>Math.min(o,c)||h<l){rejected++;continue;}
    if(unique.has(t)) duplicates++;
    unique.set(t,{t,o:String(data.o[i]),h:String(data.h[i]),l:String(data.l[i]),c:String(data.c[i]),v:String(data.v[i])});
  }
  const candles=[...unique.values()].sort((a,b)=>a.t-b.t);
  // Request is explicitly native one-minute data. Other intervals must not be mislabeled.
  if(candles.length>1&&!candles.slice(1).some((c,i)=>c.t-candles[i].t===60)) throw new Error('فاصلهٔ دادهٔ دریافتی یک‌دقیقه‌ای تأیید نشد؛ از ذخیره با برچسب اشتباه جلوگیری شد.');
  return {candles,rejected,duplicates};
}

export function qualityReport(candles, from, to) {
  const expected=Math.max(0,Math.floor((to-from)/60)+1);
  return {requestedFrom:from,requestedTo:to,expectedCandles:expected,actualCandles:candles.length,coveragePercent:expected?Number((candles.length/expected*100).toFixed(2)):0,first: candles[0]?.t??null,last:candles.at(-1)?.t??null,missingCandles:Math.max(0,expected-candles.length),complete:expected===candles.length};
}

export function buildDocuments(symbol,candles,strategyNotes='') {
  const days=new Map();
  for(const c of candles){const day=new Date(c.t*1000).toISOString().slice(0,10);if(!days.has(day))days.set(day,[]);days.get(day).push(c);}
  const docs=[];
  for(const [day,rows] of days){
    const start=Date.parse(day+'T00:00:00Z')/1000;
    const hours=new Map();for(const c of rows){const hour=Math.floor(c.t/3600)*3600;if(!hours.has(hour))hours.set(hour,[]);hours.get(hour).push(c);}
    const high=Math.max(...rows.map(c=>Number(c.h))), low=Math.min(...rows.map(c=>Number(c.l)));
    const text=[`Source: Wallex official historical OHLCV. Symbol: ${symbol}. Quote: TMN (Iranian toman, NOT rial).`,
      `Historical evidence for UTC day ${day}; available only after ${new Date((rows.at(-1).t+60)*1000).toISOString()}.`,
      `Native timeframe: 60 seconds. Observed ${rows.length}/1440 minute candles. Missing candles are not fabricated.`,
      `Observed open=${rows[0].o}; high=${high}; low=${low}; close=${rows.at(-1).c}. These are historical extremes, NOT predicted support/resistance or recommended stops.`,
      `Observed return=${((Number(rows.at(-1).c)/Number(rows[0].o)-1)*100).toFixed(4)}%. Volume is base-asset volume.`,
      'Hourly aggregates from observed candles only (UTC hour; open, high, low, close, volume; observed count/60):',
      ...[...hours].map(([hour,group])=>`${new Date(hour*1000).toISOString().slice(11,16)}; ${group[0].o},${Math.max(...group.map(c=>Number(c.h)))},${Math.min(...group.map(c=>Number(c.l)))},${group.at(-1).c},${group.reduce((s,c)=>s+Number(c.v),0).toPrecision(10)}; ${group.length}/60`),
      'Data is descriptive evidence for retrieval, not training of model weights or a trading signal. Source does not contain order-book history, funding fees or liquidation events.'
    ].join('\n');
    docs.push({kind:'market_day',start, end:rows.at(-1).t+60,text,hash:createHash('sha256').update(text).digest('hex')});
  }
  if(strategyNotes.trim()){
    const text=`Symbol: ${symbol}. User-provided strategy notes, unverified and not exchange market data.\n${strategyNotes.trim()}\nThese instructions have not been backtested or approved for live trading.`;
    docs.push({kind:'strategy_note',start:0,end:Math.floor(Date.now()/1000),text,hash:createHash('sha256').update(text).digest('hex')});
  }
  return docs;
}
