const { test, expect } = require('@playwright/test');
const { configureServer, joinLobby, setupLobby, closeAll } = require('./helpers');

test.beforeEach(async ({ request }) => {
  await configureServer(request);
});

// The join screen pre-fills #playerName with a generated codename like
// "Shadow Wolf". The "GENERATE NEW" button rerolls it.
test('codename is auto-generated on load and re-generates on demand', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');

  const input = page.locator('#playerName');
  const first = await input.inputValue();
  expect(first).toMatch(/^\w+ \w+$/); // "Adjective Noun"
  expect(first.length).toBeGreaterThan(2);

  // Generate until a different name appears. With 10 adjectives x 10 nouns
  // the collision chance per try is 1%, so 10 attempts is effectively certain.
  let next = first;
  for (let i = 0; i < 10 && next === first; i++) {
    await page.locator('button:has-text("GENERATE NEW")').click();
    next = await input.inputValue();
  }
  expect(next).not.toBe(first);
  expect(next).toMatch(/^\w+ \w+$/);

  await context.close();
});

test('player can toggle ready and unready in the lobby', async ({ browser }) => {
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  await Promise.all(pages.map((p, i) => joinLobby(p, `Agent${i}`)));
  for (const page of pages) {
    await expect(page.locator('.player-item')).toHaveCount(3);
  }

  const readyBtn = pages[0].locator('#readyBtn');
  await expect(readyBtn).toHaveText('MARK READY');

  await readyBtn.click();
  await expect(readyBtn).toHaveText('UNMARK READY');
  // Other clients see Agent0 as ready.
  await expect(pages[1].locator('.player-item.ready')).toHaveCount(1);

  await readyBtn.click();
  await expect(readyBtn).toHaveText('MARK READY');
  await expect(pages[1].locator('.player-item.ready')).toHaveCount(0);

  // Lobby should not have advanced — no one is ready yet.
  await expect(pages[0].locator('#lobbyScreen')).toBeVisible();

  await closeAll(contexts);
});

// joinLobby is rejected when phase !== 'lobby'. Client surfaces the reason
// via a native alert().
test('joining after game starts is rejected with an alert', async ({ browser, request }) => {
  await configureServer(request);
  const { contexts: gameContexts } = await setupLobby(browser, ['Agent0', 'Agent1', 'Agent2']);

  // 4th client tries to join after game is underway.
  const latecomerCtx = await browser.newContext();
  const latecomer = await latecomerCtx.newPage();

  const dialogPromise = new Promise((resolve) => {
    latecomer.once('dialog', async (dialog) => {
      const msg = dialog.message();
      await dialog.accept();
      resolve(msg);
    });
  });

  await latecomer.goto('/');
  await latecomer.locator('#playerName').fill('Latecomer');
  await latecomer.locator('button:has-text("ENTER OPERATION")').click();

  const dialogMsg = await dialogPromise;
  expect(dialogMsg).toContain('Game already in progress');

  // Latecomer should still be on the join screen.
  await expect(latecomer.locator('#joinScreen')).toBeVisible();

  await latecomerCtx.close();
  await closeAll(gameContexts);
});

// Lobby maxes out at 8 — a 9th joiner gets 'Lobby is full'. Heavy test (8
// contexts) but it pins a real guard clause.
test('9th joiner during lobby phase is rejected with full alert', async ({ browser, request }) => {
  await configureServer(request);

  const fillerContexts = await Promise.all(
    Array.from({ length: 8 }, () => browser.newContext())
  );
  const fillers = await Promise.all(fillerContexts.map((c) => c.newPage()));
  for (let i = 0; i < 8; i++) {
    await joinLobby(fillers[i], `Filler${i}`);
  }
  for (const page of fillers) {
    await expect(page.locator('.player-item')).toHaveCount(8);
  }

  const ninthCtx = await browser.newContext();
  const ninth = await ninthCtx.newPage();
  const dialogPromise = new Promise((resolve) => {
    ninth.once('dialog', async (dialog) => {
      const msg = dialog.message();
      await dialog.accept();
      resolve(msg);
    });
  });
  await ninth.goto('/');
  await ninth.locator('#playerName').fill('Ninth');
  await ninth.locator('button:has-text("ENTER OPERATION")').click();

  const msg = await dialogPromise;
  expect(msg).toContain('Lobby is full');
  await expect(ninth.locator('#joinScreen')).toBeVisible();

  await ninthCtx.close();
  await closeAll(fillerContexts);
});
