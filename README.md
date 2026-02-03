# Operation: Double Agent

A real-time multiplayer spy game where players must complete missions while identifying a double agent among them before a bomb detonates.

## Game Overview

**Players:** 3-8
**Rounds:** 3
**Objective:**
- **Agents:** A nuclear bomb will detonate unless its location is found. A double agent among you has the location. Complete missions and identify the traitor to extract the bomb's location and defuse it.
- **Double Agent:** You know the bomb's location. Sabotage at least 1 mission per round while remaining undetected to ensure detonation.

## Gameplay Flow

### 1. Lobby Phase
- Players join with auto-generated spy codenames (e.g., "Shadow Wolf", "Ghost Raven")
- Codenames can be edited or regenerated
- Players mark ready when 3+ players are present
- Game starts when all players are ready

### 2. Briefing Phase (8 seconds)
- One player is randomly selected as the **Double Agent**
- **Double Agent** learns they have the bomb location and must sabotage operations
- **Regular Agents** are briefed: A nuclear bomb will detonate unless they find it. A double agent among them has the location. Complete missions and identify the traitor.
- All players receive 5 random item cards

### 3. Playing Phase (3 Rounds)

Each round consists of multiple turns where players take missions:

#### Turn Structure
1. **Mission Selection:** Current player selects one of 3 available missions
2. **Team Selection:** Current player selects required number of team members
   - Mission leader is always on their own mission
   - For missions requiring all players, everyone is auto-selected
3. **Begin Mission:** Leader clicks "BEGIN MISSION" button to start
4. **Card Submission:** Selected players submit item cards from their hand
   - Players with no cards are auto-skipped (submit null)
   - Mission waits only for players with cards
5. **Mission Resolution:**
   - **Success:** If enough correct items submitted
     - Mission leader gains 1 point
     - All participants get cards topped up to 5
   - **Failure:** If insufficient correct items
     - Mission leader loses 2 cards
     - Mission failure recorded for the round
6. **Next Turn:** Moves to next player

#### Available Missions

| Mission | Team Size | Required Items |
|---------|-----------|----------------|
| Infiltrate Enemy Base | 2 | 1x Lockpick Set |
| Decode Enemy Communications | 2 | 1x Decoder Ring |
| Track Target Location | 3 | 2x Tracking Device |

#### Item Types
- Encrypted USB
- Satellite Phone
- Fingerprint Scanner
- Night Vision Goggles
- Lockpick Set
- Tracking Device
- Disguise Kit
- Poison Vial
- Decoder Ring
- Blueprint

### 4. Voting Phase (After Each Round)

- All players vote for who they suspect has the bomb location
- Cannot vote for yourself
- **Person(s) of Interest:** Player(s) with most votes are marked as primary suspects
  - Shown with red borders and [SUSPECT] labels
  - Persists through next round for tracking
- After 3 rounds, final vote determines if the bomb location is extracted

### 5. Game Over

Three possible outcomes:

#### Agents Win - Bomb Location Extracted
- Agents correctly identified who has the bomb location
- **Agents see:** "After intense interrogation, [name] revealed the bomb location. The device has been secured and defused!"
- **Double Agent sees:** "Your cover has been blown. Under pressure, you revealed the bomb's location. You will be dealt with in a dark alley... permanently."

#### Double Agent Wins - Bomb Detonates
- Double agent sabotaged at least 1 mission per round AND wasn't identified
- **Agents see:** "CATASTROPHIC FAILURE! The double agent [name] kept the bomb location secret. The bomb detonates! GAME OVER!"
- **Double Agent sees:** "You remained undetected. The bomb has detonated and chaos reigns. Your handlers are pleased."

#### Agents Win - Bomb Found Through Other Means
- Double agent wasn't identified BUT didn't sabotage enough missions
- **Agents see:** "Despite not identifying [name], your team's successful missions led to the bomb location. Device defused through alternative means!"
- **Double Agent sees:** "Though you escaped detection, your insufficient sabotage allowed agents to locate the bomb. The device has been defused. Your handlers are... disappointed."

## Technical Architecture

### Tech Stack
- **Server:** Node.js with Express and Socket.IO
- **Client:** Vanilla JavaScript with Socket.IO client
- **Styling:** Retro terminal/spy aesthetic with green text on black

### File Structure
```
SpyGameProject/
├── server.js           # Game server and logic
├── index.html          # Client UI and game interface
├── package.json        # Dependencies
└── README.md          # This file
```

### Server Architecture (server.js)

#### Game State Object
```javascript
gameState = {
  phase: 'lobby' | 'briefing' | 'playing' | 'voting' | 'gameover',
  players: [],               // Array of Player objects
  messages: [],              // Chat messages
  doubleAgentId: null,       // Socket ID of double agent
  currentRound: 0,           // 1-3
  currentPlayerIndex: 0,     // Index into players array
  currentMission: null,      // Selected mission object
  selectedPlayers: [],       // Socket IDs of players on current mission
  submittedCards: {},        // { playerId: cardName } or { playerId: null }
  votes: {},                 // { voterId: suspectId }
  personsOfInterest: [],     // Array of player names
  missionsFailed: [0,0,0],   // Failure count per round
  roundComplete: false,
  missionStarted: false      // Flag to prevent auto-starting missions
}
```

#### Player Object
```javascript
class Player {
  id: string           // Socket ID
  name: string         // Display name
  hand: []            // Array of item card strings
  isDoubleAgent: bool
  missionPoints: int
  ready: bool         // For lobby
}
```

#### Key Server Functions

**Game Flow:**
- `startGame()` - Deals cards, selects double agent, starts briefing
- `nextTurn()` - Advances to next player, clears mission state
- `checkRoundEnd()` - Detects when all players had turn, starts voting
- `startVoting()` - Initiates voting phase, clears previous POI
- `processVotes()` - Counts votes, determines POI or ends game
- `endGame()` - Calculates outcome, sends personalized messages

**Mission Management:**
- `resolveMission()` - Checks submitted cards, awards/penalizes
- `topUpCards()` - Restores all players to 5 cards at round start

**Card Management:**
- `createDeck()` - Creates shuffled deck of all item types (8 each)
- `dealCards()` - Initial deal of 5 cards to each player
- `shuffleDeck()` - Fisher-Yates shuffle

**State Helpers:**
- `getGameStateForClient()` - Sanitizes game state for clients
- `getCurrentPlayer()` - Returns player whose turn it is

#### Socket Events (Server → Client)

| Event | When | Data |
|-------|------|------|
| `joinedLobby` | Player joins | playerId, gameState |
| `playerJoined` | Another player joins | player, gameState |
| `gameStarted` | Game begins | gameState |
| `briefing` | Role assignment | role, message |
| `phaseChange` | Phase transitions | phase, gameState |
| `updateHand` | Cards change | hand array |
| `missionSelected` | Mission chosen | mission, gameState |
| `playerSelectedForMission` | Team member added | selectedPlayers, gameState |
| `missionStarted` | Mission begins | gameState |
| `cardSubmitted` | Player submits card | playerId, gameState |
| `missionResolved` | Mission completes | success, submittedCards, etc. |
| `turnChanged` | Next player's turn | gameState |
| `votingStarted` | Voting begins | round, isLastRound, gameState |
| `voteSubmitted` | Vote cast | voterId, gameState |
| `roundComplete` | Round ends | round, personsOfInterest, gameState |
| `gameOver` | Game ends | outcome, finalStats |

#### Socket Events (Client → Server)

| Event | Trigger | Data |
|-------|---------|------|
| `joinLobby` | Enter game | playerName |
| `toggleReady` | Ready button | none |
| `sendMessage` | Chat | message text |
| `selectMission` | Pick mission | missionId |
| `selectPlayerForMission` | Pick teammate | playerId |
| `startMission` | Begin button | none |
| `submitCard` | Submit item | cardIndex |
| `vote` | Vote for suspect | suspectId |

### Client Architecture (index.html)

#### Client State
```javascript
myPlayerId: string          // This player's socket ID
gameState: object          // Game state from server
myHand: []                 // This player's cards
selectedMission: int       // Currently selected mission ID
selectedCard: int          // Index of card being submitted
myRole: 'agent' | 'double-agent'
```

#### Screen Flow
```
joinScreen (active on load)
  ↓ joinLobby
lobbyScreen
  ↓ all ready
briefingScreen (8 seconds)
  ↓ phaseChange
gameScreen (missions, voting, results)
  ↓ gameOver
gameoverScreen
```

#### Key Client Functions

**Screen Management:**
- `showScreen(screenId)` - Shows specified screen, hides others
- `updateGameScreen()` - Main render function for game screen
- `updateLobby()` - Renders lobby player list

**Game Actions:**
- `joinLobby()` - Sends join request with name
- `toggleReady()` - Toggles ready state in lobby
- `selectMission(id)` - Chooses mission as leader
- `selectPlayerForMission(id)` - Adds player to team
- `startMission()` - Begins mission
- `submitCard(index)` - Submits card from hand
- `vote(suspectId)` - Casts vote for suspect

**Utility:**
- `generateCodename()` - Creates random spy name
- `updateHand()` - Renders player's item cards

#### UI Conditionals in updateGameScreen()

The function decides which interface to show based on game state:

```javascript
// Priority order (first match wins):

1. If phase === 'voting'
   → Hide all, return (voting shown separately)

2. If mission started AND on mission AND haven't submitted AND have cards
   → Show card selection interface

3. If mission started AND on mission AND (submitted OR no cards)
   → Show waiting interface (hide all)

4. If my turn AND no mission selected
   → Show mission selection grid

5. If my turn AND mission selected AND team not full
   → Show team selection with "BEGIN MISSION" button

6. Otherwise
   → Hide all (waiting for others)
```

## Important Game Mechanics

### Card Economy
- Start with 5 cards at game start
- **Top up to 5 cards:**
  - At the start of each new round (rounds 2 & 3)
  - After successful mission (participants only)
- **Lose cards:**
  - Mission leader loses 2 cards on failed mission
  - Cards used in missions are consumed
- Players with 0 cards auto-skip card submission (submit null)

### Mission Starting
- Mission leader must click "BEGIN MISSION" even when all players auto-selected
- `missionStarted` flag prevents card selection before button click
- When mission starts, players with 0 cards auto-submit null

### Persons of Interest Tracking
- Persons of Interest are cleared at START of voting (not after)
- POI persist through the entire next round
- Displayed with red borders and [SUSPECT] label in player list
- Allows players to track suspects across rounds

### Voting Area State Management
- Voting area HTML structure is completely rebuilt each voting round
- Prevents previous round's POI display from persisting
- Round complete screen temporarily replaces voting structure

### Bomb Location Extraction
- Final vote represents agents' attempt to identify who has the bomb location
- Player(s) with most votes are interrogated
- Bomb location is extracted if the double agent has the most votes (or tied for most)
- Outcome determined by: successful identification + mission sabotage count
- If double agent is identified, they're interrogated and reveal the bomb location
- If double agent escapes identification and sabotaged enough missions, bomb detonates

## Development Notes

### Running the Game
```bash
npm install
node server.js
# Navigate to http://localhost:5000
```

### Key Design Decisions

1. **Auto-generated Codenames:** Improves onboarding, maintains spy theme
2. **No Time Limits:** Async-friendly, reduces pressure
3. **Point System:** Mission points track engagement, not victory condition
4. **Person of Interest System:** Helps players track suspicions across rounds
5. **Personalized End Messages:** Role-specific outcomes enhance immersion

### Common Pitfalls

1. **Don't clear `missionStarted` before mission resolves**
   - Cleared in `nextTurn()` only

2. **Don't count null cards in mission resolution**
   - Filter `submittedItems` before counting

3. **Rebuild voting area HTML structure each round**
   - `roundComplete` replaces entire innerHTML
   - `votingStarted` must restore structure

4. **Top up cards at round start, not round end**
   - Called in `phaseChange` after voting completes

5. **Check `missionStarted` flag for card selection**
   - Prevents showing cards before "BEGIN MISSION" clicked

### Future Enhancement Ideas

- Add more mission types with varying difficulty
- Implement communication sabotage mechanics for double agent
- Add achievements/badges for gameplay styles
- Include replay/game history viewer
- Add AI bots for single-player practice
- Implement progressive difficulty (more double agents, tougher missions)

## License

This is a learning project. Feel free to modify and extend!
