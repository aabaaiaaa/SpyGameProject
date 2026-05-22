const { test, expect } = require('@playwright/test');
const {
  configureServer,
  setupLobby,
  closeAll,
  submitFirstCardAll,
  voteByName,
} = require('./helpers');

async function playOneRound(pages, expectedRound) {
  for (let turn = 0; turn < 3; turn++) {
    const leader = pages[turn];
    await expect(leader.locator('#roundIndicator')).toHaveText(`ROUND ${expectedRound}/3`);
    await leader.locator('.mission-card', { hasText: 'Track Target Location' }).click();
    await leader.locator('#startMissionBtn').click();
    await submitFirstCardAll(pages);
  }
}

// In a 3-way 1-1-1 tie EVERY player is a POI. Since the DA is one of them,
// `suspectedIds.includes(doubleAgentId)` is true -> DA caught -> agents win.
// This is a distinct branch from the single-POI tests in game.spec.js.
test('three-way tied vote produces multi-POI and catches DA', async ({ browser, request }) => {
  await configureServer(request, { deck: ['Encrypted USB'], doubleAgentIndex: 0 });
  const { contexts, pages } = await setupLobby(browser, ['Agent0', 'Agent1', 'Agent2']);

  // Rounds 1 & 2: vote in a rotation so each player has 1 vote (3-way tie):
  //   P0 votes Agent1; P1 votes Agent2; P2 votes Agent0.
  for (let round = 1; round <= 2; round++) {
    await playOneRound(pages, round);
    await voteByName(pages, ['Agent1', 'Agent2', 'Agent0']);
    for (const page of pages) {
      await expect(page.locator('#roundIndicator')).toHaveText(`ROUND ${round + 1}/3`);
    }
    // After roundComplete fires, the POI display should list all 3 names
    // because each got 1 vote. (Sidebar is updated by getGameStateForClient.)
    if (round === 1 || round === 2) {
      // POI from previous round persists into next round's UI.
      for (const page of pages) {
        const suspectList = page.locator('#suspectList');
        await expect(suspectList).toContainText('Agent0');
        await expect(suspectList).toContainText('Agent1');
        await expect(suspectList).toContainText('Agent2');
      }
    }
  }

  // --- Round 3 final: same rotation tie -> all 3 in POI -> DA in POI -> caught.
  await playOneRound(pages, 3);
  await voteByName(pages, ['Agent1', 'Agent2', 'Agent0']);

  for (const page of pages) {
    await expect(page.locator('#gameoverScreen')).toBeVisible();
  }

  // P0 is the DA; with all 3 tied, DA is among the suspectedIds -> caught.
  await expect(pages[0].locator('#resultMessage')).toContainText('MISSION FAILURE');
  await expect(pages[0].locator('#resultMessage')).toContainText('cover has been blown');
  await expect(pages[1].locator('#resultMessage')).toContainText('MISSION SUCCESS');

  await closeAll(contexts);
});
