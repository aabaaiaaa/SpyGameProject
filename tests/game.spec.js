const { test, expect } = require('@playwright/test');
const {
  configureServer,
  setupLobby,
  closeAll,
  playThreePlayerGame,
  playTwoPlayerMissionGame,
} = require('./helpers');

// The three end-game branches in server.js endGame(): outcome depends on
// doubleAgentCaught (DA has the most votes in round 3) AND
// doubleAgentSucceeded (>=1 mission failure in EVERY round).

// ----------------------------------------------------------------------------
// Outcome #1: every mission fails, P0 (DA) is voted out. Agents win — caught.
// ----------------------------------------------------------------------------
test('agents win — double agent caught', async ({ browser, request }) => {
  await configureServer(request, { deck: ['Encrypted USB'], doubleAgentIndex: 0 });
  const { contexts, pages } = await setupLobby(browser, ['Agent0', 'Agent1', 'Agent2']);

  await expect(pages[0].locator('#roleBadge')).toHaveText('DOUBLE AGENT');
  await expect(pages[1].locator('#roleBadge')).toHaveText('FIELD AGENT');

  await playThreePlayerGame(pages, 0);

  await expect(pages[0].locator('#resultMessage')).toContainText('MISSION FAILURE');
  await expect(pages[0].locator('#resultMessage')).toContainText('cover has been blown');
  await expect(pages[1].locator('#resultMessage')).toContainText('MISSION SUCCESS');
  await expect(pages[1].locator('#resultMessage')).toContainText('revealed the bomb location');
  await expect(pages[2].locator('#resultMessage')).toContainText('MISSION SUCCESS');
  await expect(pages[0].locator('#finalStats')).toContainText('Agent0 (DOUBLE AGENT)');

  await closeAll(contexts);
});

// ----------------------------------------------------------------------------
// Outcome #2: every mission fails AND DA (P1) escapes the final vote.
// Vote pattern with DA=P1, everyone picks first option:
//   P0 sees [P1, P2] -> votes P1 (DA)
//   P1 sees [P0, P2] -> votes P0
//   P2 sees [P0, P1] -> votes P0
// P0 ends with 2 votes (most), DA has 1 vote -> DA escapes.
// ----------------------------------------------------------------------------
test('double agent wins — undetected sabotage', async ({ browser, request }) => {
  await configureServer(request, { deck: ['Encrypted USB'], doubleAgentIndex: 1 });
  const { contexts, pages } = await setupLobby(browser, ['Agent0', 'Agent1', 'Agent2']);

  await expect(pages[1].locator('#roleBadge')).toHaveText('DOUBLE AGENT');
  await expect(pages[0].locator('#roleBadge')).toHaveText('FIELD AGENT');

  await playThreePlayerGame(pages, 0);

  await expect(pages[1].locator('#resultMessage')).toContainText('MISSION SUCCESS');
  await expect(pages[1].locator('#resultMessage')).toContainText('remained undetected');
  await expect(pages[0].locator('#resultMessage')).toContainText('CATASTROPHIC FAILURE');
  await expect(pages[0].locator('#resultMessage')).toContainText('bomb detonates');
  await expect(pages[2].locator('#resultMessage')).toContainText('CATASTROPHIC FAILURE');
  await expect(pages[1].locator('#finalStats')).toContainText('Agent1 (DOUBLE AGENT)');

  await closeAll(contexts);
});

// ----------------------------------------------------------------------------
// Outcome #3: every Track Target mission *succeeds* and DA (P1) escapes the
// vote. Sabotage criterion fails (zero failures in every round) -> agents win
// "through alternative means". Also exercises the resolveMission success
// branch + per-mission top-up.
// ----------------------------------------------------------------------------
test('agents win — alternative means (DA escapes but no sabotage)', async ({ browser, request }) => {
  await configureServer(request, { deck: ['Tracking Device'], doubleAgentIndex: 1 });
  const { contexts, pages } = await setupLobby(browser, ['Agent0', 'Agent1', 'Agent2']);

  await expect(pages[1].locator('#roleBadge')).toHaveText('DOUBLE AGENT');

  await playThreePlayerGame(pages, 0);

  await expect(pages[0].locator('#resultMessage')).toContainText('PARTIAL SUCCESS');
  await expect(pages[0].locator('#resultMessage')).toContainText('alternative means');
  await expect(pages[1].locator('#resultMessage')).toContainText('MISSION FAILURE');
  await expect(pages[1].locator('#resultMessage')).toContainText('sabotage was insufficient');
  await expect(pages[2].locator('#resultMessage')).toContainText('PARTIAL SUCCESS');

  for (const page of pages) {
    await expect(page.locator('#finalStats')).toContainText('Mission Points: 3');
  }

  await closeAll(contexts);
});

// ----------------------------------------------------------------------------
// 2-player mission flow: pick Infiltrate Enemy Base, manually choose a
// teammate, run all 3 rounds. All-Lockpick deck -> every mission succeeds.
// ----------------------------------------------------------------------------
test('two-player mission flow with manual teammate selection', async ({ browser, request }) => {
  await configureServer(request, { deck: ['Lockpick Set'], doubleAgentIndex: 0 });
  const { contexts, pages } = await setupLobby(browser, ['Agent0', 'Agent1', 'Agent2']);

  await expect(pages[0].locator('#roleBadge')).toHaveText('DOUBLE AGENT');

  await playTwoPlayerMissionGame(pages, 0);

  await expect(pages[0].locator('#resultMessage')).toContainText('MISSION FAILURE');
  await expect(pages[0].locator('#resultMessage')).toContainText('cover has been blown');
  await expect(pages[1].locator('#resultMessage')).toContainText('MISSION SUCCESS');

  // 9 missions, each succeeds, each leader gets 1 point per turn led (3 each).
  for (const page of pages) {
    await expect(page.locator('#finalStats')).toContainText('Mission Points: 3');
  }

  await closeAll(contexts);
});
