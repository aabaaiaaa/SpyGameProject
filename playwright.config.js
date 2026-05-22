const { defineConfig } = require('@playwright/test');

const PORT = 5050;

module.exports = defineConfig({
  testDir: './tests',
  // Unit tests in tests/unit/ use node:test and the .test.js suffix.
  // Playwright only picks up .spec.js files.
  testMatch: /.*\.spec\.js$/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Server has a single shared gameState — tests must not run concurrently.
  fullyParallel: false,
  workers: 1,
  // Some e2e tests are sensitive to leftover state from previous tests
  // (socket.io reconnect timing, in-flight setTimeouts). Allow one retry to
  // smooth out the flakiness without hiding real bugs (a deterministic break
  // would still fail twice).
  retries: 2,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server.js',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      TEST_MODE: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
