import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { missingRanges, saveDocuments } from './incremental-history.js';
import { initKnowledge } from './knowledge.js';
import { buildDocuments } from './history.js';

test('fully cached range schedules no downloads; append fetches only new minutes',()=>{
  assert.deepEqual(missingRanges([60,120,180],60,180),[]);
  assert.deepEqual(missingRanges([60,120,180],60,300),[{from:240,to:300}]);
});
test('requests only holes, skips negative cache, and respects requested lookback',()=>{
  assert.deepEqual(missingRanges([60,180,300],60,360),[{from:120,to:120},{from:240,to:240},{from:360,to:360}]);
  assert.deepEqual(missingRanges([60,180,300],60,360,[{from:120,to:240}]),[{from:360,to:360}]);
  assert.deepEqual(missingRanges([60,120,180],120,180),[]);
});
test('large missing ranges split into daily windows without overlap',()=>{
  const windows=missingRanges([],60,172800);
  assert.deepEqual(windows,[{from:60,to:86400},{from:86460,to:172800}]);
  assert.equal(windows.reduce((n,r)=>n+(r.to-r.from)/60+1,0),2880);
});
test('repeated unchanged documents and notes preserve their IDs, vectors and created time',()=>{
  const db=new DatabaseSync(':memory:');initKnowledge(db);
  const docs=buildDocuments('BTCTMN',[{t:60,o:'10',h:'12',l:'8',c:'11',v:'2'}],'same strategy');
  assert.equal(saveDocuments(db,'BTCTMN',docs,'original-time').changed,2);
  const ids=db.prepare('SELECT id FROM knowledge_documents').all();
  for(const {id} of ids)db.prepare('INSERT INTO knowledge_vectors VALUES(?,?,?,?,?)').run(id,'text-embedding-3-small',1,'[1]','original-time');
  const again=buildDocuments('BTCTMN',[{t:60,o:'10',h:'12',l:'8',c:'11',v:'2'}],'same strategy');
  assert.deepEqual(saveDocuments(db,'BTCTMN',again,'later-time'),{changed:0,unchanged:2});
  assert.equal(db.prepare('SELECT count(*) AS n FROM knowledge_documents').get().n,2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM knowledge_vectors').get().n,2);
  assert.deepEqual(db.prepare('SELECT id FROM knowledge_documents').all(),ids);
  assert.equal(db.prepare('SELECT created_at FROM knowledge_documents LIMIT 1').get().created_at,'original-time');
  db.close();
});
test('a changed day replaces only its own document/vector, not unchanged days',()=>{
  const db=new DatabaseSync(':memory:');initKnowledge(db);
  const a={t:60,o:'10',h:'12',l:'8',c:'11',v:'2'},b={...a,t:86460};
  saveDocuments(db,'BTCTMN',buildDocuments('BTCTMN',[a,b]));
  for(const {id} of db.prepare('SELECT id FROM knowledge_documents').all())db.prepare('INSERT INTO knowledge_vectors VALUES(?,?,?,?,?)').run(id,'model',1,'[1]','time');
  const result=saveDocuments(db,'BTCTMN',buildDocuments('BTCTMN',[a,{...a,t:120},b]));
  assert.equal(result.changed,1);assert.equal(result.unchanged,1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM knowledge_documents').get().n,2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM knowledge_vectors').get().n,1);
  db.close();
});
