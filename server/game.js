const crypto = require('crypto');
const { CARD_COLORS, CITIES, ROUTES, TICKETS, colorName } = require('../shared/map');

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const MARKET_SIZE = 5;
const LONGEST_ROUTE_BONUS = 10;
const ROUTE_POINTS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 10, 6: 15 };
// Main colour of each train car sprite in public/cars (the client maps colour -> sprite).
// red, blue, green, yellow, orange, pink, cyan, dark blue. The white car is spare.
const PLAYER_COLORS = ['#880200', '#247ea7', '#b3dc49', '#fbd44b', '#eb6208', '#faabe3', '#4bebeb', '#021427'];
const ROUTES_BY_ID = Object.fromEntries(ROUTES.map((r) => [r.id, r]));
const TICKETS_BY_ID = Object.fromEntries(TICKETS.map((t) => [t.id, t]));

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// The test map is small, so each player gets fewer trains as the table grows.
function trainsPerPlayer(n) {
  return Math.min(30, Math.floor(110 / n));
}

// Range the host can pick from; below 5 the final round would start almost at once.
const MIN_TRAINS = 5;
const MAX_TRAINS = 50;

function buildDeck(playerCount) {
  // Bigger tables get a deck 1.5x the standard size so it doesn't run dry.
  const perColor = playerCount > 5 ? 18 : 12;
  const rainbows = playerCount > 5 ? 21 : 14;
  const deck = [];
  for (const c of CARD_COLORS) for (let i = 0; i < perColor; i++) deck.push(c);
  for (let i = 0; i < rainbows; i++) deck.push('rainbow');
  return shuffle(deck);
}

function emptyHand() {
  const hand = { rainbow: 0 };
  for (const c of CARD_COLORS) hand[c] = 0;
  return hand;
}

class GameError extends Error {}

class Game {
  constructor(code) {
    this.code = code;
    this.players = [];
    this.hostId = null;
    this.log = [];
    this.trainsSetting = null; // null = automatic for the player count; kept across rematches
    this.resetBoard();
  }

  resetBoard() {
    this.phase = 'lobby'; // lobby -> initialTickets -> playing -> ended
    this.claims = {}; // routeId -> playerId
    this.deck = [];
    this.discard = [];
    this.market = [];
    this.ticketDeck = [];
    this.turnIndex = 0;
    this.drawnThisTurn = 0;
    this.finalTurnsLeft = null;
    this.results = null;
  }

  // ---------- lobby ----------

  // Back to the lobby with everyone still connected, keeping the room code.
  playAgain() {
    if (this.phase !== 'ended') throw new GameError('The game is still in progress');
    this.resetBoard();
    this.players = this.players.filter((p) => p.connected);
    this.players.forEach((p, i) => {
      p.color = PLAYER_COLORS[i];
      p.hand = emptyHand();
      p.tickets = [];
      p.pendingTickets = null;
      p.pendingMin = 0;
      p.trains = 0;
      p.score = 0;
    });
    if (!this.players.some((p) => p.id === this.hostId)) this.hostId = this.players[0]?.id ?? null;
    this.addLog('Back to the lobby for another game');
  }

  validName(name, fallback, exceptId = null) {
    name = String(name || '').trim().slice(0, 20) || fallback;
    if (this.players.some((p) => p.id !== exceptId && p.name.toLowerCase() === name.toLowerCase())) {
      throw new GameError('That name is taken in this room');
    }
    return name;
  }

  addPlayer(name) {
    if (this.phase !== 'lobby') throw new GameError('Game already started');
    if (this.players.length >= MAX_PLAYERS) throw new GameError('Room is full');
    name = this.validName(name, `Player ${this.players.length + 1}`);
    const player = {
      id: crypto.randomBytes(6).toString('hex'),
      token: crypto.randomBytes(16).toString('hex'),
      name,
      color: PLAYER_COLORS[this.players.length],
      hand: emptyHand(),
      tickets: [],
      pendingTickets: null,
      pendingMin: 0,
      trains: 0,
      score: 0,
      connected: true,
    };
    this.players.push(player);
    if (!this.hostId) this.hostId = player.id;
    this.addLog(`${name} joined`);
    return player;
  }

  rename(player, name) {
    if (this.phase !== 'lobby') throw new GameError('You can only change your name in the lobby');
    const newName = this.validName(name, player.name, player.id);
    if (newName === player.name) return;
    this.addLog(`${player.name} is now ${newName}`);
    player.name = newName;
  }

  setTrains(byId, trains) {
    if (this.phase !== 'lobby') throw new GameError('Settings can only be changed in the lobby');
    if (byId !== this.hostId) throw new GameError('Only the host can change settings');
    if (trains === null) {
      this.trainsSetting = null;
      return;
    }
    if (!Number.isInteger(trains) || trains < MIN_TRAINS || trains > MAX_TRAINS) {
      throw new GameError(`Trains must be between ${MIN_TRAINS} and ${MAX_TRAINS}`);
    }
    this.trainsSetting = trains;
  }

  removePlayer(playerId) {
    if (this.phase !== 'lobby') return;
    this.players = this.players.filter((p) => p.id !== playerId);
    this.players.forEach((p, i) => (p.color = PLAYER_COLORS[i]));
    if (this.hostId === playerId) this.hostId = this.players[0]?.id ?? null;
  }

  start(byId) {
    if (this.phase !== 'lobby') throw new GameError('Game already started');
    if (byId !== this.hostId) throw new GameError('Only the host can start the game');
    if (this.players.length < MIN_PLAYERS) throw new GameError(`Need at least ${MIN_PLAYERS} players`);

    shuffle(this.players);
    this.players.forEach((p, i) => (p.color = PLAYER_COLORS[i]));
    this.deck = buildDeck(this.players.length);
    this.ticketDeck = shuffle(TICKETS.map((t) => t.id));
    const trains = this.trainsSetting ?? trainsPerPlayer(this.players.length);
    for (const p of this.players) {
      p.trains = trains;
      for (let i = 0; i < 4; i++) p.hand[this.deck.pop()]++;
      p.pendingTickets = this.ticketDeck.splice(-3);
      p.pendingMin = 2;
    }
    this.refillMarket();
    this.phase = 'initialTickets';
    this.addLog(`Game started with ${this.players.length} players, ${trains} trains each`);
  }

  // ---------- actions ----------

  handle(playerId, action, msg) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) throw new GameError('You are not in this game');
    switch (action) {
      case 'start': return this.start(playerId);
      case 'rename': return this.rename(player, msg.name);
      case 'setTrains': return this.setTrains(playerId, msg.trains);
      case 'keepTickets': return this.keepTickets(player, msg.ticketIds);
      case 'drawFaceUp': return this.drawFaceUp(player, msg.index);
      case 'drawDeck': return this.drawDeck(player);
      case 'claimRoute': return this.claimRoute(player, msg.routeId, msg.color);
      case 'drawTickets': return this.drawTickets(player);
      case 'pass': return this.pass(player);
      case 'playAgain': return this.playAgain();
      default: throw new GameError(`Unknown action: ${action}`);
    }
  }

  get currentPlayer() {
    return this.players[this.turnIndex];
  }

  assertTurn(player) {
    if (this.phase !== 'playing') throw new GameError('The game is not in progress');
    if (this.currentPlayer !== player) throw new GameError("It's not your turn");
    if (player.pendingTickets) throw new GameError('Choose which tickets to keep first');
  }

  keepTickets(player, ticketIds) {
    if (!player.pendingTickets) throw new GameError('You have no tickets to choose from');
    const kept = [...new Set(Array.isArray(ticketIds) ? ticketIds : [])];
    if (!kept.every((id) => player.pendingTickets.includes(id))) throw new GameError('Invalid ticket choice');
    if (kept.length < player.pendingMin) throw new GameError(`You must keep at least ${player.pendingMin}`);

    const returned = player.pendingTickets.filter((id) => !kept.includes(id));
    player.tickets.push(...kept);
    this.ticketDeck.unshift(...returned); // returned tickets go to the bottom
    player.pendingTickets = null;

    if (this.phase === 'initialTickets') {
      this.addLog(`${player.name} kept ${kept.length} tickets`);
      if (this.players.every((p) => !p.pendingTickets)) {
        this.phase = 'playing';
        this.turnIndex = 0;
        this.addLog(`${this.currentPlayer.name} goes first`);
      }
    } else {
      this.addLog(`${player.name} drew tickets and kept ${kept.length}`);
      this.endTurn();
    }
  }

  drawFaceUp(player, index) {
    this.assertTurn(player);
    const card = this.market[index];
    if (!card) throw new GameError('No card there');
    if (card === 'rainbow' && this.drawnThisTurn > 0) {
      throw new GameError("You can't take a face-up rainbow as your second card");
    }
    player.hand[card]++;
    this.market[index] = this.drawFromDeck();
    this.refillMarket();
    this.addLog(`${player.name} took a face-up ${colorName(card)}`);
    this.afterCardDraw(card === 'rainbow');
  }

  drawDeck(player) {
    this.assertTurn(player);
    const card = this.drawFromDeck();
    if (!card) throw new GameError('The deck is empty');
    player.hand[card]++;
    this.addLog(`${player.name} drew from the deck`);
    this.afterCardDraw(false);
  }

  afterCardDraw(tookFaceUpRainbow) {
    this.drawnThisTurn++;
    const canDrawMore = this.deck.length + this.discard.length > 0
      || this.market.some((c) => c && c !== 'rainbow');
    if (tookFaceUpRainbow || this.drawnThisTurn >= 2 || !canDrawMore) this.endTurn();
  }

  claimRoute(player, routeId, color) {
    this.assertTurn(player);
    if (this.drawnThisTurn > 0) throw new GameError('Finish drawing your second card');
    const route = ROUTES_BY_ID[routeId];
    if (!route) throw new GameError('Unknown route');
    if (this.claims[routeId]) throw new GameError('That route is already claimed');
    if (route.sibling && this.claims[route.sibling]) {
      if (this.claims[route.sibling] === player.id) throw new GameError("You can't claim both tracks of a double route");
      if (this.players.length <= 3) throw new GameError('With 2-3 players only one track of a double route can be used');
    }
    if (player.trains < route.len) throw new GameError('Not enough trains left');

    if (color !== 'rainbow' && !CARD_COLORS.includes(color)) throw new GameError('Invalid card color');
    if (route.color !== 'any' && color !== route.color && color !== 'rainbow') {
      throw new GameError(`This route needs ${colorName(route.color)} cards`);
    }
    const colored = color === 'rainbow' ? 0 : Math.min(player.hand[color], route.len);
    const wilds = route.len - colored;
    if (player.hand.rainbow < wilds) throw new GameError('Not enough cards');

    if (colored) {
      player.hand[color] -= colored;
      for (let i = 0; i < colored; i++) this.discard.push(color);
    }
    player.hand.rainbow -= wilds;
    for (let i = 0; i < wilds; i++) this.discard.push('rainbow');
    // The market may have gone empty while the deck was dry.
    this.refillMarket();

    this.claims[routeId] = player.id;
    player.trains -= route.len;
    player.score += ROUTE_POINTS[route.len];
    this.addLog(`${player.name} claimed ${CITIES[route.a].name} – ${CITIES[route.b].name} (+${ROUTE_POINTS[route.len]})`);
    this.endTurn();
  }

  drawTickets(player) {
    this.assertTurn(player);
    if (this.drawnThisTurn > 0) throw new GameError('Finish drawing your second card');
    if (!this.ticketDeck.length) throw new GameError('No tickets left');
    player.pendingTickets = this.ticketDeck.splice(-3);
    player.pendingMin = 1;
  }

  // Only allowed when there is nothing left to draw, so a player who can't
  // afford any route doesn't freeze the game.
  canPass() {
    return this.deck.length + this.discard.length === 0
      && !this.market.some(Boolean)
      && this.ticketDeck.length === 0;
  }

  pass(player) {
    this.assertTurn(player);
    if (this.drawnThisTurn > 0 || !this.canPass()) throw new GameError("You can't pass while there are cards or tickets to draw");
    this.addLog(`${player.name} passed`);
    this.endTurn();
  }

  // ---------- turn flow ----------

  endTurn() {
    const player = this.currentPlayer;
    this.drawnThisTurn = 0;
    if (this.finalTurnsLeft !== null) {
      this.finalTurnsLeft--;
      if (this.finalTurnsLeft <= 0) return this.endGame();
    } else if (player.trains <= 2) {
      this.finalTurnsLeft = this.players.length;
      this.addLog(`${player.name} has ${player.trains} trains left — everyone gets one final turn!`);
    }
    this.turnIndex = (this.turnIndex + 1) % this.players.length;
  }

  drawFromDeck() {
    if (!this.deck.length && this.discard.length) {
      this.deck = shuffle(this.discard);
      this.discard = [];
    }
    return this.deck.pop() ?? null;
  }

  refillMarket() {
    for (let attempt = 0; attempt < 5; attempt++) {
      for (let i = 0; i < MARKET_SIZE; i++) {
        if (!this.market[i]) this.market[i] = this.drawFromDeck();
      }
      // Three face-up rainbows: discard the whole row and redeal.
      if (this.market.filter((c) => c === 'rainbow').length < 3) return;
      this.addLog('Three rainbows face up — the market was reshuffled');
      for (let i = 0; i < MARKET_SIZE; i++) {
        if (this.market[i]) this.discard.push(this.market[i]);
        this.market[i] = null;
      }
    }
  }

  // ---------- scoring ----------

  playerRoutes(playerId) {
    return ROUTES.filter((r) => this.claims[r.id] === playerId);
  }

  isConnected(playerId, from, to) {
    const routes = this.playerRoutes(playerId);
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      const city = stack.pop();
      if (city === to) return true;
      for (const r of routes) {
        const next = r.a === city ? r.b : r.b === city ? r.a : null;
        if (next && !seen.has(next)) { seen.add(next); stack.push(next); }
      }
    }
    return false;
  }

  // Longest trail: each route used at most once, cities may repeat.
  longestPath(playerId) {
    const routes = this.playerRoutes(playerId);
    const used = new Set();
    let best = 0;
    const walk = (city, length) => {
      best = Math.max(best, length);
      for (const r of routes) {
        if (used.has(r.id)) continue;
        const next = r.a === city ? r.b : r.b === city ? r.a : null;
        if (!next) continue;
        used.add(r.id);
        walk(next, length + r.len);
        used.delete(r.id);
      }
    };
    for (const city of new Set(routes.flatMap((r) => [r.a, r.b]))) walk(city, 0);
    return best;
  }

  endGame() {
    this.phase = 'ended';
    const lengths = Object.fromEntries(this.players.map((p) => [p.id, this.longestPath(p.id)]));
    const longest = Math.max(...Object.values(lengths));
    this.results = this.players.map((p) => {
      const tickets = p.tickets.map((id) => ({ ...TICKETS_BY_ID[id], completed: this.isConnected(p.id, TICKETS_BY_ID[id].a, TICKETS_BY_ID[id].b) }));
      const ticketPoints = tickets.reduce((s, t) => s + (t.completed ? t.points : -t.points), 0);
      const hasLongest = longest > 0 && lengths[p.id] === longest;
      const bonus = hasLongest ? LONGEST_ROUTE_BONUS : 0;
      return {
        playerId: p.id,
        name: p.name,
        color: p.color,
        routePoints: p.score,
        ticketPoints,
        longestPath: lengths[p.id],
        longestBonus: bonus,
        total: p.score + ticketPoints + bonus,
        tickets,
      };
    }).sort((a, b) => b.total - a.total);
    this.addLog(`Game over! ${this.results[0].name} wins with ${this.results[0].total} points`);
  }

  // ---------- views ----------

  addLog(text) {
    this.log.push(text);
    if (this.log.length > 100) this.log.shift();
  }

  viewFor(playerId) {
    const me = this.players.find((p) => p.id === playerId);
    const ticketView = (id) => ({
      ...TICKETS_BY_ID[id],
      completed: this.phase !== 'lobby' && this.isConnected(playerId, TICKETS_BY_ID[id].a, TICKETS_BY_ID[id].b),
    });
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      you: playerId,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        trains: p.trains,
        score: p.score,
        cardCount: Object.values(p.hand).reduce((a, b) => a + b, 0),
        ticketCount: p.tickets.length,
        choosingTickets: !!p.pendingTickets,
        connected: p.connected,
      })),
      market: this.market,
      trainsSetting: this.trainsSetting,
      autoTrains: trainsPerPlayer(Math.max(this.players.length, MIN_PLAYERS)),
      trainsRange: [MIN_TRAINS, MAX_TRAINS],
      // Only whether the deck is empty; players don't get to count it.
      deckEmpty: this.deck.length + this.discard.length === 0,
      ticketDeckCount: this.ticketDeck.length,
      claims: this.claims,
      currentPlayerId: this.phase === 'playing' ? this.currentPlayer.id : null,
      drawnThisTurn: this.drawnThisTurn,
      finalTurnsLeft: this.finalTurnsLeft,
      doubleRoutesLimited: this.players.length <= 3,
      canPass: this.phase === 'playing' && this.canPass(),
      log: this.log.slice(-40),
      hand: me ? me.hand : null,
      tickets: me ? me.tickets.map(ticketView) : [],
      pendingTickets: me && me.pendingTickets ? me.pendingTickets.map(ticketView) : null,
      pendingMin: me ? me.pendingMin : 0,
      results: this.results,
    };
  }
}

module.exports = { Game, GameError, MAX_PLAYERS };
