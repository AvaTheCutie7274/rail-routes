const COLOR_HEX = {
  black: '#2d2d2d',
  blue: '#3b82f6',
  green: '#22a04b',
  grey: '#9ca3af',
  orange: '#f59e0b',
  pink: '#f472b6',
  purple: '#9b59b6',
  red: '#e53e3e',
  any: '#e8dcc0',
};
const SESSION_KEY = 'railRoutesSession';
const SVG_NS = 'http://www.w3.org/2000/svg';

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children);
  return node;
};
const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const cardImg = (color) => el('img', { src: `cards/${color}.png`, alt: color });

let ws;
let map = null;
let state = null;
let boardBuilt = false;
let modalKey = null;
let ticketSelection = new Set();
let resultsDismissed = false;

// ---------- session ----------

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function saveSession(code, token) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code, token })); } catch {}
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

// ---------- connection ----------

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => {
    const session = loadSession();
    if (session) send({ type: 'rejoin', code: session.code, token: session.token });
  };
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  ws.onclose = (e) => {
    if (e.code === 4000) {
      toast('This game was opened in another tab');
      return;
    }
    toast('Disconnected — reconnecting…');
    setTimeout(connect, 1500);
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else toast('Not connected yet');
}
const act = (action, extra = {}) => send({ type: 'action', action, ...extra });

function onMessage(msg) {
  switch (msg.type) {
    case 'welcome':
      map = msg.map;
      saveSession(msg.code, msg.token);
      break;
    case 'rejoinFailed': {
      const session = loadSession();
      clearSession();
      if (session) $('code-input').value = session.code;
      showScreen('home');
      break;
    }
    case 'state':
      state = msg.state;
      render();
      break;
    case 'error':
      if ($('home').classList.contains('hidden')) toast(msg.message);
      else $('home-error').textContent = msg.message;
      break;
  }
}

// ---------- helpers ----------

function showScreen(name) {
  for (const s of ['home', 'lobby', 'game']) $(s).classList.toggle('hidden', s !== name);
}

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}

const me = () => state.players.find((p) => p.id === state.you);
const playerById = (id) => state.players.find((p) => p.id === id);
const cityName = (id) => map.CITIES[id].name;
const isMyTurn = () => state.phase === 'playing' && state.currentPlayerId === state.you && !state.pendingTickets;

// ---------- render ----------

function render() {
  if (state.phase === 'lobby') {
    renderLobby();
    return;
  }
  showScreen('game');
  if (!boardBuilt) buildBoard();
  renderStatus();
  renderBoard();
  renderPlayers();
  renderMarket();
  renderHand();
  renderTickets();
  renderLog();
  renderModal();
}

function renderLobby() {
  showScreen('lobby');
  $('lobby-code').textContent = state.code;
  const list = $('lobby-players');
  list.replaceChildren(...state.players.map((p) => el('li', {},
    el('span', { class: 'swatch', style: `background:${p.color}` }),
    el('span', {}, p.name + (p.id === state.hostId ? ' (host)' : '') + (p.id === state.you ? ' — you' : '')),
  )));
  const isHost = state.hostId === state.you;
  $('start-btn').classList.toggle('hidden', !isHost);
  $('start-btn').disabled = state.players.length < 2;
  $('start-btn').textContent = state.players.length < 2 ? 'Need 2+ players' : `Start game (${state.players.length} players)`;
  $('lobby-wait').classList.toggle('hidden', isHost);
}

function renderStatus() {
  const status = $('status');
  let text;
  if (state.phase === 'initialTickets') {
    const waiting = state.players.filter((p) => p.choosingTickets).map((p) => p.name);
    text = state.pendingTickets ? 'Choose your starting tickets' : `Waiting for ${waiting.join(', ')} to choose tickets…`;
  } else if (state.phase === 'ended') {
    text = `Game over — ${state.results[0].name} wins!`;
  } else if (state.currentPlayerId === state.you) {
    if (state.pendingTickets) text = 'Choose which tickets to keep';
    else if (state.drawnThisTurn > 0) text = 'Draw one more card (not a face-up rainbow)';
    else text = 'Your turn — draw 2 cards, claim a route, or draw tickets';
  } else {
    text = `${playerById(state.currentPlayerId).name}'s turn`;
  }
  if (state.finalTurnsLeft !== null && state.phase === 'playing') text += ` · Final round: ${state.finalTurnsLeft} turn${state.finalTurnsLeft === 1 ? '' : 's'} left`;
  status.textContent = text;
  status.classList.toggle('your-turn', isMyTurn());
  document.title = isMyTurn() ? '▶ Your turn — Rail Routes' : 'Rail Routes';
  $('game-code').textContent = state.code;
}

function buildBoard() {
  const board = $('board');
  board.replaceChildren();
  const routeLayer = svg('g');
  const cityLayer = svg('g');
  board.append(routeLayer, cityLayer);

  for (const r of map.ROUTES) {
    const a = map.CITIES[r.a];
    const b = map.CITIES[r.b];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
    const offset = r.lane * 9;
    const margin = 20;
    const gap = 3;
    const carLen = (length - 2 * margin - gap * (r.len - 1)) / r.len;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

    const g = svg('g', { class: 'route', 'data-id': r.id });
    for (let i = 0; i < r.len; i++) {
      const along = margin + carLen / 2 + i * (carLen + gap);
      const cx = a.x + ux * along - uy * offset;
      const cy = a.y + uy * along + ux * offset;
      const transform = `translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${angle.toFixed(1)})`;
      g.append(svg('rect', { x: -carLen / 2, y: -6, width: carLen, height: 12, rx: 2, transform }));
      // Marker shown on claimed cars so a red player's train stands out from a red route.
      g.append(svg('circle', { class: 'pip', cx: 0, cy: 0, r: 3.5, transform }));
    }
    const title = svg('title');
    title.textContent = `${a.name} – ${b.name}: ${r.len} ${r.color === 'any' ? 'any color' : r.color}`;
    g.append(title);
    g.addEventListener('click', () => onRouteClick(r));
    routeLayer.append(g);
  }

  for (const [id, c] of Object.entries(map.CITIES)) {
    const g = svg('g', { class: 'city', 'data-id': id });
    g.append(svg('circle', { cx: c.x, cy: c.y, r: 11 }));
    const label = svg('text', { x: c.x, y: c.y - 18, 'text-anchor': 'middle' });
    label.textContent = c.name;
    g.append(label);
    cityLayer.append(g);
  }
  boardBuilt = true;
}

function routeBlocked(r) {
  if (!r.sibling || !state.claims[r.sibling]) return false;
  return state.doubleRoutesLimited || state.claims[r.sibling] === state.you;
}

function renderBoard() {
  for (const r of map.ROUTES) {
    const g = $('board').querySelector(`.route[data-id="${r.id}"]`);
    const owner = state.claims[r.id] && playerById(state.claims[r.id]);
    const fill = owner ? owner.color : COLOR_HEX[r.color];
    g.querySelectorAll('rect').forEach((rect) => rect.setAttribute('fill', fill));
    g.classList.toggle('claimed', !!owner);
    g.classList.toggle('blocked', !owner && routeBlocked(r));
    g.classList.toggle('clickable', !owner && isMyTurn() && state.drawnThisTurn === 0 && !routeBlocked(r));
    g.querySelector('title').textContent = `${cityName(r.a)} – ${cityName(r.b)}: ${r.len} ${r.color === 'any' ? 'any color' : r.color}${owner ? ` (claimed by ${owner.name})` : ''}`;
  }
}

function highlightCities(ids) {
  $('board').querySelectorAll('.city').forEach((c) => c.classList.toggle('hl', ids.includes(c.dataset.id)));
}

function renderPlayers() {
  $('players').replaceChildren(...state.players.map((p) => el('li', {
    class: [p.id === state.currentPlayerId ? 'current' : '', p.connected ? '' : 'offline'].join(' '),
  },
    el('span', { class: 'swatch', style: `background:${p.color}` }),
    el('span', { class: 'name' }, p.name + (p.id === state.you ? ' (you)' : '') + (p.connected ? '' : ' · offline')),
    el('span', { class: 'stats' },
      el('span', { class: 'score' }, `${p.score} pts`),
      ` · 🚂${p.trains} · 🃏${p.cardCount} · 🎫${p.ticketCount}`),
  )));
}

function renderMarket() {
  const canDraw = isMyTurn();
  const cards = state.market.map((color, i) => {
    if (!color) return el('div', { class: 'card empty' });
    const blocked = color === 'rainbow' && state.drawnThisTurn > 0;
    return el('button', {
      class: 'card',
      title: blocked ? "Can't take a face-up rainbow as your second card" : `Take ${color}`,
      disabled: !canDraw || blocked,
      onclick: () => act('drawFaceUp', { index: i }),
    }, cardImg(color));
  });
  cards.push(el('button', {
    class: 'card deck',
    title: 'Draw from the deck',
    disabled: !canDraw || state.deckCount === 0,
    onclick: () => act('drawDeck'),
  }, 'DECK', el('span', {}, String(state.deckCount))));
  $('market').replaceChildren(...cards);
}

function renderHand() {
  const entries = Object.entries(state.hand).filter(([, n]) => n > 0);
  $('hand').replaceChildren(...(entries.length
    ? entries.map(([color, n]) => el('div', { class: 'card', title: `${n} ${color}` }, cardImg(color), el('span', { class: 'count' }, String(n))))
    : [el('span', { class: 'empty-note' }, 'No cards')]));
  $('draw-tickets-btn').disabled = !isMyTurn() || state.drawnThisTurn > 0 || state.ticketDeckCount === 0;
  $('pass-btn').classList.toggle('hidden', !(isMyTurn() && state.canPass));
}

function ticketItem(t, extraClass = '', attrs = {}) {
  return el('li', {
    class: `ticket ${extraClass}`,
    onmouseenter: () => highlightCities([t.a, t.b]),
    onmouseleave: () => highlightCities([]),
    ...attrs,
  }, el('span', {}, `${cityName(t.a)} → ${cityName(t.b)}`), el('span', { class: 'pts' }, String(t.points)));
}

function renderTickets() {
  $('tickets').replaceChildren(...(state.tickets.length
    ? state.tickets.map((t) => ticketItem(t, t.completed ? 'done' : ''))
    : [el('li', { class: 'empty-note' }, 'No tickets yet')]));
}

function renderLog() {
  $('log').replaceChildren(...state.log.slice().reverse().map((line) => el('li', {}, line)));
}

// ---------- modals ----------

function openModal(key, ...content) {
  modalKey = key;
  $('modal').replaceChildren(...content);
  $('modal-backdrop').classList.remove('hidden');
}
function closeModal() {
  modalKey = null;
  $('modal-backdrop').classList.add('hidden');
  highlightCities([]);
}

function renderModal() {
  if (state.pendingTickets) {
    const key = 'tickets:' + state.pendingTickets.map((t) => t.id).join(',');
    if (modalKey !== key) {
      ticketSelection = new Set(state.phase === 'initialTickets' ? state.pendingTickets.map((t) => t.id) : []);
      showTicketChoice(key);
    }
    return;
  }
  if (state.phase === 'ended') {
    if (modalKey !== 'results' && !resultsDismissed) showResults();
    return;
  }
  if (modalKey && modalKey.startsWith('tickets:')) closeModal();
  // A claim dialog is stale once the turn moves on.
  if (modalKey === 'claim' && !isMyTurn()) closeModal();
}

function showTicketChoice(key) {
  const min = state.pendingMin;
  const keepBtn = el('button', { class: 'primary', onclick: () => act('keepTickets', { ticketIds: [...ticketSelection] }) });
  const list = el('ul', { class: 'tickets' });
  const refresh = () => {
    list.replaceChildren(...state.pendingTickets.map((t) => ticketItem(t, `ticket-choice ${ticketSelection.has(t.id) ? 'selected' : ''}`, {
      onclick: () => {
        if (ticketSelection.has(t.id)) ticketSelection.delete(t.id);
        else ticketSelection.add(t.id);
        refresh();
      },
    })));
    keepBtn.disabled = ticketSelection.size < min;
    keepBtn.textContent = `Keep ${ticketSelection.size}`;
  };
  refresh();
  openModal(key,
    el('h3', {}, 'Destination tickets'),
    el('p', { class: 'sub' }, `Keep at least ${min}. Connect the two cities with your own routes by the end to score the points, or lose them. Hover to see the cities on the map.`),
    list,
    el('div', { class: 'actions' }, keepBtn),
  );
}

function paymentOptions(route) {
  const hand = state.hand;
  const colors = route.color === 'any' ? map.CARD_COLORS : [route.color];
  const options = [];
  for (const c of colors) {
    const colored = Math.min(hand[c], route.len);
    const wilds = route.len - colored;
    if (colored > 0 && hand.rainbow >= wilds) options.push({ color: c, colored, wilds });
  }
  if (hand.rainbow >= route.len) options.push({ color: 'rainbow', colored: 0, wilds: route.len });
  return options;
}

function onRouteClick(route) {
  if (state.phase !== 'playing') return;
  if (!isMyTurn()) return toast("It's not your turn");
  if (state.claims[route.id]) return;
  if (state.drawnThisTurn > 0) return toast('Finish drawing your second card first');
  if (routeBlocked(route)) {
    return toast(state.doubleRoutesLimited ? 'With 2–3 players only one track of a double route can be used' : "You can't claim both tracks of a double route");
  }
  if (me().trains < route.len) return toast('Not enough trains left');

  const options = paymentOptions(route);
  const title = `${cityName(route.a)} – ${cityName(route.b)}`;
  const needs = `${route.len} ${route.color === 'any' ? 'cards of any one color' : route.color + ' cards'} (rainbows are wild)`;
  openModal('claim',
    el('h3', {}, title),
    el('p', { class: 'sub' }, `Needs ${needs}.`),
    options.length
      ? el('div', { class: 'pay-options' }, ...options.map((o) => el('button', {
          onclick: () => { closeModal(); act('claimRoute', { routeId: route.id, color: o.color }); },
        },
          ...(o.colored ? [cardImg(o.color), `${o.colored} ${o.color}`] : []),
          ...(o.colored && o.wilds ? [' + '] : []),
          ...(o.wilds ? [cardImg('rainbow'), `${o.wilds} rainbow`] : []),
        )))
      : el('p', { class: 'error' }, "You don't have enough matching cards."),
    el('div', { class: 'actions' }, el('button', { onclick: closeModal }, 'Cancel')),
  );
}

function showResults() {
  const r = state.results;
  openModal('results',
    el('h3', {}, `${r[0].name} wins!`),
    el('table', { class: 'results' },
      el('tr', {}, el('th', {}, 'Player'), el('th', {}, 'Routes'), el('th', {}, 'Tickets'), el('th', {}, 'Longest'), el('th', {}, 'Total')),
      ...r.map((p) => el('tr', {},
        el('td', {}, p.name),
        el('td', {}, String(p.routePoints)),
        el('td', {}, (p.ticketPoints > 0 ? '+' : '') + p.ticketPoints),
        el('td', {}, `${p.longestPath}${p.longestBonus ? ` (+${p.longestBonus})` : ''}`),
        el('td', { class: 'total' }, String(p.total)),
      )),
    ),
    el('div', { class: 'result-tickets' }, ...r.map((p) => el('div', {},
      el('h4', {}, el('span', { class: 'swatch', style: `background:${p.color}` }), p.name),
      el('ul', { class: 'tickets' }, ...p.tickets.map((t) => ticketItem(t, t.completed ? 'done' : 'failed'))),
    ))),
    el('div', { class: 'actions' },
      el('button', { onclick: () => { resultsDismissed = true; closeModal(); } }, 'View board'),
      el('button', { class: 'primary', onclick: () => { clearSession(); location.reload(); } }, 'New game'),
    ),
  );
}

// ---------- home & lobby wiring ----------

const playerName = () => {
  const name = $('name-input').value.trim();
  try { localStorage.setItem('railRoutesName', name); } catch {}
  return name;
};

$('create-btn').addEventListener('click', () => {
  $('home-error').textContent = '';
  send({ type: 'create', name: playerName() });
});
$('join-btn').addEventListener('click', () => {
  $('home-error').textContent = '';
  send({ type: 'join', code: $('code-input').value, name: playerName() });
});
$('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join-btn').click(); });
$('start-btn').addEventListener('click', () => act('start'));
$('invite-btn').addEventListener('click', async () => {
  const link = `${location.origin}/?room=${state.code}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Invite link copied');
  } catch {
    prompt('Copy this invite link:', link);
  }
});
$('leave-btn').addEventListener('click', () => { clearSession(); location.reload(); });
$('draw-tickets-btn').addEventListener('click', () => act('drawTickets'));
$('pass-btn').addEventListener('click', () => act('pass'));
$('modal-backdrop').addEventListener('click', (e) => {
  if (e.target === $('modal-backdrop') && modalKey === 'claim') closeModal();
});

try { $('name-input').value = localStorage.getItem('railRoutesName') || ''; } catch {}
const params = new URLSearchParams(location.search);
if (params.get('room')) {
  // Arrived from an invite link: make joining the obvious action.
  $('code-input').value = params.get('room').toUpperCase();
  $('create-btn').classList.remove('primary');
  $('join-btn').classList.add('primary');
  $('name-input').focus();
}
$('name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') (params.get('room') ? $('join-btn') : $('create-btn')).click();
});

connect();
