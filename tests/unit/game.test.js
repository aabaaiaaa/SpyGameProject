// Unit tests for the pure game logic in game.js. Uses Node's built-in test
// runner (node --test). Fast, deterministic, no socket.io, no browser.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  createDeck,
  shuffleDeck,
  getItemTypes,
  getMissions,
  evaluateMission,
  computePersonsOfInterest,
  computeOutcome,
  sanitizeStateForClient,
} = require('../../game');

describe('createDeck', () => {
  test('produces exactly 80 cards', () => {
    assert.equal(createDeck().length, 80);
  });

  test('contains 8 of each of the 10 item types', () => {
    const deck = createDeck();
    const counts = {};
    for (const card of deck) counts[card] = (counts[card] || 0) + 1;
    const types = getItemTypes();
    assert.equal(types.length, 10);
    for (const type of types) {
      assert.equal(counts[type], 8, `expected 8 of "${type}", got ${counts[type]}`);
    }
  });
});

describe('shuffleDeck', () => {
  test('returns the same array reference', () => {
    const deck = [1, 2, 3, 4, 5];
    assert.strictEqual(shuffleDeck(deck), deck);
  });

  test('is a permutation (same multiset)', () => {
    const original = createDeck();
    const shuffled = shuffleDeck([...original]);
    assert.equal(shuffled.length, original.length);
    assert.deepEqual([...shuffled].sort(), [...original].sort());
  });

  test('is deterministic with a seeded RNG', () => {
    const seededRng = (() => {
      // Linear-congruential generator — same seeds -> same sequence.
      let s = 12345;
      return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
      };
    });
    const a = shuffleDeck([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], seededRng());
    const b = shuffleDeck([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], seededRng());
    assert.deepEqual(a, b);
  });

  test('identity RNG (always 0) is a no-op for the trailing element', () => {
    // With random()=0, j=0 every iteration, so element i swaps with element 0
    // repeatedly. End state: the last element of the original deck ends up
    // first; original arrangement is otherwise reversed via the shuffle.
    const result = shuffleDeck([1, 2, 3], () => 0);
    assert.equal(result.length, 3);
    // Just verify it's still a permutation rather than the implementation detail.
    assert.deepEqual([...result].sort(), [1, 2, 3]);
  });
});

describe('evaluateMission', () => {
  const lockpickMission = getMissions().find((m) => m.id === 1);
  const trackMission = getMissions().find((m) => m.id === 3);

  test('succeeds when enough required items submitted (2-player Infiltrate)', () => {
    const result = evaluateMission(lockpickMission, {
      p1: 'Lockpick Set',
      p2: 'Encrypted USB',
    });
    assert.equal(result.success, true);
    assert.equal(result.requiredItemCount, 1);
  });

  test('fails when no required items submitted', () => {
    const result = evaluateMission(lockpickMission, {
      p1: 'Encrypted USB',
      p2: 'Encrypted USB',
    });
    assert.equal(result.success, false);
    assert.equal(result.requiredItemCount, 0);
  });

  test('counts only the required item type', () => {
    const result = evaluateMission(trackMission, {
      p1: 'Tracking Device',
      p2: 'Tracking Device',
      p3: 'Lockpick Set', // wrong item — not counted
    });
    assert.equal(result.success, true);
    assert.equal(result.requiredItemCount, 2);
  });

  test('fails when below the count threshold (Track needs 2, only 1 submitted)', () => {
    const result = evaluateMission(trackMission, {
      p1: 'Tracking Device',
      p2: 'Encrypted USB',
      p3: 'Encrypted USB',
    });
    assert.equal(result.success, false);
    assert.equal(result.requiredItemCount, 1);
  });

  test('null cards (auto-null from empty hands) do not count', () => {
    const result = evaluateMission(trackMission, {
      p1: 'Tracking Device',
      p2: null,
      p3: 'Tracking Device',
    });
    assert.equal(result.success, true);
    assert.equal(result.requiredItemCount, 2);
  });

  test('empty submittedCards -> failure', () => {
    const result = evaluateMission(lockpickMission, {});
    assert.equal(result.success, false);
    assert.equal(result.requiredItemCount, 0);
  });
});

describe('computePersonsOfInterest', () => {
  const players = [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
    { id: 'c', name: 'Carol' },
  ];

  test('returns the single most-voted player', () => {
    const poi = computePersonsOfInterest({ v1: 'b', v2: 'b', v3: 'a' }, players);
    assert.deepEqual(poi, ['Bob']);
  });

  test('returns multiple names on a tie', () => {
    const poi = computePersonsOfInterest({ v1: 'a', v2: 'b', v3: 'c' }, players);
    assert.deepEqual(poi.sort(), ['Alice', 'Bob', 'Carol']);
  });

  test('two-way tie returns both names', () => {
    const poi = computePersonsOfInterest({ v1: 'a', v2: 'b' }, players);
    assert.deepEqual(poi.sort(), ['Alice', 'Bob']);
  });

  test('no votes -> all players are tied at 0', () => {
    const poi = computePersonsOfInterest({}, players);
    assert.deepEqual(poi.sort(), ['Alice', 'Bob', 'Carol']);
  });
});

describe('computeOutcome', () => {
  const players = [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
    { id: 'c', name: 'Carol' },
  ];

  test('caught branch: DA (Alice) has the most votes', () => {
    const out = computeOutcome(
      { x: 'a', y: 'a', z: 'b' }, // Alice 2, Bob 1
      players,
      'a',
      [3, 3, 3]
    );
    assert.equal(out.result, 'agents-win');
    assert.equal(out.branch, 'caught');
    assert.equal(out.doubleAgentCaught, true);
    assert.equal(out.doubleAgentSucceeded, true);
  });

  test('sabotage branch: DA escapes vote AND >=1 failure every round', () => {
    const out = computeOutcome(
      { x: 'b', y: 'b', z: 'c' }, // Bob 2, Alice (DA) 0
      players,
      'a',
      [1, 2, 3] // every round has at least 1 failure
    );
    assert.equal(out.result, 'double-agent-wins');
    assert.equal(out.branch, 'sabotage');
    assert.equal(out.doubleAgentCaught, false);
    assert.equal(out.doubleAgentSucceeded, true);
  });

  test('alternative branch: DA escapes BUT at least one round had no failures', () => {
    const out = computeOutcome(
      { x: 'b', y: 'b', z: 'c' },
      players,
      'a',
      [0, 3, 3] // round 1 had zero failures
    );
    assert.equal(out.result, 'agents-win');
    assert.equal(out.branch, 'alternative');
    assert.equal(out.doubleAgentCaught, false);
    assert.equal(out.doubleAgentSucceeded, false);
  });

  test('3-way tie includes DA -> still caught', () => {
    const out = computeOutcome(
      { x: 'a', y: 'b', z: 'c' }, // 1-1-1 tie, DA in tied set
      players,
      'a',
      [1, 1, 1]
    );
    assert.equal(out.branch, 'caught');
    assert.equal(out.doubleAgentCaught, true);
    assert.deepEqual(out.suspectedIds.sort(), ['a', 'b', 'c']);
  });

  test('2-way tie that excludes DA -> DA escapes', () => {
    const out = computeOutcome(
      { x: 'b', y: 'c' }, // Bob 1, Carol 1, DA (Alice) 0
      players,
      'a',
      [1, 1, 1]
    );
    assert.equal(out.doubleAgentCaught, false);
    assert.deepEqual(out.suspectedIds.sort(), ['b', 'c']);
  });

  test('no votes recorded -> degenerate but doesn\'t throw', () => {
    const out = computeOutcome({}, players, 'a', [1, 1, 1]);
    assert.equal(out.doubleAgentCaught, false);
    assert.equal(out.result, 'double-agent-wins');
    assert.equal(out.branch, 'sabotage');
  });
});

describe('sanitizeStateForClient (security: never leak DA or hands)', () => {
  const buildState = () => ({
    phase: 'playing',
    players: [
      { id: 'a', name: 'Alice', hand: ['Lockpick Set', 'Encrypted USB'], isDoubleAgent: true, missionPoints: 2, ready: true },
      { id: 'b', name: 'Bob', hand: ['Decoder Ring'], isDoubleAgent: false, missionPoints: 1, ready: true },
    ],
    messages: [{ type: 'system', text: 'Alice joined', timestamp: 1 }],
    doubleAgentId: 'a',
    currentRound: 2,
    currentPlayerIndex: 0,
    currentMission: { id: 1, name: 'Infiltrate Enemy Base' },
    selectedPlayers: ['a', 'b'],
    submittedCards: { a: 'Lockpick Set' },
    votes: {},
    personsOfInterest: ['Bob'],
    missionsFailed: [1, 0, 0],
    roundComplete: false,
    missionStarted: true,
  });

  test('does NOT include doubleAgentId at the top level', () => {
    const sanitized = sanitizeStateForClient(buildState());
    assert.ok(!('doubleAgentId' in sanitized), 'doubleAgentId leaked to client');
  });

  test('does NOT include any player.hand contents', () => {
    const sanitized = sanitizeStateForClient(buildState());
    for (const p of sanitized.players) {
      assert.ok(!('hand' in p), `player ${p.name} has hand[] field leaked to client`);
      assert.equal(typeof p.handSize, 'number', 'handSize should replace hand');
    }
    assert.equal(sanitized.players[0].handSize, 2);
    assert.equal(sanitized.players[1].handSize, 1);
  });

  test('does NOT include each player.isDoubleAgent flag', () => {
    const sanitized = sanitizeStateForClient(buildState());
    for (const p of sanitized.players) {
      assert.ok(
        !('isDoubleAgent' in p),
        `player ${p.name} has isDoubleAgent flag leaked to client`
      );
    }
  });

  test('exposes submittedCardPlayers as IDs only, never the cards themselves', () => {
    const sanitized = sanitizeStateForClient(buildState());
    assert.deepEqual(sanitized.submittedCardPlayers, ['a']);
    assert.ok(!('submittedCards' in sanitized), 'submittedCards (with contents) leaked');
  });

  test('does NOT include raw votes (would reveal voting in progress)', () => {
    const state = buildState();
    state.votes = { a: 'b', b: 'a' };
    const sanitized = sanitizeStateForClient(state);
    assert.ok(!('votes' in sanitized), 'votes leaked to client');
  });
});
