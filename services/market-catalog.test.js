import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { allowedMarketRows, readMarketCatalog } from './market-catalog.js';
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
