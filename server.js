const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const ITEM_TYPES = [
  'Encrypted USB', 'Satellite Phone', 'Fingerprint Scanner',
  'Night Vision Goggles', 'Lockpick Set', 'Tracking Device',
  'Disguise Kit', 'Poison Vial', 'Decoder Ring', 'Blueprint'
];

const MISSIONS = [
  {
    id: 1,
    name: 'Infiltrate Enemy Base',
    description: 'Breach security and gather intelligence',
    playersNeeded: 2,
    itemsRequired: 'Lockpick Set',
    itemCount: 1
  },
  {
    id: 2,
    name: 'Decode Enemy Communications',
    description: 'Intercept and decrypt classified messages',
    playersNeeded: 2,
    itemsRequired: 'Decoder Ring',
    itemCount: 1
  },
  {
    id: 3,
    name: 'Track Target Location',
    description: 'Locate and monitor high-value target',
    playersNeeded: 3,
    itemsRequired: 'Tracking Device',
    itemCount: 2
  }
];

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
  const deck = [];
  for (let i = 0; i < 8; i++) { // 8 of each item type
    ITEM_TYPES.forEach(item => deck.push(item));
  }
  return shuffleDeck(deck);
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
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
  const randomIndex = Math.floor(Math.random() * gameState.players.length);
  const doubleAgent = gameState.players[randomIndex];
  doubleAgent.isDoubleAgent = true;
  gameState.doubleAgentId = doubleAgent.id;
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
  }, 8000);
}

function getGameStateForClient() {
  return {
    phase: gameState.phase,
    players: gameState.players.map(p => ({
      id: p.id,
      name: p.name,
      missionPoints: p.missionPoints,
      handSize: p.hand.length,
      ready: p.ready
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
    missionStarted: gameState.missionStarted
  };
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
  const voteCounts = {};
  gameState.players.forEach(p => voteCounts[p.id] = 0);

  Object.values(gameState.votes).forEach(votedFor => {
    voteCounts[votedFor]++;
  });

  const maxVotes = Math.max(...Object.values(voteCounts));
  gameState.personsOfInterest = Object.keys(voteCounts)
    .filter(id => voteCounts[id] === maxVotes)
    .map(id => gameState.players.find(p => p.id === id).name);

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
    }, 5000);
  }
}

function endGame() {
  gameState.phase = 'gameover';

  const suspectIds = Object.keys(gameState.votes)
    .map(voterId => gameState.votes[voterId]);

  const voteCounts = {};
  suspectIds.forEach(id => {
    voteCounts[id] = (voteCounts[id] || 0) + 1;
  });

  const maxVotes = Math.max(...Object.values(voteCounts));
  const suspectedIds = Object.keys(voteCounts).filter(id => voteCounts[id] === maxVotes);

  const doubleAgentCaught = suspectedIds.includes(gameState.doubleAgentId);
  const doubleAgent = gameState.players.find(p => p.id === gameState.doubleAgentId);

  const missionFailuresByRound = gameState.missionsFailed;
  const doubleAgentSucceeded = missionFailuresByRound.every(failures => failures >= 1);

  let outcome;
  if (doubleAgentCaught) {
    outcome = {
      result: 'agents-win',
      agentsMessage: `MISSION SUCCESS! After intense interrogation, ${doubleAgent.name} revealed the bomb location. The device has been secured and defused! Well done agents!`,
      doubleAgentMessage: `MISSION FAILURE! Your cover has been blown, ${doubleAgent.name}. Under pressure, you revealed the bomb's location. You will be dealt with in a dark alley... permanently.`,
      doubleAgent: doubleAgent.name
    };
  } else if (doubleAgentSucceeded) {
    outcome = {
      result: 'double-agent-wins',
      agentsMessage: `CATASTROPHIC FAILURE! The double agent ${doubleAgent.name} has succeeded! The bomb detonates! GAME OVER!`,
      doubleAgentMessage: `MISSION SUCCESS! You remained undetected, ${doubleAgent.name}. The bomb has detonated and chaos reigns. Your handlers are pleased.`,
      doubleAgent: doubleAgent.name
    };
  } else {
    outcome = {
      result: 'agents-win',
      agentsMessage: `PARTIAL SUCCESS! Despite not catching ${doubleAgent.name}, your team prevented enough sabotage. The bomb has been located and defused through alternative means!`,
      doubleAgentMessage: `MISSION FAILURE! Though you escaped detection, ${doubleAgent.name}, your sabotage was insufficient. The bomb has been defused. Your handlers are... disappointed.`,
      doubleAgent: doubleAgent.name
    };
  }

  io.emit('gameOver', {
    outcome: outcome,
    finalStats: {
      players: gameState.players.map(p => ({
        name: p.name,
        missionPoints: p.missionPoints,
        isDoubleAgent: p.isDoubleAgent
      })),
      missionsFailed: missionFailuresByRound
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
      setTimeout(() => startGame(), 2000);
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
      setTimeout(() => processVotes(), 2000);
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

  const submittedItems = Object.values(gameState.submittedCards).filter(item => item !== null);
  const requiredItemCount = submittedItems.filter(item => item === mission.itemsRequired).length;

  const success = requiredItemCount >= mission.itemCount;

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
  }, 5000);
}

const PORT = process.env.PORT || 5000;
http.listen(PORT, () => {
  console.log(`Spy game server running on http://localhost:${PORT}`);
});
