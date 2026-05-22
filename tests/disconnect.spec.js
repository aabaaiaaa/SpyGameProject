const { test, expect } = require('@playwright/test');
const { configureServer, setupLobby, closeAll } = require('./helpers');

// When a player disconnects mid-game and the player count drops below 3, the
// server emits `gameCancelled`. Client surfaces this via alert() then reloads.
test('mid-game disconnect cancels the game for remaining players', async ({
  browser,
  request,
}) => {
  await configureServer(request, { deck: ['Encrypted USB'], doubleAgentIndex: 0 });
  const { contexts, pages } = await setupLobby(browser, ['Agent0', 'Agent1', 'Agent2']);

  // We're in the playing phase now (setupLobby waits for #gameScreen).
  await expect(pages[0].locator('#gameScreen')).toBeVisible();

  // Capture the cancellation alert that the surviving clients will receive.
  const alertMessages = pages.slice(0, 2).map(
    (page) =>
      new Promise((resolve) => {
        page.once('dialog', async (dialog) => {
          const msg = dialog.message();
          await dialog.accept();
          resolve(msg);
        });
      })
  );

  // Drop Agent2.
  await contexts[2].close();

  const messages = await Promise.all(alertMessages);
  for (const msg of messages) {
    expect(msg).toContain('Not enough players');
  }

  // After alert.accept(), client does location.reload() which lands on the
  // join screen.
  for (const page of pages.slice(0, 2)) {
    await expect(page.locator('#joinScreen')).toBeVisible();
  }

  await closeAll(contexts.slice(0, 2));
});
