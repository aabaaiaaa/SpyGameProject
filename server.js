const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const TEST_MODE = process.env.TEST_MODE === '1';
const intEnv = (name, fallback) => parseInt(process.env[name] || String(fallback), 10);
const BRIEFING_MS = intEnv('BRIEFING_MS', TEST_MODE ? 100 : 8000);
const READY_DELAY_MS = intEnv('READY_DELAY_MS', TEST_MODE ? 50 : 2000);
const MISSION_RESOLVE_MS = intEnv('MISSION_RESOLVE_MS', TEST_MODE ? 150 : 5000);
const ROUND_DELAY_MS = intEnv('ROUND_DELAY_MS', TEST_MODE ? 200 : 5000);
const VOTE_PROCESS_MS = intEnv('VOTE_PROCESS_MS', TEST_MODE ? 100 : 2000);

// Test-mode runtime overrides, settable via POST /__test/reset.
let testDeckPattern = null; // null -> default (all "Encrypted USB")
let testDoubleAgentIndex = 0;

const game = require('./game');
const { MISSIONS, evaluateMission, computePersonsOfInterest, computeOutcome, sanitizeStateForClient } = game;

class Player {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.hand = [];
    this.isDoubleAgent = false;
    this.missionPoints = 0;
    this.ready = false;
  }
}

const gameState = {
  phase: 'lobby', // lobby, briefing, playing, voting, gameover
  players: [],
  messages: [],
  doubleAgentId: null,
  currentRound: 0,
  currentPlayerIndex: 0,
  currentMission: null,
  selectedPlayers: [],
  submittedCards: {},
  votes: {},
  personsOfInterest: [],
  missionsFailed: [0, 0, 0], // failures per round
  roundComplete: false,
  missionStarted: false
};

function createDeck() {
  if (TEST_MODE) {
    const pattern = (testDeckPattern && testDeckPattern.length > 0)
      ? testDeckPattern
      : ['Encrypted USB'];
    const out = [];
    while (out.length < 80) out.push(...pattern);
    return out.slice(0, 80);
  }
  return game.shuffleDeck(game.createDeck());
}

function dealCards() {
  const deck = createDeck();
  gameState.players.forEach(player => {
    player.hand = deck.splice(0, 5);
  });
}

function topUpCards() {
  const deck = createDeck();
  gameState.players.forEach(player => {
    while (player.hand.length < 5 && deck.length > 0) {
      player.hand.push(deck.pop());
    }
  });

  // Send updated hands to all players
  gameState.players.forEach(player => {
    const socket = io.sockets.sockets.get(player.id);
    if (socket) {
      socket.emit('updateHand', { hand: player.hand });
    }
  });
}

function selectDoubleAgent() {
  const randomIndex = TEST_MODE
    ? Math.max(0, Math.min(testDoubleAgentIndex, gameState.players.length - 1))
    : Math.floor(Math.random() * gameState.players.length);
  const doubleAgent = gameState.players[randomIndex];
  doubleAgent.isDoubleAgent = true;
  gameState.doubleAgentId = doubleAgent.id;
}

function buildOutcomeMessages(branch, doubleAgent) {
  const name = doubleAgent.name;
  if (branch === 'caught') {
    return {
      result: 'agents-win',
      agentsMessage: `MISSION SUCCESS! After intense interrogation, ${name} revealed the bomb location. The device has been secured and defused! Well done agents!`,
      doubleAgentMessage: `MISSION FAILURE! Your cover has been blown, ${name}. Under pressure, you revealed the bomb's location. You will be dealt with in a dark alley... permanently.`,
      doubleAgent: name,
    };
  }
  if (branch === 'sabotage') {
    return {
      result: 'double-agent-wins',
      agentsMessage: `CATASTROPHIC FAILURE! The double agent ${name} has succeeded! The bomb detonates! GAME OVER!`,
      doubleAgentMessage: `MISSION SUCCESS! You remained undetected, ${name}. The bomb has detonated and chaos reigns. Your handlers are pleased.`,
      doubleAgent: name,
    };
  }
  // 'alternative'
  return {
    result: 'agents-win',
    agentsMessage: `PARTIAL SUCCESS! Despite not catching ${name}, your team prevented enough sabotage. The bomb has been located and defused through alternative means!`,
    doubleAgentMessage: `MISSION FAILURE! Though you escaped detection, ${name}, your sabotage was insufficient. The bomb has been defused. Your handlers are... disappointed.`,
    doubleAgent: name,
  };
}

function startGame() {
  if (gameState.players.length < 3) return;

  gameState.phase = 'briefing';
  dealCards();
  selectDoubleAgent();
  gameState.currentRound = 1;
  gameState.currentPlayerIndex = 0;

  io.emit('gameStarted', getGameStateForClient());

  gameState.players.forEach(player => {
    const socket = io.sockets.sockets.get(player.id);
    if (socket) {
      // Send player their hand
      socket.emit('updateHand', { hand: player.hand });

      if (player.isDoubleAgent) {
        socket.emit('briefing', {
          role: 'double-agent',
          message: 'You are the DOUBLE AGENT. Your mission: Sabotage operations and avoid detection. Fail at least 1 mission per round.'
        });
      } else {
        socket.emit('briefing', {
          role: 'agent',
          message: 'URGENT: A nuclear bomb will detonate unless we find it. A double agent among us has the location. Complete missions and identify the traitor.'
        });
      }
    }
  });

  setTimeout(() => {
    gameState.phase = 'playing';
    io.emit('phaseChange', { phase: 'playing', gameState: getGameStateForClient() });
  }, BRIEFING_MS);
}

function getGameStateForClient() {
  return sanitizeStateForClient(gameState);
}

function getCurrentPlayer() {
  return gameState.players[gameState.currentPlayerIndex];
}

function nextTurn() {
  gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
  gameState.currentMission = null;
  gameState.selectedPlayers = [];
  gameState.submittedCards = {};
  gameState.missionStarted = false;
}

function checkRoundEnd() {
  const allPlayersHadTurn = gameState.players.every((player, index) => {
    if (index < gameState.currentPlayerIndex) return true;
    if (index === gameState.currentPlayerIndex) return gameState.currentMission === null;
    return false;
  });

  if (gameState.currentPlayerIndex === 0 && gameState.currentMission === null && gameState.currentRound > 0) {
    startVoting();
  }
}

function startVoting() {
  gameState.phase = 'voting';
  gameState.votes = {};
  gameState.roundComplete = true;
  gameState.personsOfInterest = []; // Clear previous round's suspects

  const isLastRound = gameState.currentRound === 3;
  io.emit('votingStarted', {
    round: gameState.currentRound,
    isLastRound: isLastRound,
    gameState: getGameStateForClient()
  });
}

function processVotes() {
  gameState.personsOfInterest = computePersonsOfInterest(gameState.votes, gameState.players);

  if (gameState.currentRound === 3) {
    endGame();
  } else {
    const previousRoundPOI = gameState.personsOfInterest;
    gameState.currentRound++;
    gameState.roundComplete = false;

    io.emit('roundComplete', {
      round: gameState.currentRound - 1,
      personsOfInterest: previousRoundPOI,
      gameState: getGameStateForClient()
    });

    setTimeout(() => {
      gameState.phase = 'playing';
      topUpCards(); // Top up all players to 5 cards at start of round
      io.emit('phaseChange', { phase: 'playing', gameState: getGameStateForClient() });
    }, ROUND_DELAY_MS);
  }
}

function endGame() {
  gameState.phase = 'gameover';

  const result = computeOutcome(
    gameState.votes,
    gameState.players,
    gameState.doubleAgentId,
    gameState.missionsFailed
  );
  const doubleAgent = gameState.players.find(p => p.id === gameState.doubleAgentId);
  const outcome = buildOutcomeMessages(result.branch, doubleAgent);

  io.emit('gameOver', {
    outcome: outcome,
    finalStats: {
      players: gameState.players.map(p => ({
        name: p.name,
        missionPoints: p.missionPoints,
        isDoubleAgent: p.isDoubleAgent
      })),
      missionsFailed: gameState.missionsFailed
    }
  });
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('joinLobby', (playerName) => {
    if (gameState.phase !== 'lobby') {
      socket.emit('joinFailed', { reason: 'Game already in progress' });
      return;
    }

    if (gameState.players.length >= 8) {
      socket.emit('joinFailed', { reason: 'Lobby is full' });
      return;
    }

    const player = new Player(socket.id, playerName || `Agent ${gameState.players.length + 1}`);
    gameState.players.push(player);

    const joinMsg = {
      type: 'system',
      text: `${player.name} joined the operation`,
      timestamp: Date.now()
    };
    gameState.messages.push(joinMsg);

    io.emit('playerJoined', {
      player: { id: player.id, name: player.name, ready: player.ready },
      gameState: getGameStateForClient()
    });

    socket.emit('joinedLobby', {
      playerId: socket.id,
      gameState: getGameStateForClient()
    });
  });

  socket.on('sendMessage', (message) => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player) return;

    const msg = {
      type: 'player',
      sender: player.name,
      text: message,
      timestamp: Date.now()
    };
    gameState.messages.push(msg);

    io.emit('newMessage', msg);
  });

  socket.on('toggleReady', () => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player || gameState.phase !== 'lobby') return;

    player.ready = !player.ready;

    io.emit('playerReadyChange', {
      playerId: player.id,
      ready: player.ready,
      gameState: getGameStateForClient()
    });

    const allReady = gameState.players.length >= 3 && gameState.players.every(p => p.ready);
    if (allReady) {
      setTimeout(() => startGame(), READY_DELAY_MS);
    }
  });

  socket.on('selectMission', (missionId) => {
    if (gameState.phase !== 'playing') return;
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player || getCurrentPlayer().id !== socket.id) return;

    gameState.currentMission = MISSIONS.find(m => m.id === missionId);
    gameState.selectedPlayers = [socket.id]; // Mission leader is always on the mission
    gameState.submittedCards = {};
    gameState.missionStarted = false;

    // If mission requires all players, auto-select everyone
    if (gameState.currentMission.playersNeeded === gameState.players.length) {
      gameState.selectedPlayers = gameState.players.map(p => p.id);
    }

    io.emit('missionSelected', {
      mission: gameState.currentMission,
      gameState: getGameStateForClient()
    });
  });

  socket.on('selectPlayerForMission', (playerId) => {
    if (!gameState.currentMission) return;
    if (getCurrentPlayer().id !== socket.id) return;
    if (gameState.selectedPlayers.length >= gameState.currentMission.playersNeeded) return;

    if (!gameState.selectedPlayers.includes(playerId)) {
      gameState.selectedPlayers.push(playerId);
    }

    io.emit('playerSelectedForMission', {
      selectedPlayers: gameState.selectedPlayers,
      gameState: getGameStateForClient()
    });
  });

  socket.on('startMission', () => {
    if (!gameState.currentMission) return;
    if (getCurrentPlayer().id !== socket.id) return;
    if (gameState.selectedPlayers.length !== gameState.currentMission.playersNeeded) return;

    gameState.missionStarted = true;

    // Auto-submit for players with no cards
    gameState.selectedPlayers.forEach(playerId => {
      const player = gameState.players.find(p => p.id === playerId);
      if (player && player.hand.length === 0) {
        gameState.submittedCards[playerId] = null; // null represents no card
      }
    });

    io.emit('missionStarted', { gameState: getGameStateForClient() });
  });

  socket.on('submitCard', (cardIndex) => {
    if (!gameState.currentMission) return;
    if (!gameState.selectedPlayers.includes(socket.id)) return;

    const player = gameState.players.find(p => p.id === socket.id);
    if (!player || cardIndex >= player.hand.length) return;

    const card = player.hand.splice(cardIndex, 1)[0];
    gameState.submittedCards[socket.id] = card;

    io.emit('cardSubmitted', {
      playerId: socket.id,
      gameState: getGameStateForClient()
    });

    if (Object.keys(gameState.submittedCards).length === gameState.selectedPlayers.length) {
      resolveMission();
    }
  });

  socket.on('vote', (suspectId) => {
    if (gameState.phase !== 'voting') return;
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player) return;

    gameState.votes[socket.id] = suspectId;

    io.emit('voteSubmitted', {
      voterId: socket.id,
      gameState: getGameStateForClient()
    });

    if (Object.keys(gameState.votes).length === gameState.players.length) {
      setTimeout(() => processVotes(), VOTE_PROCESS_MS);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    const playerIndex = gameState.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== -1) {
      const player = gameState.players[playerIndex];
      gameState.players.splice(playerIndex, 1);

      const leaveMsg = {
        type: 'system',
        text: `${player.name} left the operation`,
        timestamp: Date.now()
      };
      gameState.messages.push(leaveMsg);

      io.emit('playerLeft', {
        playerId: socket.id,
        gameState: getGameStateForClient()
      });

      if (gameState.players.length < 3 && gameState.phase !== 'lobby') {
        gameState.phase = 'lobby';
        io.emit('gameCancelled', { reason: 'Not enough players' });
      }
    }
  });
});

function resolveMission() {
  const mission = gameState.currentMission;
  const currentPlayer = getCurrentPlayer();

  const { success, requiredItemCount } = evaluateMission(mission, gameState.submittedCards);

  if (success) {
    currentPlayer.missionPoints++;

    const deck = createDeck();
    gameState.selectedPlayers.forEach(playerId => {
      const player = gameState.players.find(p => p.id === playerId);
      if (player) {
        while (player.hand.length < 5 && deck.length > 0) {
          player.hand.push(deck.pop());
        }
      }
    });
  } else {
    gameState.missionsFailed[gameState.currentRound - 1]++;

    for (let i = 0; i < 2 && currentPlayer.hand.length > 0; i++) {
      currentPlayer.hand.pop();
    }
  }

  io.emit('missionResolved', {
    success: success,
    submittedCards: gameState.submittedCards,
    requiredItem: mission.itemsRequired,
    requiredCount: mission.itemCount,
    actualCount: requiredItemCount,
    gameState: getGameStateForClient()
  });

  gameState.players.forEach(player => {
    const socket = io.sockets.sockets.get(player.id);
    if (socket) {
      socket.emit('updateHand', { hand: player.hand });
    }
  });

  setTimeout(() => {
    nextTurn();
    checkRoundEnd();
    io.emit('turnChanged', { gameState: getGameStateForClient() });
  }, MISSION_RESOLVE_MS);
}

if (TEST_MODE) {
  app.use(express.json());
  app.post('/__test/reset', (req, res) => {
    const body = req.body || {};
    testDeckPattern = Array.isArray(body.deck) ? body.deck : null;
    testDoubleAgentIndex = typeof body.doubleAgentIndex === 'number' ? body.doubleAgentIndex : 0;

    // Force-disconnect any sockets left over from a previous test. Without
    // this, a stale socket can fire its disconnect handler mid-new-test and
    // emit a spurious `gameCancelled` to the fresh clients.
    for (const sock of io.sockets.sockets.values()) {
      sock.disconnect(true);
    }

    Object.assign(gameState, {
      phase: 'lobby',
      players: [],
      messages: [],
      doubleAgentId: null,
      currentRound: 0,
      currentPlayerIndex: 0,
      currentMission: null,
      selectedPlayers: [],
      submittedCards: {},
      votes: {},
      personsOfInterest: [],
      missionsFailed: [0, 0, 0],
      roundComplete: false,
      missionStarted: false
    });

    res.json({ ok: true, deckPattern: testDeckPattern, doubleAgentIndex: testDoubleAgentIndex });
  });
}

const PORT = process.env.PORT || 5000;
http.listen(PORT, () => {
  console.log(`Spy game server running on http://localhost:${PORT}`);
});
