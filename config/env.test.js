import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, missingPrerequisites } from './env.js';

test('empty config can run the demo without credentials', () => {
  const config = readConfig({});
  assert.equal(config.app.mode, 'demo');
  assert.equal(config.app.liveTradingEnabled, false);
  assert.equal(config.wallex.wsUrl, 'wss://api.wallex.ir/connection/websocket');
  assert.equal(config.risk.maxOrderTmn, 0);
  assert.ok(missingPrerequisites(config).includes('WALLEX_API_KEY'));
});

test('malformed booleans and order rate above documented limit are rejected', () => {
  assert.throws(() => readConfig({ LIVE_TRADING_ENABLED: 'yes' }), /LIVE_TRADING_ENABLED/);
  assert.throws(() => readConfig({ WALLEX_ORDER_REQUESTS_PER_10_SECONDS: '21' }), /WALLEX_ORDER_REQUESTS/);
  assert.throws(() => readConfig({ PORT: '' }), /PORT/);
});

test('credential errors do not print supplied URLs or secrets', () => {
  assert.throws(() => readConfig({ LLM_API_BASE_URL: 'https://user:private-secret@example.com/v1' }), error => {
    assert.ok(!error.message.includes('private-secret'));
    return /LLM_API_BASE_URL/.test(error.message);
  });
});

test('unsafe credentials destinations and unsupported live switches are rejected', () => {
  assert.throws(() => readConfig({ WALLEX_API_BASE_URL: 'https://example.com' }), /official/);
  assert.throws(() => readConfig({ TRADING_MODE: 'live' }), /scaffold only supports demo/);
  assert.throws(() => readConfig({ AGENT_ENABLED: 'true' }), /not implemented/);
});

test('challenge/risk inconsistencies are rejected', () => {
  assert.throws(() => readConfig({ TRADING_ALLOWED_SYMBOLS: 'BTCTMN', TRADING_BLOCKED_SYMBOLS: 'BTCTMN' }), /overlap/);
  assert.throws(() => readConfig({ RISK_MAX_ORDER_TMN: '100000' }), /order <= exposure/);
  assert.throws(() => readConfig({ CHALLENGE_END_AT: '2026-10-22T12:00:00' }), /timezone/);
  assert.throws(() => readConfig({ CHALLENGE_START_AT: '2026-10-23T12:00:00Z', CHALLENGE_END_AT: '2026-10-22T12:00:00Z' }), /after/);
});

test('zero disables application token/call ceilings and negative limits remain invalid',()=>{const c=readConfig({});assert.equal(c.agent.maxTokensPerDay,0);assert.equal(c.llm.maxCallsPerDay,0);assert.throws(()=>readConfig({AGENT_MAX_TOKENS_PER_DAY:'-1'}));assert.throws(()=>readConfig({LLM_MAX_CALLS_PER_DAY:'-1'}))});
