import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCandles, qualityReport, buildDocuments } from './history.js';
import { embedTexts } from './knowledge.js';
import { readConfig } from '../config/env.js';

function data(times){return {s:'ok',t:times,o:times.map(()=>10),h:times.map(()=>12),l:times.map(()=>8),c:times.map(()=>11),v:times.map(()=>2)};}
test('history rejects malformed OHLC and future/open candles and deduplicates timestamps',()=>{
  const input=data([60,120,120,180,240]);input.h[3]=1;
  const r=normalizeCandles(input,60,180);
  assert.deepEqual(r.candles.map(c=>c.t),[60,120]);assert.equal(r.duplicates,1);assert.equal(r.rejected,2);
  assert.throws(()=>normalizeCandles({...input,v:[]},60,180),/OHLCV/);
});
test('wrong timeframe is never labeled native one minute',()=>{
  assert.throws(()=>normalizeCandles(data([3600,7200,10800]),3600,10800),/یک‌دقیقه‌ای/);
});
test('coverage reports gaps without inventing candles',()=>{
  const q=qualityReport([{t:60},{t:180}],60,180);
  assert.equal(q.missingCandles,1);assert.equal(q.complete,false);assert.equal(q.coveragePercent,66.67);
});
test('daily documents preserve source, quote, evidence time and incomplete coverage',()=>{
  const candles=normalizeCandles(data([60,120]),60,120).candles;
  const docs=buildDocuments('BTCTMN',candles,'test strategy');
  assert.equal(docs.length,2);assert.match(docs[0].text,/TMN.*NOT rial/);assert.match(docs[0].text,/2\/1440/);assert.equal(docs[0].end,180);assert.equal(docs[0].hash,buildDocuments('BTCTMN',candles)[0].hash);assert.ok(docs[0].text.length<7000);assert.equal(docs[1].kind,'strategy_note');
});
test('embedding validates model dimensions, row order and never sends Wallex credentials',async()=>{
  const c=readConfig({LLM_API_BASE_URL:'https://ai.boxapi.ir/ai/v1',LLM_API_KEY:'llm-test',WALLEX_API_KEY:'wallex-test'});
  const vectors=await embedTexts(c,['public data'],async(url,options)=>{
    assert.equal(url,'https://ai.boxapi.ir/ai/v1/embeddings');assert.ok(!JSON.stringify(options).includes('wallex-test'));
    assert.equal(JSON.parse(options.body).model,'text-embedding-3-small');
    return Response.json({data:[{index:0,embedding:Array(1536).fill(.01)}]});
  });assert.equal(vectors[0].length,1536);
  await assert.rejects(()=>embedTexts(c,['public data'],async()=>Response.json({data:[{index:0,embedding:[0]}]})),/ابعاد/);
});
