import { readConfig, missingPrerequisites } from '../config/env.js';
try {
  const config = readConfig();
  console.log('Environment syntax and configuration: OK');
  console.log('Current runtime: DEMO only. No exchange/LLM calls made.');
  console.log(`Wallex key present: ${Boolean(config.wallex.apiKey)}`);
  console.log(`LLM key present: ${Boolean(config.llm.apiKey)}`);
  const missing = missingPrerequisites(config);
  console.log('Missing settings for future integration:', missing.length ? missing.join(', ') : 'none');
  console.log('Engine, live order execution and risk enforcement: NOT IMPLEMENTED (regardless of filled settings).');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
