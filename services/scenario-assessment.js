import {RISK_PROFILES} from './trader-analysis.js';

export function durationOf(b){const n=b.durationMinutes??b.days*1440;if(!Number.isInteger(n)||n<1||n>43200)throw Error('بازه باید بین یک دقیقه و ۳۰ روز باشد.');return n}
// A transparent stress heuristic, NOT a probability model or a price forecast.
export function assessScenario({durationMinutes,risk,targetPercent,symbols,history,previous=[],from,model,promptHash}){
 const p=RISK_PROFILES[risk];if(!p||!Number.isFinite(targetPercent)||targetPercent<=0||targetPercent>100)throw Error('ریسک یا هدف معتبر نیست.');
 const windows=[];let candleCount=0;
 for(const s of symbols){const bars=(history[s]||[]).filter(c=>c.t+60<=from);candleCount+=bars.length;
  const span=Math.min(durationMinutes,1440);for(let i=span;i<bars.length;i+=span){const a=bars[i-span],b=bars[i-1];if(b.t-a.t!==(span-1)*60||a.o<=0)continue;windows.push(Math.abs(b.c/a.o-1)*100*Math.sqrt(durationMinutes/span))}}
 windows.sort((a,b)=>a-b);const move=windows.length?windows[Math.floor((windows.length-1)*.9)]:null;
 const exposure=Math.min(p.maxExposure||2,(1-(p.cashReserve||.15))*p.leverage,symbols.length*p.allocation*p.leverage);
 const roundTrip=.003*exposure*100,benchmark=move===null?null:Math.max(.01,move*exposure-roundTrip),ratio=benchmark===null?null:targetPercent/benchmark;
 let grade=ratio===null?null:Math.max(1,Math.min(10,Math.ceil(2+Math.log2(Math.max(1,ratio))*2)));
 // Short, low-risk, high percentage requests are operationally mismatched even
 // if a previous exceptional candle made the descriptive percentile large.
 if(durationMinutes<=10&&targetPercent>=3&&risk<=1)grade=10;
 if(durationMinutes<=5&&targetPercent>=10)grade=10;
 const excludedFromGoalScore=grade!==null&&grade>=8;
 const cohort=previous.filter(r=>['completed','target_reached','halted'].includes(r.status)&&r.settings.purpose!=='execution_check'&&r.settings.to<=from&&r.settings.risk===risk&&r.settings.model===model&&r.settings.promptHash===promptHash&&(r.settings.durationMinutes??r.settings.days*1440)===durationMinutes&&Math.abs(r.settings.targetPercent-targetPercent)<.001&&[...r.settings.symbols].sort().join() === [...symbols].sort().join()&&!r.settings.assessment?.excludedFromGoalScore).sort((a,b)=>a.settings.from-b.settings.from);
 // Do not count overlapping market windows as independent trials.
 const cases=[];let lastEnd=-Infinity;for(const r of cohort)if(r.settings.from>=lastEnd){cases.push(r);lastEnd=r.settings.to}
 const wins=cases.filter(r=>r.status==='target_reached'&&r.state.equity>=5000000*(1+targetPercent/100)).length,n=cases.length;
 let probability=null;if(n>=20&&!excludedFromGoalScore){const q=wins/n,z=1.96,d=1+z*z/n,center=(q+z*z/(2*n))/d,half=z*Math.sqrt(q*(1-q)/n+z*z/(4*n*n))/d;probability={percent:q*100,low:Math.max(0,center-half)*100,high:Math.min(1,center+half)*100}}
 const reasons=[grade===null?'سابقهٔ کافی برای سنجش دامنه نداریم.':`درجهٔ ناسازگاری هدف ${grade} از ۱۰؛ سنجهٔ توصیفی نوسان گذشته، هزینه و سقف مواجههٔ سطح ریسک است؛ احتمال موفقیت نیست.`,...(durationMinutes<3?['در این افق ممکن است فرصت تصمیم و اجرای کندل بعد وجود نداشته باشد؛ صفر معامله به معنی شکست مدل نیست.']:[]),...(excludedFromGoalScore?['عدم تحقق این هدف از امتیاز هدف‌گیری مدل کنار گذاشته می‌شود؛ زیان، افت و هزینه‌ها حذف نمی‌شوند.']:[]),...(probability?['نرخ تجربی نمونه‌های مستقلِ مشابه همراه بازهٔ ویلسون؛ تضمین یا احتمال کالیبره‌شدهٔ آینده نیست.']:['برای اعلام درصد موفقیت، دست‌کم ۲۰ اجرای کامل، مستقل و مشابه با دادهٔ قبل از شروع لازم است.'])];
 return {version:1,grade,label:grade===null?'شواهد ناکافی':grade>=8?'هدف بسیار نامتناسب':grade>=5?'هدف بلندپروازانه':'ناسازگاری آشکار دیده نشد',excludedFromGoalScore,probability,comparableRuns:n,wins,caseIds:cases.map(r=>r.id),candleCount,sampleWindows:windows.length,referenceMovePercent:move,referenceNetPercent:benchmark,maxExposure:exposure,reasons};
}
