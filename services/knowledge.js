import { Router } from 'express';
import { readMarketCatalog } from './market-catalog.js';
import { normalizeCandles, qualityReport, buildDocuments } from './history.js';

export function initKnowledge(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS coin_preferences(symbol TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,trade_type TEXT NOT NULL DEFAULT 'margin',notes TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS historical_candles(source TEXT NOT NULL,symbol TEXT NOT NULL,interval_seconds INTEGER NOT NULL,open_time INTEGER NOT NULL,open TEXT NOT NULL,high TEXT NOT NULL,low TEXT NOT NULL,close TEXT NOT NULL,volume TEXT NOT NULL,fetched_at TEXT NOT NULL,PRIMARY KEY(source,symbol,interval_seconds,open_time));
    CREATE TABLE IF NOT EXISTS knowledge_documents(id INTEGER PRIMARY KEY,symbol TEXT NOT NULL,kind TEXT NOT NULL,start_time INTEGER NOT NULL,end_time INTEGER NOT NULL,text TEXT NOT NULL,hash TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(symbol,hash));
    CREATE TABLE IF NOT EXISTS knowledge_vectors(document_id INTEGER NOT NULL,model TEXT NOT NULL,dimensions INTEGER NOT NULL,vector TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(document_id,model),FOREIGN KEY(document_id) REFERENCES knowledge_documents(id));
    CREATE TABLE IF NOT EXISTS knowledge_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT,symbol TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,progress INTEGER NOT NULL DEFAULT 0,message TEXT NOT NULL DEFAULT '',report TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
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
  const eligible=symbol=>readMarketCatalog(db).markets.find(m=>m.symbol===symbol);
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
    let rejected=0,duplicates=0;
    const put=db.prepare('INSERT OR REPLACE INTO historical_candles VALUES(?,?,?,?,?,?,?,?,?,?)');
    // Verified one-day windows: larger UDF requests silently truncate in practice.
    for(let cursor=from;cursor<=to;cursor+=86400){
      ensure(id,symbol);const end=Math.min(to,cursor+86400-60);
      const u=new URL(config.wallex.baseUrl+'/v1/udf/history');u.search=new URLSearchParams({symbol,resolution:'1',from:String(cursor),to:String(end)});
      const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(config.wallex.httpTimeoutMs)});
      if(!r.ok)throw Error(`دریافت تاریخچه ناموفق بود (HTTP ${r.status}).`);
      const normalized=normalizeCandles(await r.json(),cursor,end);ensure(id,symbol);
      rejected+=normalized.rejected;duplicates+=normalized.duplicates;
      const now=new Date().toISOString();
      db.exec('BEGIN');try{for(const c of normalized.candles)put.run('wallex',symbol,60,c.t,c.o,c.h,c.l,c.c,c.v,now);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
      update(id,{progress:Math.min(90,Math.round((end-from)/(to-from)*90)),message:'دریافت و اعتبارسنجی کندل‌های بسته‌شده…'});
      await new Promise(resolve=>setTimeout(resolve,550));
    }
    ensure(id,symbol);
    const candles=db.prepare("SELECT open_time AS t,open AS o,high AS h,low AS l,close AS c,volume AS v FROM historical_candles WHERE source='wallex' AND symbol=? AND interval_seconds=60 AND open_time BETWEEN ? AND ? ORDER BY open_time").all(symbol,from,to);
    const report={...qualityReport(candles,from,to),rejectedRows:rejected,duplicateRows:duplicates,source:'wallex',intervalSeconds:60};
    if(!candles.length){update(id,{status:'failed',progress:100,message:'داده‌ای در بازهٔ درخواستی موجود نبود.',report});return;}
    const notes=db.prepare('SELECT notes FROM coin_preferences WHERE symbol=?').get(symbol)?.notes||'';
    const documentCandles=db.prepare("SELECT open_time AS t,open AS o,high AS h,low AS l,close AS c,volume AS v FROM historical_candles WHERE source='wallex' AND symbol=? AND interval_seconds=60 AND open_time BETWEEN ? AND ? ORDER BY open_time").all(symbol,Math.floor(from/86400)*86400,to);
    const docs=buildDocuments(symbol,documentCandles,notes);
    const insert=db.prepare('INSERT OR IGNORE INTO knowledge_documents(symbol,kind,start_time,end_time,text,hash,created_at) VALUES(?,?,?,?,?,?,?)');
    db.exec('BEGIN');
    try{
      for(const doc of docs){
        const previous=db.prepare('SELECT id,hash FROM knowledge_documents WHERE symbol=? AND kind=? AND start_time=?').all(symbol,doc.kind,doc.start);
        for(const old of previous)if(old.hash!==doc.hash){db.prepare('DELETE FROM knowledge_vectors WHERE document_id=?').run(old.id);db.prepare('DELETE FROM knowledge_documents WHERE id=?').run(old.id);}
        insert.run(symbol,doc.kind,doc.start,doc.end,doc.text,doc.hash,new Date().toISOString());
      }
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    update(id,{status:'completed',progress:100,message:`${candles.length.toLocaleString('fa-IR')} کندل معتبر و ${docs.length.toLocaleString('fa-IR')} متن آماده شد؛ پوشش ${report.coveragePercent}٪.`,report:{...report,documents:docs.length}});
  }
  async function embed(id,symbol) {
    const docs=db.prepare('SELECT d.* FROM knowledge_documents d WHERE d.symbol=? AND NOT EXISTS(SELECT 1 FROM knowledge_vectors v WHERE v.document_id=d.id AND v.model=?) ORDER BY d.end_time DESC LIMIT ?').all(symbol,config.embedding.model,config.embedding.maxDocuments);
    if(!docs.length)throw Error('متن جدیدی برای بردارسازی وجود ندارد؛ ابتدا تاریخچه را آماده کنید.');
    let processed=0;
    for(let i=0;i<docs.length;i+=config.embedding.batchSize){
      ensure(id,symbol);const batch=docs.slice(i,i+config.embedding.batchSize);
      const vectors=await embedTexts(config,batch.map(d=>d.text));ensure(id,symbol);
      const insert=db.prepare('INSERT OR REPLACE INTO knowledge_vectors VALUES(?,?,?,?,?)');
      db.exec('BEGIN');try{batch.forEach((d,index)=>insert.run(d.id,config.embedding.model,vectors[index].length,JSON.stringify(vectors[index]),new Date().toISOString()));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
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
    const rows=readMarketCatalog(db).markets.map(m=>{
      const p=db.prepare('SELECT enabled,trade_type AS tradeType,notes FROM coin_preferences WHERE symbol=?').get(m.symbol)||{enabled:0,tradeType:'margin',notes:''};
      const stats=db.prepare("SELECT count(*) AS candles,min(open_time) AS first,max(open_time) AS last FROM historical_candles WHERE source='wallex' AND symbol=?").get(m.symbol);
      const docs=db.prepare('SELECT count(*) AS documents FROM knowledge_documents WHERE symbol=?').get(m.symbol);
      const vectors=db.prepare('SELECT count(*) AS vectors FROM knowledge_vectors v JOIN knowledge_documents d ON d.id=v.document_id WHERE d.symbol=? AND v.model=?').get(m.symbol,config.embedding.model);
      return {symbol:m.symbol,name:m.name,base:m.base,spotAvailable:Boolean(m.spotAvailable),...p,...stats,...docs,...vectors,executionAllowed:false};
    });
    const jobs=db.prepare('SELECT * FROM knowledge_jobs ORDER BY id DESC LIMIT 25').all().map(j=>({...j,report:j.report?JSON.parse(j.report):null}));
    res.json({coins:rows,jobs,embeddingModel:config.embedding.model,policy:'margin_tmn_only',activeJob:active?.id||null});
  });
  router.post('/:symbol/preferences',(req,res)=>{
    const symbol=req.params.symbol,m=eligible(symbol),{enabled,tradeType,notes}=req.body;
    if(!m)return res.status(400).json({message:'نماد خارج از فهرست مجاز است.'});
    if(typeof enabled!=='boolean'||!['margin','spot'].includes(tradeType)||typeof notes!=='string'||notes.length>3000)return res.status(400).json({message:'تنظیمات معتبر نیست؛ یادداشت حداکثر ۳۰۰۰ کاراکتر.'});
    if(enabled&&tradeType!=='margin')return res.status(400).json({message:'طبق سیاست فعلی، فعال‌سازی مشارکت فقط برای تعهدی تومانی مجاز است؛ معمولی فقط برای پژوهش ذخیره می‌شود.'});
    if(tradeType==='spot'&&!m.spotAvailable)return res.status(400).json({message:'بازار معمولی برای این ارز موجود نیست.'});
    db.exec('BEGIN');
    try {
      db.prepare('INSERT OR REPLACE INTO coin_preferences VALUES(?,?,?,?,?)').run(symbol,Number(enabled),tradeType,notes,new Date().toISOString());
      db.prepare("DELETE FROM knowledge_vectors WHERE document_id IN (SELECT id FROM knowledge_documents WHERE symbol=? AND kind='strategy_note')").run(symbol);
      db.prepare("DELETE FROM knowledge_documents WHERE symbol=? AND kind='strategy_note'").run(symbol);
      for(const d of buildDocuments(symbol,[],notes)) db.prepare('INSERT INTO knowledge_documents(symbol,kind,start_time,end_time,text,hash,created_at) VALUES(?,?,?,?,?,?,?)').run(symbol,d.kind,d.start,d.end,d.text,d.hash,new Date().toISOString());
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');return res.status(500).json({message:'ذخیرهٔ یادداشت انجام نشد.'});}
    res.json({ok:true,executionAllowed:false});
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
