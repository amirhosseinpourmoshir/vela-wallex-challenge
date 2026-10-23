import {Router} from 'express';
import {analyze} from './trader-analysis.js';
import {inspectMarket,wakePolicy} from './market-watcher.js';
import {normalizeCandles} from './history.js';
import {missingRanges} from './incremental-history.js';

// This scheduler may prepare drafts. It has no exchange order/approval capability.
export function createReviewMonitor(db,{scope,eligible,propose,expire,orders,invalidate,clock=()=>Date.now(),publish=()=>{},fetchImpl=fetch,config,autoSchedule=true,syncHistory=true,prepareStart=null,executeAutomatic=null}){
 db.exec(`CREATE TABLE IF NOT EXISTS live_review_sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,scope TEXT NOT NULL,status TEXT NOT NULL,settings TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS history_dirty_days(symbol TEXT NOT NULL,day INTEGER NOT NULL,PRIMARY KEY(symbol,day));
 CREATE TABLE IF NOT EXISTS live_review_events(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id INTEGER NOT NULL,time INTEGER NOT NULL,kind TEXT NOT NULL,message TEXT NOT NULL,payload TEXT);`);
 const router=Router();let stopped=false,busy=false,controller=null,lastSync=0,starting=false,generation=0;
 const decode=r=>r?{...r,scope:undefined,settings:JSON.parse(r.settings),state:JSON.parse(r.state)}:null;
 const latest=()=>decode(db.prepare('SELECT * FROM live_review_sessions WHERE scope=? ORDER BY id DESC LIMIT 1').get(scope));
 const current=id=>!stopped&&db.prepare("SELECT 1 FROM live_review_sessions WHERE id=? AND scope=? AND status='watching'").get(id,scope);
 function event(id,kind,message,payload){db.prepare('INSERT INTO live_review_events(session_id,time,kind,message,payload) VALUES(?,?,?,?,?)').run(id,clock(),kind,message,payload?JSON.stringify(payload):null)}
 function snapshot(){const session=latest();return {session,events:session?db.prepare('SELECT time,kind,message,payload FROM live_review_events WHERE session_id=? ORDER BY id DESC LIMIT 50').all(session.id).map(e=>({...e,payload:e.payload?JSON.parse(e.payload):null})):[]}}
 function save(s){if(!current(s.id))return;db.prepare('UPDATE live_review_sessions SET state=?,updated_at=? WHERE id=?').run(JSON.stringify(s.state),clock(),s.id);publish({type:'live_monitor_update',...snapshot()})}
 function history(symbol,asOf){return db.prepare("SELECT open_time AS t,CAST(open AS REAL) AS o,CAST(high AS REAL) AS h,CAST(low AS REAL) AS l,CAST(close AS REAL) AS c,CAST(volume AS REAL) AS v FROM historical_candles WHERE source='wallex' AND interval_seconds=60 AND symbol=? AND open_time>=? AND open_time+60<=? ORDER BY open_time").all(symbol,asOf-14*86400,asOf)}
 async function sync(symbol,signal){
  const to=Math.floor(clock()/60000)*60-60,from=to-5*86400+60;
  const times=db.prepare("SELECT open_time FROM historical_candles WHERE source='wallex' AND symbol=? AND interval_seconds=60 AND open_time BETWEEN ? AND ? ORDER BY open_time").all(symbol,from,to).map(r=>r.open_time);
  const latest=db.prepare("SELECT MAX(open_time) AS t FROM historical_candles WHERE source='wallex' AND symbol=? AND interval_seconds=60 AND open_time<=?").get(symbol,to).t;
  const tailFrom=latest==null?from:latest+60;
  // Fetch every newly closed minute since the last stored candle. Older holes
  // are bounded separately so they cannot displace the current market tail.
  const tail=missingRanges([],tailFrom,to).reverse();
  const backfill=missingRanges(times,from,to).filter(w=>w.to<tailFrom).sort((a,b)=>b.from-a.from).slice(0,2);
  const windows=[...tail,...backfill];
  for(const window of windows){signal.throwIfAborted();const url=new URL(config.wallex.baseUrl+'/v1/udf/history');url.search=new URLSearchParams({symbol,resolution:'1',from:String(window.from),to:String(window.to)});
   const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(config.wallex.httpTimeoutMs)])});if(!response.ok)throw Error('تاریخچهٔ تازه دریافت نشد.');const data=normalizeCandles(await response.json(),window.from,window.to);signal.throwIfAborted();
   const put=db.prepare('INSERT OR IGNORE INTO historical_candles VALUES(?,?,?,?,?,?,?,?,?,?)');db.exec('SAVEPOINT live_history');try{for(const c of data.candles){const inserted=put.run('wallex',symbol,60,c.t,c.o,c.h,c.l,c.c,c.v,new Date(clock()).toISOString());if(inserted.changes)db.prepare('INSERT OR IGNORE INTO history_dirty_days VALUES(?,?)').run(symbol,Math.floor(c.t/86400)*86400);}db.exec('RELEASE live_history')}catch(e){db.exec('ROLLBACK TO live_history');db.exec('RELEASE live_history');throw e}
  }
 }
 async function tick(){if(stopped||busy)return;expire();const s=latest();if(!s||s.status!=='watching')return;if(s.settings.executionMode==='automatic'&&clock()>=s.settings.automatic.expiresAt){db.prepare("UPDATE live_review_sessions SET status='expired',updated_at=? WHERE id=?").run(clock(),s.id);invalidate(s.id,'مجوز اجرای خودکار منقضی شد.');event(s.id,'authorization_expired','مجوز خودکار تمام شد؛ سفارش تازه ارسال نمی‌شود و موقعیت‌های باز خودکار بسته نمی‌شوند.');publish({type:'live_monitor_update',...snapshot()});return}busy=true;controller=new AbortController();const signal=controller.signal;
  try{
   const allowed=eligible().map(m=>m.symbol),symbols=s.settings.symbols.filter(x=>allowed.includes(x));
   if(!symbols.length)throw Error('همهٔ ارزهای جلسه غیرفعال شده‌اند؛ جلسه را با بازارهای فعال دوباره شروع کنید.');
   s.state.phase='scanning';save(s);
   if(syncHistory&&clock()-lastSync>=60000){lastSync=clock();s.state.phase='syncing';save(s);for(const symbol of symbols){try{await sync(symbol,signal)}catch(e){if(signal.aborted)throw e;event(s.id,'data_warning',`${symbol}: دریافت تاریخچه ناموفق؛ فقط دادهٔ معتبر بررسی می‌شود.`)}}}
   if(!current(s.id))return;
   const asOf=Math.floor(clock()/1000),assets={},ready=[];
   for(const symbol of symbols){const rows=history(symbol,asOf),features=analyze(rows,asOf),previous=s.state.assets?.[symbol];const watch=inspectMarket(rows,features,asOf,previous?.state||{});const fresh=rows.length>0&&asOf-(rows.at(-1).t+60)<=180;assets[symbol]={...watch,features,fresh,lastPrice:rows.at(-1)?.c||null};if(watch.ready&&fresh)ready.push({symbol,watch})}
   s.state.assets=assets;s.state.scans=(s.state.scans||0)+symbols.length;s.state.lastScanAt=clock();
   const pending=orders().filter(o=>o.status==='draft'&&o.quote.monitorSessionId===s.id);
   if(pending.length&&s.settings.executionMode==='automatic'){const order=await executeAutomatic(s,pending[0]);if(current(s.id)){s.state.phase='watching';s.state.message='سفارش با مجوز خودکار ارسال شد؛ وضعیت اجرا از صرافی پیگیری می‌شود.';event(s.id,'automatic_submitted',s.state.message,{orderId:order.id});save(s)}return}
   if(pending.length){s.state.phase='waiting_approval';s.state.message='پیشنهاد در انتظار تأیید شماست؛ پایان مهلت فقط آن را منقضی می‌کند.';save(s);return}
   if(!ready.length){s.state.phase='waiting_data';s.state.message='کندل بستهٔ کافی و تازه نداریم؛ همگام‌سازی افزایشی ادامه دارد.';save(s);return}
   const candidate=ready.sort((a,b)=>b.watch.score-a.watch.score)[0],last=s.state.lastReview||0;
   const wake=wakePolicy({asOf,lastReview:last,lastGlobalReview:last,lastFingerprint:s.state.lastFingerprint||'',fingerprint:candidate.watch.fingerprint,score:candidate.watch.score,bootstrap:!last,horizonMinutes:60});
   if(!wake.wake){s.state.phase='watching';s.state.suppressed=(s.state.suppressed||0)+1;s.state.message='دیده‌بان فعال است؛ پالس تازه یا موعد بازبینی بعدی را بررسی می‌کند.';save(s);return}
   s.state.lastReview=asOf;s.state.lastFingerprint=candidate.watch.fingerprint;s.state.phase='analyzing';s.state.message='مدل بازارها و پوزیشن‌ها را بررسی می‌کند؛ هنوز سفارش ارسال نمی‌شود.';save(s);event(s.id,'model_called','فراخوانی مدل برای بازبینی',{trigger:wake.reason,symbol:candidate.symbol,signals:candidate.watch.reasons});
   const result=await propose({...s.settings,autoSelect:true,symbols,monitorSessionId:s.id,trigger:{reason:wake.reason,symbol:candidate.symbol,signals:candidate.watch.reasons}},{signal,isCurrent:()=>!!current(s.id)});
   if(!current(s.id))return;s.state.reviews=(s.state.reviews||0)+1;if(!result.hold&&s.settings.executionMode==='automatic'){const order=await executeAutomatic(s,result);if(current(s.id)){s.state.phase='watching';s.state.message='سفارش با مجوز محدود خودکار ارسال شد؛ بدون نیاز به تأیید جداگانه.';event(s.id,'automatic_submitted',s.state.message,{orderId:order.id,reviewId:result.reviewId});save(s)}return}s.state.phase=result.hold?'watching':'waiting_approval';s.state.message=result.hold?result.reason:'پیشنهاد مدل آماده است؛ فقط با تأیید شما ارسال می‌شود.';
   event(s.id,result.hold?'hold':'proposal',result.hold?result.reason:result.quote.reason,{orderId:result.id||null,reviewId:result.reviewId||null});save(s);
  }catch(e){if(current(s.id)){s.state.phase=s.settings.executionMode==='automatic'?'execution_blocked':'waiting_data';s.state.message=String(e.message||'بازبینی ناموفق بود.').replaceAll(config.llm?.apiKey||'__no_key__','[hidden]').replaceAll(config.wallex.apiKey||'__no_wallet_key__','[hidden]').slice(0,500);event(s.id,'review_error',s.state.message);s.state.lastReview=Math.floor(clock()/1000);save(s)}}finally{busy=false;controller=null}
 }
 router.get('/',(_,res)=>res.json(snapshot()));
 router.post('/start',async(req,res)=>{if(starting)return res.status(409).json({message:'شروع جلسه در حال بررسی است.'});starting=true;const startGeneration=generation;try{
  if(config.reviewTrading?.enabled===false)throw Error('پایش پیشنهادهای واقعی در تنظیمات غیرفعال است.');
  const b=req.body,symbols=b.symbols,allowed=eligible().map(m=>m.symbol);
  if(!Array.isArray(symbols)||!symbols.length||symbols.length>30||new Set(symbols).size!==symbols.length||symbols.some(s=>!allowed.includes(s)))throw Error('ارزهای جلسه باید فعال و مجاز باشند.');
  const amountTmn=Number(b.amountTmn),riskLevel=Number(b.riskLevel),maxAllocationPercent=Number(b.maxAllocationPercent??30),approvalSeconds=Number(b.approvalSeconds??60);
  if(!Number.isFinite(amountTmn)||amountTmn<=0||!Number.isInteger(riskLevel)||riskLevel<1||riskLevel>10||!Number.isFinite(maxAllocationPercent)||maxAllocationPercent<=0||maxAllocationPercent>50||!Number.isInteger(approvalSeconds)||approvalSeconds<15||approvalSeconds>300||!['auto','spot','margin'].includes(b.kind))throw Error('بودجه، ریسک، نوع معامله یا مهلت تأیید معتبر نیست.');
  if(latest()?.status==='watching')return res.status(409).json({message:'یک جلسهٔ پایش فعال است؛ ابتدا همان جلسه را قطع کنید.'});
  if(b.executionMode!==undefined&&!['review','automatic'].includes(b.executionMode))throw Error('حالت اجرا معتبر نیست.');
  const settings={symbols,amountTmn,riskLevel,maxAllocationPercent,approvalSeconds,kind:b.kind,executionMode:b.executionMode||'review'};if(settings.executionMode==='automatic'){if(!prepareStart||!executeAutomatic)throw Error('اجرای خودکار در این سرویس پشتیبانی نمی‌شود.');settings.automatic=await prepareStart(settings,b);if(!settings.automatic)throw Error('مجوز خودکار ایجاد نشد.')}if(stopped||generation!==startGeneration)throw Error('شروع جلسه لغو شد.');if(latest()?.status==='watching')throw Error('جلسهٔ دیگری شروع شده است.');const state={phase:'watching',message:'جلسه آماده است؛ آغاز پایش بازار بدون ارسال سفارش.',scans:0,reviews:0,suppressed:0,assets:{}};
  const id=Number(db.prepare("INSERT INTO live_review_sessions(scope,status,settings,state,created_at,updated_at) VALUES(?,'watching',?,?,?,?)").run(scope,JSON.stringify(settings),JSON.stringify(state),clock(),clock()).lastInsertRowid);event(id,'started',state.message);lastSync=0;publish({type:'live_monitor_update',...snapshot()});res.json(snapshot());
 }catch(e){res.status(400).json({message:e.message})}finally{starting=false}});
 router.post('/stop',(_,res)=>{generation++;const s=latest();if(s?.status==='watching'){db.prepare("UPDATE live_review_sessions SET status='stopped',updated_at=? WHERE id=?").run(clock(),s.id);controller?.abort();invalidate(s.id,'جلسه توسط کاربر قطع شد؛ پیشنهاد تأییدنشده رد شد.');event(s.id,'stopped','پایش مدل قطع شد؛ هیچ موقعیت صرافی با قطع پایش بسته نمی‌شود.');publish({type:'live_monitor_update',...snapshot()})}res.json(snapshot())});
 const timer=autoSchedule?setInterval(()=>void tick(),5000):null;timer?.unref();
 return {router,tick,snapshot,syncHistory:sync,stop(){stopped=true;controller?.abort();if(timer)clearInterval(timer)}};
}
