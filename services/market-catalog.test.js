import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { allowedMarketRows, readMarketCatalog, refreshOrderPrecision, orderPrecision } from './market-catalog.js';
const market = { symbol: 'BTCTMN', base_asset: 'BTC', quote_asset: 'TMN', is_spot: true, price: '100', amount_precision: 8, price_precision: 0 };
test('excludes package-blocked markets, local blocks and non-spot markets', () => {
  const data = [market, {...market, symbol:'ETHTMN'}, {...market, symbol:'SOLTMN',is_spot:false}];
  assert.deepEqual(allowedMarketRows(data,['ETHTMN']).map(m=>m.symbol),['BTCTMN']);
  assert.throws(()=>allowedMarketRows([market],[],['BTCTMN']),/No markets/);
});
test('missing/malformed denylist never becomes unrestricted access', () => {
  assert.throws(()=>allowedMarketRows([market],undefined),/denylist/);
  assert.throws(()=>allowedMarketRows([market],[{symbol:'BTCTMN'}]),/denylist/);
});
test('duplicates and missing precision reject inconsistent catalog',()=>{
  assert.throws(()=>allowedMarketRows([market,market],[]),/metadata/);
  assert.throws(()=>allowedMarketRows([{...market,price_precision:null}],[]),/precision/);
});
test('an empty database returns no sample or unrestricted markets',()=>{
  const db=new DatabaseSync(':memory:');
  assert.equal(readMarketCatalog(db).ready,false);
  assert.deepEqual(readMarketCatalog(db).markets,[]);
  db.close();
});

test('margin policy requires TMN, explicit margin metadata, active margin membership and package permission',()=>{
  const markets=[{...market,is_margin:true},{...market,symbol:'ETHTMN',is_margin:false},{...market,symbol:'BTCUSDT',quote_asset:'USDT',is_margin:true},{...market,symbol:'SOLTMN',is_margin:true}];
  const active=[{symbol:'BTCTMN',quote:'TMN'},{symbol:'BTCUSDT',quote:'USDT'},{symbol:'SOLTMN',quote:'TMN'}];
  const result=allowedMarketRows(markets,['SOLTMN'],[],active);
  assert.deepEqual(result.map(m=>m.symbol),['BTCTMN']);assert.equal(result[0].tradeType,'margin');
  assert.throws(()=>allowedMarketRows(markets,[],[],[]),/margin market/);
});

test('order increments use stepSize/tickSize, never accounting precision; stale metadata refreshes without adding markets',()=>{
 const db=new DatabaseSync(':memory:');readMarketCatalog(db);
 db.prepare('INSERT INTO challenge_markets(symbol,base,quote,name,price,amount_precision,price_precision) VALUES(?,?,?,?,?,?,?)').run('XLMTMN','XLM','TMN','XLM','1',8,8);
 const local={symbol:'XLMTMN',base:'XLM',quote:'TMN',amountPrecision:8,pricePrecision:8};
 const fresh={symbol:'XLMTMN',baseAsset:'XLM',quoteAsset:'TMN',baseAssetPrecision:8,quotePrecision:8,stepSize:1,tickSize:0};
 assert.deepEqual(orderPrecision(fresh),{amountPrecision:1,pricePrecision:0});
 assert.equal(refreshOrderPrecision(db,local,fresh).amountPrecision,1);
 assert.equal(db.prepare('SELECT amount_precision n FROM challenge_markets').get().n,1);
 assert.throws(()=>refreshOrderPrecision(db,local,{...fresh,quoteAsset:'USDT'}),/هویت/);
 for(const value of [undefined,null,'1',-1,1.5,13])assert.throws(()=>orderPrecision({...fresh,stepSize:value}),/دقت/);
 assert.equal(db.prepare('SELECT count(*) n FROM challenge_markets').get().n,1);db.close();
});
