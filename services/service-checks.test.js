import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../config/env.js';
import { checkService, serviceMetadata } from './service-checks.js';

const config = readConfig({ WALLEX_API_KEY: 'fake-wallex-secret', LLM_API_KEY: 'fake-llm-secret', LLM_API_BASE_URL: 'https://ai.boxapi.ir/ai/v1', LLM_MODEL: 'openai/gpt-6-luna' });

test('metadata never contains credentials and unconfigured checks do not call upstream', async () => {
  assert.ok(!JSON.stringify(serviceMetadata(config)).includes('secret'));
  const result = await checkService('llm', readConfig({}), () => { throw new Error('must not call'); });
  assert.equal(result.code, 'NOT_CONFIGURED');
});

test('Wallex is read-only and only gets its own key; response details stay private', async () => {
  const result = await checkService('wallex', config, async (url, options) => {
    assert.equal(url, 'https://api.wallex.ir/v1/account/fee');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers['x-api-key'], 'fake-wallex-secret');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, 'error');
    return Response.json({ success: true, result: { privateAccountDetails: 'private' } });
  });
  assert.equal(result.ok, true);
  assert.ok(!JSON.stringify(result).includes('privateAccountDetails'));
});

test('LLM uses exact model and bounded fixed prompt without account data', async () => {
  const result = await checkService('llm', config, async (url, options) => {
    assert.equal(url, 'https://ai.boxapi.ir/ai/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer fake-llm-secret');
    assert.ok(!options.body.includes('wallex-secret'));
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'openai/gpt-6-luna');
    assert.equal(body.max_completion_tokens, 64);
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  });
  assert.equal(result.ok, true);
});

test('upstream errors and malformed successful bodies cannot leak secrets or produce green status', async () => {
  const error = await checkService('llm', config, async () => Response.json({ error: 'fake-llm-secret' }, { status: 401 }));
  assert.equal(error.ok, false);
  assert.equal(error.httpStatus, 401);
  assert.ok(!JSON.stringify(error).includes('fake-llm-secret'));
  const empty = await checkService('llm', config, async () => Response.json({ choices: [] }));
  assert.equal(empty.ok, false);
  const invalid = await checkService('wallex', config, async () => Response.json({ success: false }));
  assert.equal(invalid.ok, false);
});

test('timeout and network failures have safe actionable messages', async () => {
  const timeout = await checkService('llm', config, async () => { throw new DOMException('private provider error', 'TimeoutError'); });
  assert.equal(timeout.code, 'TIMEOUT');
  const network = await checkService('wallex', config, async () => { throw new Error('fake-wallex-secret'); });
  assert.equal(network.code, 'NETWORK_ERROR');
  assert.ok(!JSON.stringify(network).includes('secret'));
});
