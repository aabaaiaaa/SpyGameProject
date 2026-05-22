const { test, expect } = require('@playwright/test');
const {
  configureServer,
  setupLobby,
  closeAll,
  submitFirstCardAll,
} = require('./helpers');

// With 4 players, Mission 3 (Track Target, needs 3) no longer auto-fills —
// it requires manual teammate selection like Mission 1 does. This test runs
// a 4-player game using Mission 3 to exercise that branch.
test('4-player game completes with manual teammate selection on 3-player mission', async ({
  browser,
  request,
}) => {
  await configureServer(request, { deck: ['Tracking Device'], doubleAgentIndex: 0 });
  const { contexts, pages } = await setupLobby(browser, ['Agent0', 'Agent1', 'Agent2', 'Agent3']);

  await expect(pages[0].locator('#roleBadge')).toHaveText('DOUBLE AGENT');
  for (const i of [1, 2, 3]) {
    await expect(pages[i].locator('#roleBadge')).toHaveText('FIELD AGENT');
  }

  for (let round = 1; round <= 3; round++) {
    for (let turn = 0; turn < 4; turn++) {
      const leader = pages[turn];
      await expect(leader.locator('#roundIndicator')).toHaveText(`ROUND ${round}/3`);
      await expect(leader.locator('#missionSelect')).toBeVisible();
      await leader.locator('.mission-card', { hasText: 'Track Target Location' }).click();

      // Need to pick 2 teammates (3-player mission with 4 players in lobby).
      await expect(leader.locator('#playerSelect')).toBeVisible();
      await leader.locator('#playerSelectGrid .player-select').nth(0).click();
      // Wait for the click to register server-side before picking the next one.
      await expect(leader.locator('#playerSelectGrid .player-select.selected')).toHaveCount(1);
      await leader.locator('#playerSelectGrid .player-select:not(.selected)').nth(0).click();
      await expect(leader.locator('#playerSelectGrid .player-select.selected')).toHaveCount(2);

      await expect(leader.locator('#startMissionBtn')).toBeEnabled();
      await leader.locator('#startMissionBtn').click();
      await submitFirstCardAll(pages);
    }

    // 4 vote options each (3 non-self players) — everyone votes first.
    for (const page of pages) {
      await expect(page.locator('#votingArea')).toBeVisible();
      await page.locator('.vote-option').first().click();
    }

    if (round < 3) {
      for (const page of pages) {
        await expect(page.locator('#roundIndicator')).toHaveText(`ROUND ${round + 1}/3`);
      }
    }
  }

  for (const page of pages) {
    await expect(page.locator('#gameoverScreen')).toBeVisible();
  }

  // With all-Tracker deck + Track Target (needs 2 of 3 submissions), every
  // 3-player mission gets >=2 Trackers from the chosen team -> SUCCESS.
  // 4 leaders x 3 rounds = 12 missions, every leader gets 1 point per turn
  // led (3 led each) -> 3 points each in final stats.
  for (const page of pages) {
    await expect(page.locator('#finalStats')).toContainText('Mission Points: 3');
  }

  await closeAll(contexts);
});
