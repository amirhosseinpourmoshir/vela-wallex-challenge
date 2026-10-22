// Inclusive minute-aligned intervals. Stored data and temporarily unavailable ranges
// are subtracted before a network request is made.
export function missingRanges(times, from, to, suppressed = [], maxCandles = 1440) {
  if (to < from) return [];
  const occupied = times.map(t => ({ from: t, to: t })).concat(suppressed).filter(r => r.to >= from && r.from <= to).sort((a,b)=>a.from-b.from);
  const gaps=[]; let cursor=from;
  for(const r of occupied){
    if(r.from>cursor)gaps.push({from:cursor,to:Math.min(to,r.from-60)});
    cursor=Math.max(cursor,r.to+60);
    if(cursor>to)break;
  }
  if(cursor<=to)gaps.push({from:cursor,to});
  const windows=[];
  for(const gap of gaps)for(let start=gap.from;start<=gap.to;start+=maxCandles*60)windows.push({from:start,to:Math.min(gap.to,start+(maxCandles-1)*60)});
  return windows;
}

export function saveDocuments(db,symbol,docs,now=new Date().toISOString()) {
  let changed=0,unchanged=0;
  const insert=db.prepare('INSERT OR IGNORE INTO knowledge_documents(symbol,kind,start_time,end_time,text,hash,created_at) VALUES(?,?,?,?,?,?,?)');
  for(const doc of docs){
    const previous=db.prepare('SELECT id,hash FROM knowledge_documents WHERE symbol=? AND kind=? AND start_time=?').all(symbol,doc.kind,doc.start);
    if(previous.length===1&&previous[0].hash===doc.hash){unchanged++;continue;}
    for(const old of previous)if(old.hash!==doc.hash){db.prepare('DELETE FROM knowledge_vectors WHERE document_id=?').run(old.id);db.prepare('DELETE FROM knowledge_documents WHERE id=?').run(old.id);}
    changed+=Number(insert.run(symbol,doc.kind,doc.start,doc.end,doc.text,doc.hash,now).changes);
  }
  return {changed,unchanged};
}
