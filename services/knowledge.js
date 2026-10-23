import { Router } from 'express';
import { readMarketCatalog } from './market-catalog.js';
import { normalizeCandles, qualityReport, buildDocuments } from './history.js';
import { missingRanges, saveDocuments } from './incremental-history.js';

export function initKnowledge(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS coin_preferences(symbol TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,trade_type TEXT NOT NULL DEFAULT 'margin',notes TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS historical_candles(source TEXT NOT NULL,symbol TEXT NOT NULL,interval_seconds INTEGER NOT NULL,open_time INTEGER NOT NULL,open TEXT NOT NULL,high TEXT NOT NULL,low TEXT NOT NULL,close TEXT NOT NULL,volume TEXT NOT NULL,fetched_at TEXT NOT NULL,PRIMARY KEY(source,symbol,interval_seconds,open_time));
    CREATE TABLE IF NOT EXISTS knowledge_documents(id INTEGER PRIMARY KEY,symbol TEXT NOT NULL,kind TEXT NOT NULL,start_time INTEGER NOT NULL,end_time INTEGER NOT NULL,text TEXT NOT NULL,hash TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(symbol,hash));
    CREATE TABLE IF NOT EXISTS knowledge_vectors(document_id INTEGER NOT NULL,model TEXT NOT NULL,dimensions INTEGER NOT NULL,vector TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(document_id,model),FOREIGN KEY(document_id) REFERENCES knowledge_documents(id));
    CREATE TABLE IF NOT EXISTS knowledge_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,symbol TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,progress INTEGER NOT NULL DEFAULT 0,message TEXT NOT NULL DEFAULT '',report TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
  db.exec(`CREATE TABLE IF NOT EXISTS history_unavailable_ranges(source TEXT NOT NULL,symbol TEXT NOT NULL,from_time INTEGER NOT NULL,to_time INTEGER NOT NULL,retry_after INTEGER NOT NULL,PRIMARY KEY(source,symbol,from_time,to_time));`);
  db.exec('CREATE TABLE IF NOT EXISTS history_dirty_days(symbol TEXT NOT NULL,day INTEGER NOT NULL,PRIMARY KEY(symbol,day));');
  // Interrupted jobs are never silently resumed (especially paid embedding requests).
  db.prepare("UPDATE knowledge_jobs SET status='interrupted',message='سرور هنگام پردازش متوقف شده؛ اجرای مجدد لازم است.' WHERE status IN ('running','queued')").run();
}

export async function embedTexts(config,texts,fetchImpl=fetch) {
  if(config.llm.baseUrl!=='https://ai.boxapi.ir/ai/v1'||!config.llm.apiKey)throw Error('تنظیمات BoxAPI برای embedding کامل نیست.');
  if(texts.some(t=>!t.trim()||t.length>7000))throw Error('طول متن برای embedding معتبر نیست.');
  const response=await fetchImpl(config.llm.baseUrl+'/embeddings',{method:'POST',redirect:'error',signal:AbortSignal.timeout(config.llm.httpTimeoutMs),headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.llm.apiKey}`},body:JSON.stringify({model:config.embedding.model,input:texts,encoding_format:'float'})});
  if(!response.ok){await response.body?.cancel();throw Error(`خطای سرویس embedding (HTTP ${response.status})؛ کلید، اعتبار یا مدل را بررسی کنید.`);}
  const data=await response.json();
  if(!Array.isArray(data.data)||data.data.length!==texts.length)throw Error('تعداد بردارهای دریافتی با متن‌ها برابر نیست.');
  const sorted=[...data.data].sort((a,b)=>a.index-b.index);
  const dimension=config.embedding.model==='text-embedding-3-small'?1536:3072;
  if(sorted.some((v,i)=>v.index!==i||!Array.isArray(v.embedding)||v.embedding.length!==dimension||v.embedding.some(n=>typeof n!=='number'||!Number.isFinite(n))||!v.embedding.some(n=>n!==0)))throw Error('ابعاد یا مقادیر بردار embedding معتبر نیست.');
  return sorted.map(v=>v.embedding);
}

export function createKnowledge(db,config) {
  initKnowledge(db);
  let active=null, stopping=false;
  const eligible=symbol=>readMarketCatalog(db,config.trading).markets.find(m=>m.symbol===symbol);
  function update(id,values) {
    const old=db.prepare('SELECT * FROM knowledge_jobs WHERE id=?').get(id);
    if(!old)return;
    db.prepare('UPDATE knowledge_jobs SET status=?,progress=?,message=?,report=?,updated_at=? WHERE id=?').run(values.status??old.status,values.progress??old.progress,values.message??old.message,values.report?JSON.stringify(values.report):old.report,new Date().toISOString(),id);
  }
  function ensure(id,symbol) {
    if(stopping||active?.cancelled)throw Error('پردازش لغو شد.');
    if(!eligible(symbol))throw Error('این بازار دیگر در فهرست تعهدی تومانی مجاز نیست.');
  }
  async function ingest(id,symbol,days) {
    const to=Math.floor(Date.now()/60000)*60-60,from=to-days*86400+60;
    let rejected=0,duplicates=0,inserted=0,requests=0;
    const existing=db.prepare("SELECT open_time FROM historical_candles WHERE source='wallex' AND symbol=? AND interval_seconds=60 AND open_time BETWEEN ? AND ? ORDER BY open_time").all(symbol,from,to).map(c=>c.open_time);
    const epoch=Math.floor(Date.now()/1000);
    db.prepare('DELETE FROM history_unavailable_ranges WHERE retry_after<=?').run(epoch);
    const suppressed=db.prepare("SELECT from_time AS 'from',to_time AS 'to' FROM history_unavailable_ranges WHERE source='wallex' AND symbol=? AND retry_after>? AND to_time>=? AND from_time<=?").all(symbol,epoch,from,to);
    const windows=missingRanges(existing,from,to,suppressed);
    const touchedDays=new Set(db.prepare('SELECT day FROM history_dirty_days WHERE symbol=?').all(symbol).map(r=>r.day));
    const put=db.prepare('INSERT OR IGNORE INTO historical_candles VALUES(?,?,?,?,?,?,?,?,?,?)');
    for(let index=0;index<windows.length;index++){
      const window=windows[index],cursor=window.from,end=window.to;
      ensure(id,symbol);
      const u=new URL(config.wallex.baseUrl+'/v1/udf/history');u.search=new URLSearchParams({symbol,resolution:'1',from:String(cursor),to:String(end)});
      const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(config.wallex.httpTimeoutMs)});
      requests++;
      if(!r.ok)throw Error(`دریافت تاریخچه ناموفق بود (HTTP ${r.status}).`);
      const normalized=normalizeCandles(await r.json(),cursor,end);ensure(id,symbol);
      rejected+=normalized.rejected;duplicates+=normalized.duplicates;
      const now=new Date().toISOString();
      db.exec('BEGIN');try{
        const dirty=db.prepare('INSERT OR IGNORE INTO history_dirty_days VALUES(?,?)');
        for(const c of normalized.candles){const n=Number(put.run('wallex',symbol,60,c.t,c.o,c.h,c.l,c.c,c.v,now).changes);inserted+=n;if(n){const day=Math.floor(c.t/86400)*86400;touchedDays.add(day);dirty.run(symbol,day);}else duplicates++;}
        const mark=db.prepare("INSERT OR REPLACE INTO history_unavailable_ranges VALUES('wallex',?,?,?,?)");
        for(const gap of missingRanges(normalized.candles.map(c=>c.t),cursor,end))mark.run(symbol,gap.from,gap.to,epoch+(gap.to>=to-3600?300:86400));
        db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
      update(id,{progress:Math.round((index+1)/windows.length*90),message:`${inserted.toLocaleString('fa-IR')} کندل جدید؛ ${existing.length.toLocaleString('fa-IR')} کندل موجود دوباره دانلود نشد.`});
      await new Promise(resolve=>setTimeout(resolve,550));
    }
    ensure(id,symbol);
    const candles=db.prepare("SELECT open_time AS t,open AS o,high AS h,low AS l,close AS c,volume AS v FROM historical_candles WHERE source='wallex' AND symbol=? AND interval_seconds=60 AND open_time BETWEEN ? AND ? ORDER BY open_time").all(symbol,from,to);
    const report={...qualityReport(candles,from,to),rejectedRows:rejected,duplicateRows:duplicates,insertedCandles:inserted,existingCandles:existing.length,networkRequests:requests,suppressedRanges:suppressed.length,source:'wallex',intervalSeconds:60};
    if(!candles.length){update(id,{status:'failed',progress:100,message:'داده‌ای در بازهٔ درخواستی موجود نبود.',report});return;}
    const notes=db.prepare('SELECT notes FROM coin_preferences WHERE symbol=?').get(symbol)?.notes||'';
    // Only rebuild changed days, plus missing documents (e.g. after an interrupted job).
    const storedDays=db.prepare("SELECT DISTINCT CAST(open_time/86400 AS INTEGER)*86400 AS day FROM historical_candles WHERE source='wallex' AND symbol=? AND open_time BETWEEN ? AND ?").all(symbol,from,to);
    for(const {day} of storedDays)if(!db.prepare("SELECT 1 FROM knowledge_documents WHERE symbol=? AND kind='market_day' AND start_time=?").get(symbol,day))touchedDays.add(day);
    let docs=[];
    for(const day of touchedDays){const rows=db.prepare("SELECT open_time AS t,open AS o,high AS h,low AS l,close AS c,volume AS v FROM historical_candles WHERE source='wallex' AND symbol=? AND interval_seconds=60 AND open_time BETWEEN ? AND ? ORDER BY open_time").all(symbol,day,Math.min(day+86340,to));docs.push(...buildDocuments(symbol,rows));}
    docs.push(...buildDocuments(symbol,[],notes));
    let documentChanges;
    db.exec('BEGIN');
    try{
      documentChanges=saveDocuments(db,symbol,docs);
      for(const day of touchedDays)db.prepare('DELETE FROM history_dirty_days WHERE symbol=? AND day=?').run(symbol,day);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    update(id,{status:'completed',progress:100,message:`${inserted.toLocaleString('fa-IR')} کندل جدید · ${existing.length.toLocaleString('fa-IR')} موجود حفظ شد · ${requests} درخواست؛ پوشش ${report.coveragePercent}٪.`,report:{...report,documentsChanged:documentChanges.changed,documentsUnchanged:documentChanges.unchanged}});
  }
  async function embed(id,symbol) {
    const docs=db.prepare('SELECT d.* FROM knowledge_documents d WHERE d.symbol=? AND NOT EXISTS(SELECT 1 FROM knowledge_vectors v WHERE v.document_id=d.id AND v.model=?) ORDER BY d.end_time DESC LIMIT ?').all(symbol,config.embedding.model,config.embedding.maxDocuments);
    if(!docs.length){update(id,{status:'completed',progress:100,message:'همهٔ متن‌ها از قبل بردار دارند؛ هیچ درخواست یا هزینهٔ جدیدی ایجاد نشد.',report:{model:config.embedding.model,documents:0,networkRequests:0}});return;}
    let processed=0;
    for(let i=0;i<docs.length;i+=config.embedding.batchSize){
      ensure(id,symbol);const batch=docs.slice(i,i+config.embedding.batchSize);
      const vectors=await embedTexts(config,batch.map(d=>d.text));ensure(id,symbol);
      const insert=db.prepare('INSERT OR REPLACE INTO knowledge_vectors VALUES(?,?,?,?,?)');
      db.exec('BEGIN');try{batch.forEach((d,index)=>{if(db.prepare('SELECT 1 FROM knowledge_documents WHERE id=? AND hash=?').get(d.id,d.hash))insert.run(d.id,config.embedding.model,vectors[index].length,JSON.stringify(vectors[index]),new Date().toISOString());});db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
      processed+=batch.length;update(id,{progress:Math.round(processed/docs.length*100),message:`${processed}/${docs.length} متن بردارسازی شد.`});
    }
    update(id,{status:'completed',progress:100,message:'بردارهای واقعی با موفقیت در SQLite ذخیره شدند.',report:{model:config.embedding.model,documents:processed}});
  }
  function start(symbol,kind,days) {
    if(active)throw Error('یک پردازش در حال اجراست؛ پس از پایان یا لغو آن دوباره تلاش کنید.');
    if(!eligible(symbol))throw Error('نماد خارج از فهرست تعهدی تومانی مجاز است.');
    const now=new Date().toISOString();
    const result=db.prepare("INSERT INTO knowledge_jobs(symbol,kind,status,created_at,updated_at) VALUES(?,?,'running',?,?)").run(symbol,kind,now,now);
    const id=Number(result.lastInsertRowid);active={id,cancelled:false};
    db.exec("DELETE FROM knowledge_jobs WHERE status NOT IN ('running','queued') AND id NOT IN (SELECT id FROM knowledge_jobs ORDER BY id DESC LIMIT 100)");
    const work=kind==='history'?ingest(id,symbol,days):embed(id,symbol);
    void work.catch(error=>{
      if(stopping)return;
      const safe=/TimeoutError|AbortError/.test(error.name)?'زمان انتظار سرویس پایان یافت؛ داده‌های ثبت‌شده حفظ شدند.':String(error.message).replaceAll(config.llm.apiKey||'__empty__','[hidden]').replaceAll(config.wallex.apiKey||'__empty__','[hidden]').slice(0,350);
      update(id,{status:active?.cancelled?'cancelled':'failed',message:safe});
    }).finally(()=>{active=null;});
    return id;
  }
  const router=Router();
  router.use((req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(!['localhost','127.0.0.1','[::1]'].includes(req.hostname))return res.status(403).json({message:'فقط دسترسی محلی مجاز است.'});
    if(req.method==='POST'&&(!req.is('application/json')||(req.get('origin')&&req.get('origin')!==`http://${req.get('host')}`)))return res.status(403).json({message:'درخواست باید JSON و از همین پنل باشد.'});
    next();
  });
  router.get('/',(_,res)=>{
    const rows=readMarketCatalog(db,config.trading).markets.map(m=>{
      const p=db.prepare('SELECT enabled,trade_type AS tradeType,notes FROM coin_preferences WHERE symbol=?').get(m.symbol)||{enabled:0,tradeType:config.trading.challengeSpotOnly?'spot':'margin',notes:''};
      const stats=db.prepare("SELECT count(*) AS candles,min(open_time) AS first,max(open_time) AS last FROM historical_candles WHERE source='wallex' AND symbol=?").get(m.symbol);
      const docs=db.prepare('SELECT count(*) AS documents FROM knowledge_documents WHERE symbol=?').get(m.symbol);
      const vectors=db.prepare('SELECT count(*) AS vectors FROM knowledge_vectors v JOIN knowledge_documents d ON d.id=v.document_id WHERE d.symbol=? AND v.model=?').get(m.symbol,config.embedding.model);
      return {symbol:m.symbol,name:m.name,base:m.base,spotAvailable:Boolean(m.spotAvailable),...p,tradeType:config.trading.challengeSpotOnly?'spot':p.tradeType,...stats,...docs,...vectors,executionAllowed:false,reviewedExecutionAllowed:config.reviewTrading?.enabled===true};
    });
    const jobs=db.prepare('SELECT * FROM knowledge_jobs ORDER BY id DESC LIMIT 25').all().map(j=>({...j,report:j.report?JSON.parse(j.report):null}));
    const pages=db.prepare('PRAGMA page_count').get().page_count,free=db.prepare('PRAGMA freelist_count').get().freelist_count,size=db.prepare('PRAGMA page_size').get().page_size;
    res.json({coins:rows,jobs,embeddingModel:config.embedding.model,policy:config.trading.challengeSpotOnly?'spot_tmn_only':'margin_tmn_only',activeJob:active?.id||null,storage:{usedBytes:(pages-free)*size,allocatedBytes:pages*size}});
  });
  router.get('/:symbol/plan',(req,res)=>{
    const symbol=req.params.symbol,days=Number(req.query.days||30);
    if(!eligible(symbol)||!Number.isInteger(days)||days<1||days>365)return res.status(400).json({message:'نماد یا بازه معتبر نیست.'});
    const to=Math.floor(Date.now()/60000)*60-60,from=to-days*86400+60;
    const times=db.prepare("SELECT open_time FROM historical_candles WHERE source='wallex' AND symbol=? AND interval_seconds=60 AND open_time BETWEEN ? AND ? ORDER BY open_time").all(symbol,from,to).map(r=>r.open_time);
    const suppressed=db.prepare("SELECT from_time AS 'from',to_time AS 'to' FROM history_unavailable_ranges WHERE source='wallex' AND symbol=? AND retry_after>? AND to_time>=? AND from_time<=?").all(symbol,Math.floor(Date.now()/1000),from,to);
    const windows=missingRanges(times,from,to,suppressed);
    res.json({existingCandles:times.length,requestedCandles:days*1440,newCandidates:windows.reduce((n,r)=>n+(r.to-r.from)/60+1,0),networkRequests:windows.length,deferredGaps:suppressed.length});
  });
  router.post('/:symbol/preferences',(req,res)=>{
    const symbol=req.params.symbol,m=eligible(symbol),{enabled,tradeType,notes}=req.body;
    if(!m)return res.status(400).json({message:'نماد خارج از فهرست مجاز است.'});
    if(active&&db.prepare('SELECT symbol FROM knowledge_jobs WHERE id=?').get(active.id)?.symbol===symbol)return res.status(409).json({message:'تا پایان پردازش این ارز، تغییر یادداشت را ذخیره نکنید.'});
    if(typeof enabled!=='boolean'||!['margin','spot'].includes(tradeType)||typeof notes!=='string'||notes.length>3000)return res.status(400).json({message:'تنظیمات معتبر نیست؛ یادداشت حداکثر ۳۰۰۰ کاراکتر.'});

    if(config.trading.challengeSpotOnly&&tradeType!=='spot')return res.status(400).json({message:'در چالش فقط اسپات بدون اهرم مجاز است.'});
    if(tradeType==='spot'&&!m.spotAvailable)return res.status(400).json({message:'بازار معمولی برای این ارز موجود نیست.'});
    db.exec('BEGIN');
    try {
      db.prepare('INSERT OR REPLACE INTO coin_preferences VALUES(?,?,?,?,?)').run(symbol,Number(enabled),tradeType,notes,new Date().toISOString());
      if(notes.trim())saveDocuments(db,symbol,buildDocuments(symbol,[],notes));
      else{db.prepare("DELETE FROM knowledge_vectors WHERE document_id IN (SELECT id FROM knowledge_documents WHERE symbol=? AND kind='strategy_note')").run(symbol);db.prepare("DELETE FROM knowledge_documents WHERE symbol=? AND kind='strategy_note'").run(symbol);}
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');return res.status(500).json({message:'ذخیرهٔ یادداشت انجام نشد.'});}
    res.json({ok:true,executionAllowed:false,reviewedExecutionAllowed:config.reviewTrading?.enabled===true});
  });
  router.post('/:symbol/jobs',(req,res)=>{
    const {kind,days}=req.body;
    if(!['history','embedding'].includes(kind)||!Number.isInteger(days)||days<1||days>365)return res.status(400).json({message:'نوع عملیات یا بازهٔ ۱ تا ۳۶۵ روز معتبر نیست.'});
    try{res.status(202).json({id:start(req.params.symbol,kind,days)});}catch(e){res.status(409).json({message:e.message});}
  });
  router.post('/jobs/:id/cancel',(req,res)=>{if(active&&active.id===Number(req.params.id))active.cancelled=true;res.json({ok:true});});
  router.get('/:symbol/documents',(req,res)=>{
    if(!eligible(req.params.symbol))return res.status(404).json({message:'نماد مجاز نیست.'});
    const docs=db.prepare('SELECT id,kind,start_time AS start,end_time AS end,text FROM knowledge_documents WHERE symbol=? ORDER BY end_time DESC LIMIT 3').all(req.params.symbol);res.json({documents:docs});
  });
  return {router,stop(){stopping=true;if(active){active.cancelled=true;update(active.id,{status:'interrupted',message:'سرور متوقف شد؛ برای ادامه دوباره عملیات را اجرا کنید.'});}},start};
}
