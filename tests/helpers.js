const { expect } = require('@playwright/test');

// Server is in TEST_MODE (see playwright.config.js). Reset state + pin deck
// pattern + DA seat before each scenario.
async function configureServer(request, { deck, doubleAgentIndex = 0 } = {}) {
  const res = await request.post('/__test/reset', {
    data: { deck: deck || null, doubleAgentIndex },
  });
  expect(res.ok()).toBeTruthy();
  // Settle any in-flight setTimeouts left over from prior tests (max ~200ms in
  // TEST_MODE). Cheaper than refactoring the server to track + clear them.
  await new Promise((r) => setTimeout(r, 300));
}

async function joinLobby(page, name) {
  await page.goto('/');
  await page.locator('#playerName').fill(name);
  await page.locator('button:has-text("ENTER OPERATION")').click();
  await expect(page.locator('#lobbyScreen')).toBeVisible();
}

async function setupLobby(browser, names) {
  const contexts = await Promise.all(names.map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  pages.forEach((p, i) =>
    p.on('pageerror', (e) => console.error(`[P${i}]`, e.message))
  );

  for (let i = 0; i < names.length; i++) {
    await joinLobby(pages[i], names[i]);
  }
  for (const page of pages) {
    await expect(page.locator('.player-item')).toHaveCount(names.length);
  }
  for (const page of pages) await page.locator('#readyBtn').click();
  for (const page of pages) await expect(page.locator('#gameScreen')).toBeVisible();

  return { contexts, pages };
}

async function closeAll(contexts) {
  await Promise.all(contexts.map((c) => c.close().catch(() => {})));
}

// Each on-mission player submits their first card. Players not on the mission
// (or with empty hands) get auto-null'd by the server, so their UI never
// shows the card select. Runs in parallel so non-participants' timeout
// doesn't serialize against MISSION_RESOLVE_MS hiding the next state.
//
// We use page.evaluate(submitCard) instead of clicking an item-card. The
// `cardSubmitted` event triggers updateGameScreen which replaces #missionCardSelect's
// children, racing against Playwright's click attempt and occasionally missing.
// Calling the global submitCard(0) directly avoids the race; the underlying
// socket.emit is still the same code path.
async function submitFirstCardAll(pages, timeoutMs = 1500) {
  await Promise.all(
    pages.map(async (page) => {
      try {
        await page.locator('#cardSelect').waitFor({ state: 'visible', timeout: timeoutMs });
        await page.evaluate(() => {
          /* global submitCard */
          if (typeof submitCard === 'function') submitCard(0);
        });
      } catch {
        /* not on this mission */
      }
    })
  );
}

// Drive a full 3-round game using "Track Target Location" (3-player auto-fill
// mission). After each round every player votes for the option at voteIndex
// in their own grid.
async function playThreePlayerGame(pages, voteIndex = 0) {
  for (let round = 1; round <= 3; round++) {
    for (let turn = 0; turn < 3; turn++) {
      const leader = pages[turn];
      await expect(leader.locator('#roundIndicator')).toHaveText(`ROUND ${round}/3`);
      await expect(leader.locator('#missionSelect')).toBeVisible();
      await leader.locator('.mission-card', { hasText: 'Track Target Location' }).click();
      await expect(leader.locator('#startMissionBtn')).toBeEnabled();
      await leader.locator('#startMissionBtn').click();
      await submitFirstCardAll(pages);
    }
    for (const page of pages) {
      await expect(page.locator('#votingArea')).toBeVisible();
      await page.locator('.vote-option').nth(voteIndex).click();
    }
    if (round < 3) {
      for (const page of pages) {
        await expect(page.locator('#roundIndicator')).toHaveText(`ROUND ${round + 1}/3`);
      }
    }
  }
  for (const page of pages) await expect(page.locator('#gameoverScreen')).toBeVisible();
}

// Same as above but uses "Infiltrate Enemy Base" (2-player mission), which
// requires manual teammate selection.
async function playTwoPlayerMissionGame(pages, voteIndex = 0) {
  for (let round = 1; round <= 3; round++) {
    for (let turn = 0; turn < 3; turn++) {
      const leader = pages[turn];
      await expect(leader.locator('#roundIndicator')).toHaveText(`ROUND ${round}/3`);
      await expect(leader.locator('#missionSelect')).toBeVisible();
      await leader.locator('.mission-card', { hasText: 'Infiltrate Enemy Base' }).click();
      await expect(leader.locator('#playerSelect')).toBeVisible();
      await leader.locator('#playerSelectGrid .player-select').first().click();
      await expect(leader.locator('#startMissionBtn')).toBeEnabled();
      await leader.locator('#startMissionBtn').click();
      await submitFirstCardAll(pages);
    }
    for (const page of pages) {
      await expect(page.locator('#votingArea')).toBeVisible();
      await page.locator('.vote-option').nth(voteIndex).click();
    }
    if (round < 3) {
      for (const page of pages) {
        await expect(page.locator('#roundIndicator')).toHaveText(`ROUND ${round + 1}/3`);
      }
    }
  }
  for (const page of pages) await expect(page.locator('#gameoverScreen')).toBeVisible();
}

// Drive a single mission turn for arbitrary player counts: the leader picks
// the named mission, manually selects N-1 teammates (`.first()` each time),
// starts, and everyone submits their first card.
async function runMissionTurn(pages, leaderIndex, missionName, teammatesNeeded) {
  const leader = pages[leaderIndex];
  await expect(leader.locator('#missionSelect')).toBeVisible();
  await leader.locator('.mission-card', { hasText: missionName }).click();

  if (teammatesNeeded > 0) {
    await expect(leader.locator('#playerSelect')).toBeVisible();
    for (let i = 0; i < teammatesNeeded; i++) {
      const remaining = leader.locator('#playerSelectGrid .player-select:not(.selected)');
      await remaining.first().click();
    }
  }

  await expect(leader.locator('#startMissionBtn')).toBeEnabled();
  await leader.locator('#startMissionBtn').click();
  await submitFirstCardAll(pages);
}

// Each player votes for a specific player name (must appear in their own grid).
async function voteByName(pages, voteTargetNames) {
  for (let i = 0; i < pages.length; i++) {
    await expect(pages[i].locator('#votingArea')).toBeVisible();
    await pages[i].locator('.vote-option', { hasText: voteTargetNames[i] }).click();
  }
}

module.exports = {
  configureServer,
  joinLobby,
  setupLobby,
  closeAll,
  submitFirstCardAll,
  playThreePlayerGame,
  playTwoPlayerMissionGame,
  runMissionTurn,
  voteByName,
};
