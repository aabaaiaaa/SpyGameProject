// Pure game logic, extracted from server.js so it can be unit-tested in
// isolation (no socket.io, no shared module state, no setTimeouts).
//
// Every function here is either pure or takes the bits of state it operates
// on as parameters. server.js still owns the gameState container and the
// socket plumbing.

const ITEM_TYPES = [
  'Encrypted USB', 'Satellite Phone', 'Fingerprint Scanner',
  'Night Vision Goggles', 'Lockpick Set', 'Tracking Device',
  'Disguise Kit', 'Poison Vial', 'Decoder Ring', 'Blueprint',
];

const MISSIONS = [
  {
    id: 1,
    name: 'Infiltrate Enemy Base',
    description: 'Breach security and gather intelligence',
    playersNeeded: 2,
    itemsRequired: 'Lockpick Set',
    itemCount: 1,
  },
  {
    id: 2,
    name: 'Decode Enemy Communications',
    description: 'Intercept and decrypt classified messages',
    playersNeeded: 2,
    itemsRequired: 'Decoder Ring',
    itemCount: 1,
  },
  {
    id: 3,
    name: 'Track Target Location',
    description: 'Locate and monitor high-value target',
    playersNeeded: 3,
    itemsRequired: 'Tracking Device',
    itemCount: 2,
  },
];

// Fisher-Yates with an injectable RNG so tests can pin the order.
function shuffleDeck(deck, random = Math.random) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// 80-card deck: 8 of each item type. Caller decides whether to shuffle.
function createDeck() {
  const deck = [];
  for (let i = 0; i < 8; i++) {
    ITEM_TYPES.forEach((item) => deck.push(item));
  }
  return deck;
}

// Public list of items in {id, name} order — useful for the client/UI list.
function getItemTypes() {
  return [...ITEM_TYPES];
}

function getMissions() {
  return MISSIONS.map((m) => ({ ...m }));
}

// Compute mission outcome from submitted cards.
//   submittedCards: { [playerId]: card | null }
// Returns: { success, requiredItemCount }.
function evaluateMission(mission, submittedCards) {
  const submittedItems = Object.values(submittedCards).filter((c) => c !== null);
  const requiredItemCount = submittedItems.filter((c) => c === mission.itemsRequired).length;
  return {
    success: requiredItemCount >= mission.itemCount,
    requiredItemCount,
  };
}

// Compute persons-of-interest from a round's votes.
//   votes: { [voterId]: votedForId }
//   players: [{ id, name, ... }]
// Returns: array of names tied for the most votes.
function computePersonsOfInterest(votes, players) {
  const voteCounts = {};
  players.forEach((p) => { voteCounts[p.id] = 0; });
  Object.values(votes).forEach((id) => { voteCounts[id] = (voteCounts[id] || 0) + 1; });

  const maxVotes = Math.max(...Object.values(voteCounts));
  return Object.keys(voteCounts)
    .filter((id) => voteCounts[id] === maxVotes)
    .map((id) => {
      const p = players.find((pp) => pp.id === id);
      return p ? p.name : null;
    })
    .filter((name) => name !== null);
}

// Compute the end-game outcome.
//   votes:           round-3 final votes ({ voterId: targetId })
//   players:         array of players ({ id, name })
//   doubleAgentId:   id of the double agent
//   missionsFailed:  [r1, r2, r3] failure counts
// Returns:
//   { result: 'agents-win' | 'double-agent-wins', branch, doubleAgentCaught,
//     doubleAgentSucceeded, suspectedIds }
//
// Branches:
//   'caught'      -> DA was in the most-voted set (agents win)
//   'sabotage'    -> DA escaped and sabotaged every round (double agent wins)
//   'alternative' -> DA escaped but missed at least one round of sabotage
//                    (agents win via alternative means)
function computeOutcome(votes, players, doubleAgentId, missionsFailed) {
  // Tally votes (only count actual targets — players who didn't vote contribute
  // nothing). Matches server's endGame() behaviour exactly.
  const voteCounts = {};
  Object.values(votes).forEach((id) => {
    voteCounts[id] = (voteCounts[id] || 0) + 1;
  });

  if (Object.keys(voteCounts).length === 0) {
    // No votes recorded — degenerate state; treat as no one caught.
    return {
      result: missionsFailed.every((f) => f >= 1) ? 'double-agent-wins' : 'agents-win',
      branch: missionsFailed.every((f) => f >= 1) ? 'sabotage' : 'alternative',
      doubleAgentCaught: false,
      doubleAgentSucceeded: missionsFailed.every((f) => f >= 1),
      suspectedIds: [],
    };
  }

  const maxVotes = Math.max(...Object.values(voteCounts));
  const suspectedIds = Object.keys(voteCounts).filter((id) => voteCounts[id] === maxVotes);
  const doubleAgentCaught = suspectedIds.includes(doubleAgentId);
  const doubleAgentSucceeded = missionsFailed.every((f) => f >= 1);

  let branch;
  let result;
  if (doubleAgentCaught) {
    branch = 'caught';
    result = 'agents-win';
  } else if (doubleAgentSucceeded) {
    branch = 'sabotage';
    result = 'double-agent-wins';
  } else {
    branch = 'alternative';
    result = 'agents-win';
  }

  return { result, branch, doubleAgentCaught, doubleAgentSucceeded, suspectedIds };
}

// Sanitize game state for sending to clients. Critically must NEVER leak the
// double agent's id or anyone's hand contents.
function sanitizeStateForClient(gameState) {
  return {
    phase: gameState.phase,
    players: gameState.players.map((p) => ({
      id: p.id,
      name: p.name,
      missionPoints: p.missionPoints,
      handSize: p.hand.length,
      ready: p.ready,
    })),
    messages: gameState.messages,
    currentRound: gameState.currentRound,
    currentPlayerIndex: gameState.currentPlayerIndex,
    currentMission: gameState.currentMission,
    selectedPlayers: gameState.selectedPlayers,
    submittedCardPlayers: Object.keys(gameState.submittedCards),
    personsOfInterest: gameState.personsOfInterest,
    missionsFailed: gameState.missionsFailed,
    roundComplete: gameState.roundComplete,
    missionStarted: gameState.missionStarted,
  };
}

module.exports = {
  ITEM_TYPES,
  MISSIONS,
  createDeck,
  shuffleDeck,
  getItemTypes,
  getMissions,
  evaluateMission,
  computePersonsOfInterest,
  computeOutcome,
  sanitizeStateForClient,
};
