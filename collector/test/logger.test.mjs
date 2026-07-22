import assert from 'node:assert/strict';
import test from 'node:test';

import { errorMessage, redactSensitiveText } from '../src/logger.mjs';

test('operator errors redact credential-bearing URLs and authorization headers', () => {
  const message = redactSensitiveText(
    'HTTP failed URL: https://user:secret@rpc.example/v1/key?token=abc x-api-key: swordfish',
  );
  assert.equal(message.includes('secret'), false);
  assert.equal(message.includes('token=abc'), false);
  assert.equal(message.includes('swordfish'), false);
  assert.match(message, /\[redacted-url\]/);
  assert.match(message, /x-api-key: \[redacted\]/);
});

test('errorMessage keeps useful context while bounding log records', () => {
  const message = errorMessage(new Error(`L1 request failed ${'x'.repeat(2_000)}`));
  assert.equal(message.length, 1_000);
  assert.match(message, /^L1 request failed/);
});
