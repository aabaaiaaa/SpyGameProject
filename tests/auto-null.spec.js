const { test, expect } = require('@playwright/test');
const {
  configureServer,
  setupLobby,
  closeAll,
  submitFirstCardAll,
} = require('./helpers');

// Trigger the `startMission` auto-null branch: when a selected player has
// hand.length === 0, the server sets submittedCards[id] = null without
// waiting for them. The client should never show that player a #cardSelect.
//
// Setup: 4 players + 2-player Infiltrate Enemy Base + all-USB deck (every
// mission fails). Each leader's grid begins with Agent0 (test always picks
// .first()), so Agent0 gets picked every turn:
//   t0: P0 leads, picks P1.  Net cards:  P0=-3=2, P1=-1=4, P2=5,  P3=5
//   t1: P1 leads, picks P0.  Net:        P0=1,    P1=1,    P2=5,  P3=5
//   t2: P2 leads, picks P0.  Net:        P0=0,    P1=1,    P2=2,  P3=5
//   t3: P3 leads, picks P0.  <-- P0 enters with 0 cards -> auto-null
test('selected player with 0 cards is auto-null submitted, UI never prompts them', async ({
  browser,
  request,
}) => {
  await configureServer(request, { deck: ['Encrypted USB'], doubleAgentIndex: 0 });
  const { contexts, pages } = await setupLobby(browser, ['Agent0', 'Agent1', 'Agent2', 'Agent3']);

  const handCount = (p) => p.locator('#handCount');

  // --- t0: P0 leads, picks first teammate (P1). Both submit; mission fails.
  await pages[0].locator('.mission-card', { hasText: 'Infiltrate Enemy Base' }).click();
  await pages[0].locator('#playerSelectGrid .player-select').first().click();
  await pages[0].locator('#startMissionBtn').click();
  await submitFirstCardAll(pages);
  await expect(handCount(pages[0])).toHaveText('2');

  // --- t1: P1 leads, picks P0.
  await expect(pages[1].locator('#missionSelect')).toBeVisible();
  await pages[1].locator('.mission-card', { hasText: 'Infiltrate Enemy Base' }).click();
  await pages[1].locator('#playerSelectGrid .player-select').first().click();
  await pages[1].locator('#startMissionBtn').click();
  await submitFirstCardAll(pages);
  await expect(handCount(pages[0])).toHaveText('1');

  // --- t2: P2 leads, picks P0. P0 submits last card -> drained to 0.
  await expect(pages[2].locator('#missionSelect')).toBeVisible();
  await pages[2].locator('.mission-card', { hasText: 'Infiltrate Enemy Base' }).click();
  await pages[2].locator('#playerSelectGrid .player-select').first().click();
  await pages[2].locator('#startMissionBtn').click();
  await submitFirstCardAll(pages);
  await expect(handCount(pages[0])).toHaveText('0');

  // --- t3 (the test of interest): P3 leads, picks P0. P0 enters mission with
  // 0 cards. After START, server auto-nulls P0; only P3 sees #cardSelect.
  await expect(pages[3].locator('#missionSelect')).toBeVisible();
  await pages[3].locator('.mission-card', { hasText: 'Infiltrate Enemy Base' }).click();
  await pages[3].locator('#playerSelectGrid .player-select').first().click();
  await pages[3].locator('#startMissionBtn').click();

  // Critical assertion: P0's card-select UI is NOT shown even though P0 is
  // on the mission. Wait long enough that we'd have seen it if it were
  // going to appear (cardSelect renders almost immediately on missionStarted).
  await pages[3].locator('#cardSelect').waitFor({ state: 'visible' });
  await expect(pages[0].locator('#cardSelect')).toBeHidden();
  await expect(handCount(pages[0])).toHaveText('0');

  // P3 submits their only required card; mission resolves with one null
  // contribution and one USB -> still a failure.
  await pages[3].locator('#missionCardSelect .item-card').first().click();

  // Wait for round 1's vote (start of round 2 voting indicates round 1's
  // missions all resolved, including the auto-null one).
  for (const page of pages) {
    await expect(page.locator('#votingArea')).toBeVisible();
  }

  // Don't run the rest of the game — the auto-null assertion is the goal.
  await closeAll(contexts);
});
