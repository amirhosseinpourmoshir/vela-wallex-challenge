export function allowedMarketRows(markets, unavailableMarkets, extraBlocked = [], marginMarkets = null) {
  if (!Array.isArray(markets) || !markets.length) throw new Error('Invalid market catalog');
  if (!Array.isArray(unavailableMarkets) || unavailableMarkets.some(s => typeof s !== 'string' || !/^[A-Z0-9_-]+$/.test(s))) throw new Error('Invalid package denylist; refusing to assume all markets are allowed');
  const denied = new Set([...unavailableMarkets, ...extraBlocked]);
  const seen = new Set();
  const rows = [];
  if (marginMarkets !== null && (!Array.isArray(marginMarkets) || !marginMarkets.length)) throw new Error('Invalid margin market list');
  const margin = marginMarkets && new Map(marginMarkets.filter(m=>m.quote==='TMN').map(m=>[m.symbol,m]));
  for (const m of markets) {
    if (denied.has(m.symbol)) continue;
    if (margin ? !(m.is_margin === true && m.quote_asset === 'TMN' && margin.has(m.symbol)) : m.is_spot !== true) continue;
    if (!/^[A-Z0-9_-]+$/.test(m.symbol) || !['TMN', 'USDT'].includes(m.quote_asset) || !m.base_asset || seen.has(m.symbol)) throw new Error('Unexpected market metadata');
    if (!Number.isInteger(m.amount_precision) || !Number.isInteger(m.price_precision)) throw new Error('Missing market precision');
    seen.add(m.symbol);
    rows.push({ symbol: m.symbol, base: m.base_asset, quote: m.quote_asset, name: m.fa_base_asset || m.base_asset, price: String(m.price), change24h: Number.isFinite(Number(m.change_24h)) ? Number(m.change_24h) : null, amountPrecision: m.amount_precision, pricePrecision: m.price_precision, tradeType: margin ? 'margin' : 'spot', marginRules: margin ? margin.get(m.symbol) : null, spotAvailable: m.is_spot === true });
  }
  if (!rows.length) throw new Error('No markets remain after package restrictions');
  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function initMarketCatalog(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS challenge_markets (
    symbol TEXT PRIMARY KEY, base TEXT NOT NULL, quote TEXT NOT NULL, name TEXT NOT NULL,
    price TEXT NOT NULL, change_24h REAL, amount_precision INTEGER NOT NULL, price_precision INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS market_catalog_sync (
    id INTEGER PRIMARY KEY CHECK(id=1), checked_at TEXT NOT NULL, package_id TEXT NOT NULL,
    package_title TEXT NOT NULL, account_match TEXT NOT NULL, total_markets INTEGER NOT NULL,
    excluded_count INTEGER NOT NULL, warning TEXT NOT NULL
  );`);
  const columns=new Set(db.prepare('PRAGMA table_info(challenge_markets)').all().map(c=>c.name));
  if(!columns.has('trade_type')) db.exec("ALTER TABLE challenge_markets ADD COLUMN trade_type TEXT NOT NULL DEFAULT 'spot'");
  if(!columns.has('margin_rules')) db.exec("ALTER TABLE challenge_markets ADD COLUMN margin_rules TEXT");
  if(!columns.has('spot_available')) db.exec("ALTER TABLE challenge_markets ADD COLUMN spot_available INTEGER NOT NULL DEFAULT 0");
}

export function readMarketCatalog(db) {
  initMarketCatalog(db);
  const sync = db.prepare('SELECT checked_at AS checkedAt, package_id AS packageId, package_title AS packageTitle, account_match AS accountMatch, total_markets AS totalMarkets, excluded_count AS excludedCount, warning FROM market_catalog_sync WHERE id=1').get();
  if (!sync) return { ready: false, markets: [], message: 'ابتدا npm run markets:sync را اجرا کنید.' };
  const markets=db.prepare("SELECT symbol, base, quote, name, price, change_24h AS change24h, amount_precision AS amountPrecision, price_precision AS pricePrecision, trade_type AS tradeType, margin_rules AS marginRules, spot_available AS spotAvailable FROM challenge_markets WHERE trade_type='margin' AND quote='TMN' ORDER BY symbol").all().map(m=>({...m,marginRules:JSON.parse(m.marginRules||'null')}));
  return { ready: markets.length>0, sync, markets, policy:'margin_tmn_only', message:markets.length?'':'فهرست تعهدی تومانی هنوز همگام نشده؛ npm run markets:sync را اجرا کنید.' };
}

// Order increments differ from asset accounting precision (e.g. XLM: 1 vs 8).
export function orderPrecision(market) {
  const amountPrecision=market?.stepSize, pricePrecision=market?.tickSize;
  if (![amountPrecision,pricePrecision].every(n=>typeof n==='number'&&Number.isInteger(n)&&n>=0&&n<=12)) throw new Error('دقت حجم یا قیمت سفارش از والکس معتبر دریافت نشد.');
  return {amountPrecision,pricePrecision};
}

export function refreshOrderPrecision(db, local, market) {
  if(market?.symbol!==local.symbol || market.baseAsset!==local.base || market.quoteAsset!==local.quote) throw new Error('هویت تازهٔ بازار با فهرست مجاز سازگار نیست.');
  const precision=orderPrecision(market);
  if(local.amountPrecision!==precision.amountPrecision||local.pricePrecision!==precision.pricePrecision)
    db.prepare('UPDATE challenge_markets SET amount_precision=?,price_precision=? WHERE symbol=?').run(precision.amountPrecision,precision.pricePrecision,local.symbol);
  return {...local,...precision};
}
