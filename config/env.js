import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Native Node loader: existing process environment takes precedence over .env.
const envFile = path.join(projectRoot, '.env');
if (existsSync(envFile)) loadEnvFile(envFile);

export function readConfig(env = process.env) {
  const text = (name, fallback = '') => (env[name] ?? fallback).trim();
  function choice(name, values, fallback) {
    const value = text(name, fallback);
    if (!values.includes(value)) throw new Error(`${name}: expected ${values.join(' | ')}`);
    return value;
  }
  function number(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER, integer = true) {
    const raw = text(name, String(fallback));
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) {
      throw new Error(`${name}: expected ${integer ? 'integer' : 'number'} between ${min} and ${max}`);
    }
    return value;
  }
  const percent = name => number(name, 0, 0, 100, false);
  function bool(name, fallback = false) {
    return choice(name, ['true', 'false'], String(fallback)) === 'true';
  }
  function url(name, fallback = '', protocols = ['https:']) {
    const value = text(name, fallback);
    if (!value) return '';
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error(`${name}: invalid URL`); }
    if (!protocols.includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error(`${name}: use an allowed protocol without credentials, query or fragment`);
    }
    return value;
  }
  function date(name) {
    const value = text(name);
    if (value && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))) {
      throw new Error(`${name}: expected ISO 8601 with timezone`);
    }
    return value;
  }
  function symbols(name) {
    const values = [...new Set(text(name).split(',').map(s => s.trim()).filter(Boolean))];
    if (values.some(s => !/^[A-Z0-9_-]+$/.test(s))) throw new Error(`${name}: expected comma-separated uppercase market symbols`);
    return Object.freeze(values);
  }
  const prefix = text('WALLEX_ORDER_CLIENT_ID_PREFIX', 'VELA');
  if (!/^[A-Z0-9_]+$/.test(prefix)) throw new Error('WALLEX_ORDER_CLIENT_ID_PREFIX: use uppercase letters, digits and underscore');
  const config = {
    app: Object.freeze({
      nodeEnv: choice('NODE_ENV', ['development', 'production', 'test'], 'development'),
      port: number('PORT', 3000, 1, 65535),
      sqlitePath: path.resolve(projectRoot, text('SQLITE_PATH', './data/vela.sqlite')),
      mode: choice('TRADING_MODE', ['demo', 'shadow', 'live'], 'demo'),
      agentEnabled: bool('AGENT_ENABLED'),
      liveTradingEnabled: bool('LIVE_TRADING_ENABLED'),
    }),
    reviewTrading: Object.freeze({enabled: bool('LIVE_ORDER_REVIEW_ENABLED', false)}),
    wallex: Object.freeze({
      baseUrl: url('WALLEX_API_BASE_URL', 'https://api.wallex.ir'),
      apiKey: text('WALLEX_API_KEY'),
      apiKeyExpiresAt: date('WALLEX_API_KEY_EXPIRES_AT'),
      accountType: choice('WALLEX_ACCOUNT_TYPE', ['credit', 'main'], 'credit'),
      subAccountId: text('WALLEX_SUB_ACCOUNT_ID'),
      packageId: text('WALLEX_PACKAGE_ID'),
      httpTimeoutMs: number('WALLEX_HTTP_TIMEOUT_MS', 10000, 1000, 120000),
      readRequestsPerSecond: number('WALLEX_READ_REQUESTS_PER_SECOND', 2, 1, 10),
      orderRequestsPer10Seconds: number('WALLEX_ORDER_REQUESTS_PER_10_SECONDS', 10, 1, 20),
      readMaxRetries: number('WALLEX_READ_MAX_RETRIES', 2, 0, 5),
      orderClientIdPrefix: prefix,
      accountPollIntervalMs: number('WALLEX_ACCOUNT_POLL_INTERVAL_MS', 15000, 1000),
      wsEnabled: bool('WALLEX_WS_ENABLED', true),
      wsUrl: url('WALLEX_WS_URL', 'wss://api.wallex.ir/connection/websocket', ['wss:']),
      wsReconnectMinMs: number('WALLEX_WS_RECONNECT_MIN_MS', 1000, 100),
      wsReconnectMaxMs: number('WALLEX_WS_RECONNECT_MAX_MS', 30000, 100),
    }),
    market: Object.freeze({
      symbols: symbols('MARKET_DATA_SYMBOLS'),
      maxAgeMs: number('MARKET_DATA_MAX_AGE_MS', 15000, 1000),
      candleResolution: choice('MARKET_CANDLE_RESOLUTION', ['1', '15', '60', '240', '480', '720', '1D', '2D', '3D'], '15'),
      historyLookbackDays: number('MARKET_HISTORY_LOOKBACK_DAYS', 30, 1, 3650),
      snapshotIntervalMs: number('MARKET_SNAPSHOT_INTERVAL_MS', 5000, 1000),
      aiContextMaxCandles: number('MARKET_AI_CONTEXT_MAX_CANDLES', 100, 1, 1000),
    }),
    llm: Object.freeze({
      baseUrl: url('LLM_API_BASE_URL'), apiKey: text('LLM_API_KEY'), model: text('LLM_MODEL'),
      httpTimeoutMs: number('LLM_HTTP_TIMEOUT_MS', 30000, 1000, 180000),
      maxOutputTokens: number('LLM_MAX_OUTPUT_TOKENS', 1200, 1, 32768),
      maxRetries: number('LLM_MAX_RETRIES', 1, 0, 3),
      maxCallsPerDay: number('LLM_MAX_CALLS_PER_DAY', 0, 0, 10000),
    }),
    agent: Object.freeze({
      decisionIntervalMs: number('AGENT_DECISION_INTERVAL_MS', 60000, 1000),
      maxTokensPerDay: number('AGENT_MAX_TOKENS_PER_DAY', 0, 0, 10000000),
      strategyVersion: text('AGENT_STRATEGY_VERSION', 'vela_v1'),
      promptVersion: text('AGENT_PROMPT_VERSION', 'decision_v1'),
      saveDecisionInputs: bool('AGENT_SAVE_DECISION_INPUTS', true),
    }),
    mcp: Object.freeze({
      enabled: bool('WALLEX_MCP_ENABLED'), serverUrl: url('WALLEX_MCP_SERVER_URL'),
      authToken: text('WALLEX_MCP_AUTH_TOKEN'),
    }),
    challenge: Object.freeze({
      initialCapitalTmn: number('CHALLENGE_INITIAL_CAPITAL_TMN', 5000000, 1),
      startAt: date('CHALLENGE_START_AT'), endAt: date('CHALLENGE_END_AT'),
      exitBeforeEndMinutes: number('CHALLENGE_EXIT_BEFORE_END_MINUTES', 30, 1),
    }),
    trading: Object.freeze({
      marketType: choice('TRADING_MARKET_TYPE', ['margin'], 'margin'),
      allowedSymbols: symbols('TRADING_ALLOWED_SYMBOLS'), blockedSymbols: symbols('TRADING_BLOCKED_SYMBOLS'),
      quoteAsset: choice('TRADING_QUOTE_ASSET', ['TMN'], 'TMN'),
      orderType: choice('TRADING_ORDER_TYPE', ['LIMIT'], 'LIMIT'),
    }),
    risk: Object.freeze({
      maxOrderTmn: number('RISK_MAX_ORDER_TMN', 0),
      maxTotalExposureTmn: number('RISK_MAX_TOTAL_EXPOSURE_TMN', 0),
      maxOpenPositions: number('RISK_MAX_OPEN_POSITIONS', 1, 1),
      maxDrawdownPercent: percent('RISK_MAX_DRAWDOWN_PERCENT'),
      stopLossPercent: percent('RISK_STOP_LOSS_PERCENT'),
      maxSpreadBps: number('RISK_MAX_SPREAD_BPS', 0, 0, 10000),
      maxSlippageBps: number('RISK_MAX_SLIPPAGE_BPS', 0, 0, 10000),
      requireVerifiedFees: bool('RISK_REQUIRE_VERIFIED_FEES', true),
    }),
    embedding: Object.freeze({
      model: choice('EMBEDDING_MODEL', ['text-embedding-3-small', 'text-embedding-3-large'], 'text-embedding-3-small'),
      batchSize: number('EMBEDDING_BATCH_SIZE', 8, 1, 16),
      maxDocuments: number('EMBEDDING_MAX_DOCUMENTS_PER_JOB', 100, 1, 365),
    }),
  };
  if (config.wallex.baseUrl !== 'https://api.wallex.ir') throw new Error('WALLEX_API_BASE_URL: expected official https://api.wallex.ir');
  if (config.wallex.wsUrl !== 'wss://api.wallex.ir/connection/websocket') throw new Error('WALLEX_WS_URL: expected official Centrifugo V2 endpoint without trailing slash');
  if (config.wallex.wsReconnectMaxMs < config.wallex.wsReconnectMinMs) throw new Error('WALLEX_WS_RECONNECT_MAX_MS must be >= minimum');
  if (config.challenge.startAt && config.challenge.endAt && Date.parse(config.challenge.endAt) <= Date.parse(config.challenge.startAt)) throw new Error('CHALLENGE_END_AT must be after CHALLENGE_START_AT');
  if (config.trading.allowedSymbols.some(s => config.trading.blockedSymbols.includes(s))) throw new Error('Allowed and blocked market lists overlap');
  if (config.risk.maxOrderTmn > config.risk.maxTotalExposureTmn || config.risk.maxTotalExposureTmn > config.challenge.initialCapitalTmn) throw new Error('Risk caps must satisfy: order <= exposure <= initial capital');
  // Autonomous live trading stays disabled; reviewed orders use a separate explicit feature.
  if (config.app.mode !== 'demo' || config.app.agentEnabled || config.app.liveTradingEnabled) {
    throw new Error('This scaffold only supports demo; legacy AGENT_ENABLED and LIVE_TRADING_ENABLED switches are not implemented; use the session-based review engine');
  }
  if(config.mcp.enabled){const endpoint=new URL(config.mcp.serverUrl||config.wallex.baseUrl+'/mcp');if(endpoint.origin!==new URL(config.wallex.baseUrl).origin||endpoint.pathname!=='/mcp'||endpoint.search||endpoint.hash)throw new Error('MCP endpoint must be the Wallex origin and /mcp path');if(!config.mcp.serverUrl)throw new Error('WALLEX_MCP_SERVER_URL is required');}
  return Object.freeze(config);
}

// Readiness lists names only. Never serialize the complete config or credentials.
export function missingPrerequisites(config) {
  const required = [
    ['WALLEX_API_KEY', config.wallex.apiKey],
    ['WALLEX_SUB_ACCOUNT_ID', config.wallex.subAccountId],
    ['WALLEX_PACKAGE_ID', config.wallex.packageId],
    ['LLM_API_BASE_URL', config.llm.baseUrl], ['LLM_API_KEY', config.llm.apiKey], ['LLM_MODEL', config.llm.model],
    ['MARKET_DATA_SYMBOLS', config.market.symbols.length],
    ['TRADING_ALLOWED_SYMBOLS', config.trading.allowedSymbols.length],
    ['CHALLENGE_START_AT', config.challenge.startAt], ['CHALLENGE_END_AT', config.challenge.endAt],
    ['RISK_MAX_ORDER_TMN', config.risk.maxOrderTmn], ['RISK_MAX_TOTAL_EXPOSURE_TMN', config.risk.maxTotalExposureTmn],
    ['RISK_MAX_DRAWDOWN_PERCENT', config.risk.maxDrawdownPercent], ['RISK_STOP_LOSS_PERCENT', config.risk.stopLossPercent],
    ['RISK_MAX_SPREAD_BPS', config.risk.maxSpreadBps], ['RISK_MAX_SLIPPAGE_BPS', config.risk.maxSlippageBps],
  ];
  return required.filter(([,value]) => !value).map(([name]) => name);
}
