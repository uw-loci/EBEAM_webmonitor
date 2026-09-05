const test = require('node:test');
const assert = require('node:assert/strict');

const { startHttpServer } = require('../services/startup');

test('HTTP server begins listening before remote warmup starts', async () => {
  const events = [];
  const fakeServer = { close() {} };
  const app = {
    listen(port, onListening) {
      events.push(`listen:${port}`);
      onListening();
      return fakeServer;
    },
  };
  const logger = {
    log(message) { events.push(message); },
    error(message) { events.push(message); },
  };

  const { server, initialization } = startHttpServer({
    app,
    port: 4321,
    logger,
    warmup: async () => {
      events.push('warmup');
    },
  });

  assert.equal(server, fakeServer);
  assert.deepEqual(events.slice(0, 2), ['listen:4321', 'Listening on 4321']);
  assert.deepEqual(await initialization, { status: 'fulfilled', value: undefined });
  assert.equal(events[2], 'warmup');
});

test('background startup failure is contained after the server is online', async () => {
  const expectedError = new Error('Supabase stalled');
  const loggedErrors = [];
  const app = {
    listen(_port, onListening) {
      onListening();
      return {};
    },
  };

  const { initialization } = startHttpServer({
    app,
    port: 4321,
    logger: {
      log() {},
      error(...args) { loggedErrors.push(args); },
    },
    warmup: async () => {
      throw expectedError;
    },
  });

  const result = await initialization;
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, expectedError);
  assert.equal(loggedErrors.length, 1);
});
