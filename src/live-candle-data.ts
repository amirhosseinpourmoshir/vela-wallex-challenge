import Decimal from 'decimal.js';
export type LiveBar={t:number;o:number;h:number;l:number;c:number;v:number;closed:boolean};
export function parseCandleUpdate(d:any,seconds:number,now:number):LiveBar[]{
 if(d?.s!=='ok'||!['t','o','h','l','c','v'].every(k=>Array.isArray(d[k])&&d[k].length===d.t.length))return [];
 return d.t.flatMap((_:unknown,i:number)=>{const [t,o,h,l,c,v]=['t','o','h','l','c','v'].map(k=>Number(d[k][i]));return Number.isSafeInteger(t)&&t%seconds===0&&t<=now&&[o,h,l,c,v].every(Number.isFinite)&&Math.min(o,h,l,c)>0&&v>=0&&h>=Math.max(o,c)&&l<=Math.min(o,c)?[{t,o,h,l,c,v,closed:t+seconds<=now}]:[]});
}
export function mergeCandleUpdates(base:LiveBar[],updates:LiveBar[]){const rows=new Map(base.map(b=>[b.t,b]));for(const b of updates)rows.set(b.t,b);return [...rows.values()].sort((a,b)=>a.t-b.t).slice(-6500)}
export function displayCandles(base:LiveBar[],seconds:number,baseSeconds:number,now:number):LiveBar[]{
 if(seconds===baseSeconds)return base.map(b=>({...b,closed:b.t+seconds<=now}));
 const groups=new Map<number,LiveBar[]>();for(const b of base){const t=Math.floor(b.t/seconds)*seconds;if(!groups.has(t))groups.set(t,[]);groups.get(t)!.push(b)}
 return [...groups].filter(([t,bars])=>t+seconds>now||bars.length===seconds/baseSeconds).map(([t,bars])=>({t,o:bars[0].o,h:Math.max(...bars.map(b=>b.h)),l:Math.min(...bars.map(b=>b.l)),c:bars.at(-1)!.c,v:bars.reduce((sum,b)=>sum.plus(b.v),new Decimal(0)).toNumber(),closed:t+seconds<=now}));
}
