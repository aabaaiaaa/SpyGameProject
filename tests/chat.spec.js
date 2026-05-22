const { test, expect } = require('@playwright/test');
const { configureServer, joinLobby, closeAll } = require('./helpers');

test('chat messages broadcast to all clients in the lobby', async ({ browser, request }) => {
  await configureServer(request);

  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  await Promise.all(pages.map((p, i) => joinLobby(p, `Agent${i}`)));

  // Lobby join itself emits a system message — wait until all 3 have rendered
  // before sending player chat (avoids flakiness on slow init).
  for (const page of pages) {
    await expect(page.locator('.player-item')).toHaveCount(3);
  }

  // Agent0 sends via SEND button.
  await pages[0].locator('#messageInput').fill('hello team');
  await pages[0].locator('.message-input button:has-text("SEND")').click();

  for (const page of pages) {
    await expect(page.locator('#chatMessages .message.player')).toContainText('Agent0');
    await expect(page.locator('#chatMessages .message.player')).toContainText('hello team');
  }

  // Agent1 sends via Enter key.
  await pages[1].locator('#messageInput').fill('roger that');
  await pages[1].locator('#messageInput').press('Enter');

  for (const page of pages) {
    await expect(page.locator('#chatMessages .message.player').last()).toContainText('roger that');
    await expect(page.locator('#chatMessages .message.player').last()).toContainText('Agent1');
  }

  // Empty input should NOT send anything.
  const beforeCount = await pages[0].locator('#chatMessages .message.player').count();
  await pages[0].locator('#messageInput').fill('   ');
  await pages[0].locator('.message-input button:has-text("SEND")').click();
  // Give server a moment to (not) broadcast.
  await pages[0].waitForTimeout(200);
  const afterCount = await pages[0].locator('#chatMessages .message.player').count();
  expect(afterCount).toBe(beforeCount);

  await closeAll(contexts);
});
