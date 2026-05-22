const { test, expect } = require('@playwright/test');
const {
  configureServer,
  setupLobby,
  closeAll,
  submitFirstCardAll,
} = require('./helpers');

// Run a single round of 3 turns (Track Target, all auto-fill). Each leader
// just clicks the mission + BEGIN; everyone submits their first card.
async function playOneRound(pages, expectedRound) {
  for (let turn = 0; turn < 3; turn++) {
    const leader = pages[turn];
    await expect(leader.locator('#roundIndicator')).toHaveText(`ROUND ${expectedRound}/3`);
    await expect(leader.locator('#missionSelect')).toBeVisible();
    await leader.locator('.mission-card', { hasText: 'Track Target Location' }).click();
    await leader.locator('#startMissionBtn').click();
    await submitFirstCardAll(pages);
  }
}

// POI is set when `processVotes` runs and persists in gameState until the
// NEXT round's vote starts (startVoting clears it before that round's vote
// completes). UI mirror: #playerStatus marks suspects with a red border +
// `[SUSPECT]` and the #suspectList sidebar shows their names.
test('person-of-interest persists through next round and clears in next vote', async ({
  browser,
  request,
}) => {
  await configureServer(request, { deck: ['Encrypted USB'], doubleAgentIndex: 0 });
  const { contexts, pages } = await setupLobby(browser, ['Agent0', 'Agent1', 'Agent2']);

  // --- Round 1: play, then everyone votes the first option (-> P0 = 2 votes)
  await playOneRound(pages, 1);
  for (const page of pages) {
    await expect(page.locator('#votingArea')).toBeVisible();
    await page.locator('.vote-option').first().click();
  }

  // Wait until round 2 starts (phaseChange + playing).
  for (const page of pages) {
    await expect(page.locator('#roundIndicator')).toHaveText('ROUND 2/3');
  }

  // POI from round 1 (Agent0) should now be marked on every client's player
  // status panel + suspect sidebar.
  for (const page of pages) {
    await expect(page.locator('#suspectList')).toContainText('Agent0');
    // #playerStatus shows "[SUSPECT]" alongside the suspected player's name.
    await expect(page.locator('#playerStatus')).toContainText('[SUSPECT]');
  }

  // --- Round 2: play, then start the vote. startVoting clears the previous
  // round's POI BEFORE the vote completes, so during round 2's voting screen
  // there should be no leftover [SUSPECT] markings.
  await playOneRound(pages, 2);
  for (const page of pages) {
    await expect(page.locator('#votingArea')).toBeVisible();
    // Sidebar suspect list refreshed (now empty mid-vote until votes process).
    await expect(page.locator('#suspectList')).toContainText('None identified');
  }

  // Cast round-2 votes: everyone votes 2nd option this time (Agent2 / Agent2 /
  // Agent1) so the new POI differs from round 1's.
  //   P0 sees [Agent1, Agent2] -> picks Agent2
  //   P1 sees [Agent0, Agent2] -> picks Agent2
  //   P2 sees [Agent0, Agent1] -> picks Agent1
  // -> Agent2 has 2 votes -> new POI = Agent2.
  for (const page of pages) {
    await page.locator('.vote-option').nth(1).click();
  }

  for (const page of pages) {
    await expect(page.locator('#roundIndicator')).toHaveText('ROUND 3/3');
  }

  // Round 3 shows the new POI from round 2, not the stale Agent0.
  for (const page of pages) {
    await expect(page.locator('#suspectList')).toContainText('Agent2');
    await expect(page.locator('#suspectList')).not.toContainText('Agent0');
  }

  await closeAll(contexts);
});
