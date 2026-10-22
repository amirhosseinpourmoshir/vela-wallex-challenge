export function allowedMarketRows(markets, unavailableMarkets, extraBlocked = []) {
  if (!Array.isArray(markets) || !markets.length) throw new Error('Invalid market catalog');
  if (!Array.isArray(unavailableMarkets) || unavailableMarkets.some(s => typeof s !== 'string' || !/^[A-Z0-9_-]+$/.test(s))) throw new Error('Invalid package denylist; refusing to assume all markets are allowed');
  const denied = new Set([...unavailableMarkets, ...extraBlocked]);
  const seen = new Set();
  const rows = [];
  for (const m of markets) {
    if (m.is_spot !== true || denied.has(m.symbol)) continue;
    if (!/^[A-Z0-9_-]+$/.test(m.symbol) || !['TMN', 'USDT'].includes(m.quote_asset) || !m.base_asset || seen.has(m.symbol)) throw new Error('Unexpected market metadata');
    if (!Number.isInteger(m.amount_precision) || !Number.isInteger(m.price_precision)) throw new Error('Missing market precision');
    seen.add(m.symbol);
    rows.push({ symbol: m.symbol, base: m.base_asset, quote: m.quote_asset, name: m.fa_base_asset || m.base_asset, price: String(m.price), change24h: Number.isFinite(Number(m.change_24h)) ? Number(m.change_24h) : null, amountPrecision: m.amount_precision, pricePrecision: m.price_precision });
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
}

export function readMarketCatalog(db) {
  initMarketCatalog(db);
  const sync = db.prepare('SELECT checked_at AS checkedAt, package_id AS packageId, package_title AS packageTitle, account_match AS accountMatch, total_markets AS totalMarkets, excluded_count AS excludedCount, warning FROM market_catalog_sync WHERE id=1').get();
  if (!sync) return { ready: false, markets: [], message: 'ابتدا npm run markets:sync را اجرا کنید.' };
  return { ready: true, sync, markets: db.prepare('SELECT symbol, base, quote, name, price, change_24h AS change24h, amount_precision AS amountPrecision, price_precision AS pricePrecision FROM challenge_markets ORDER BY quote DESC, symbol').all() };
}
