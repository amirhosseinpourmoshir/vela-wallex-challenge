import { readConfig, projectRoot } from '../config/env.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { allowedMarketRows, initMarketCatalog } from '../services/market-catalog.js';

const config = readConfig();
if (!config.wallex.apiKey) throw new Error('WALLEX_API_KEY is required');
async function get(endpoint, additionalHeaders = {}) {
  const response = await fetch(config.wallex.baseUrl + endpoint, { headers: { 'x-api-key': config.wallex.apiKey, ...additionalHeaders }, redirect: 'error', signal: AbortSignal.timeout(config.wallex.httpTimeoutMs) });
  if (!response.ok) throw new Error(`Wallex ${endpoint.split('?')[0]} returned HTTP ${response.status}`);
  const data = await response.json();
  if (data.success !== true) throw new Error('Wallex did not confirm request success');
  return data.result;
}
const accounts = await get('/sub-accounts');
if (!Array.isArray(accounts)) throw new Error('Unexpected sub-account response');
const candidates = accounts.filter(a => a.isActive === true && a.isSuspend === false && a.type === 'prop' && (config.wallex.subAccountId ? a.clientId === config.wallex.subAccountId : /هکاتون/.test(a.title || '')));
if (candidates.length !== 1) throw new Error('Cannot uniquely identify challenge account; set WALLEX_SUB_ACCOUNT_ID');
const account = candidates[0];
let packageId;
let accountMatch;
let warning = '';
try {
  const active = await get('/v1/prop/user/packages/active', { 'Sub-Account-Client-id': account.clientId });
  packageId = active?.packageDetail?.id;
  if (!packageId) throw new Error('Missing active package ID');
  accountMatch = 'active_account_endpoint';
} catch (error) {
  // Known permission gap: do not invent an active package. Exact unique title match only.
  if (!/HTTP 401$|HTTP 403$/.test(error.message)) throw error;
  const packages = await get('/v1/prop/packages');
  const matches = Array.isArray(packages) ? packages.filter(p => p.title === account.title && p.status === 'ACTIVE') : [];
  if (matches.length !== 1) throw new Error('Cannot match challenge package by exact title');
  packageId = matches[0].id;
  accountMatch = 'unique_exact_title';
  warning = 'جزئیات طرح فعال حساب با کلید API قابل دریافت نبود؛ تطبیق بر اساس نام دقیق و یکتای حساب و طرح انجام شد. مجوز اجرای سفارش و محدودیت اضافهٔ برگزارکننده هنوز تأیید نشده‌اند.';
}
if (config.wallex.packageId && String(packageId) !== config.wallex.packageId) throw new Error('Configured WALLEX_PACKAGE_ID disagrees with discovered package');
const detail = await get('/v1/prop/packages/' + encodeURIComponent(packageId));
if (detail.detail?.title !== account.title) throw new Error('Package title does not match challenge account');
const catalog = await get('/hector/web/v1/markets');
const rows = allowedMarketRows(catalog.markets, detail.unavailableMarkets, config.trading.blockedSymbols);
const now = new Date().toISOString();
mkdirSync(path.dirname(config.app.sqlitePath), { recursive: true });
const db = new DatabaseSync(config.app.sqlitePath);
db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
initMarketCatalog(db);
db.exec('BEGIN IMMEDIATE');
try {
  db.exec('DELETE FROM challenge_markets');
  const insert = db.prepare('INSERT INTO challenge_markets VALUES(?,?,?,?,?,?,?,?)');
  for (const m of rows) insert.run(m.symbol, m.base, m.quote, m.name, m.price, m.change24h, m.amountPrecision, m.pricePrecision);
  db.prepare('INSERT OR REPLACE INTO market_catalog_sync VALUES(1,?,?,?,?,?,?,?)').run(now, String(packageId), detail.detail.title, accountMatch, catalog.markets.length, detail.unavailableMarkets.length, warning);
  db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; } finally { db.close(); }
// Store reference IDs locally only. Explicit switches keep the execution engine off.
const envPath = path.join(projectRoot, '.env');
let env = readFileSync(envPath, 'utf8');
const settings = { WALLEX_SUB_ACCOUNT_ID: account.clientId, WALLEX_PACKAGE_ID: String(packageId), MARKET_DATA_SYMBOLS: rows.map(m => m.symbol).join(','), TRADING_ALLOWED_SYMBOLS: rows.map(m => m.symbol).join(',') };
for (const [key, value] of Object.entries(settings)) {
  const pattern = new RegExp('^' + key + '=.*$', 'm');
  env = pattern.test(env) ? env.replace(pattern, key + '=' + value) : env + '\n' + key + '=' + value + '\n';
}
writeFileSync(envPath, env);
const snapshot = { checkedAt: now, packageId, packageTitle: detail.detail.title, accountMatch, warning, source: 'https://api.wallex.ir', rule: 'is_spot=true AND symbol NOT IN package.unavailableMarkets AND symbol NOT IN TRADING_BLOCKED_SYMBOLS; quote TMN or USDT', counts: { total: rows.length, tmn: rows.filter(m => m.quote === 'TMN').length, usdt: rows.filter(m => m.quote === 'USDT').length }, markets: rows };
writeFileSync(path.join(projectRoot, 'data', 'market-whitelist.json'), JSON.stringify(snapshot, null, 2));
console.log(JSON.stringify({ checkedAt: now, packageId, packageTitle: detail.detail.title, accountMatch, warning, counts: snapshot.counts, symbols: rows.map(m => m.symbol) }, null, 2));
