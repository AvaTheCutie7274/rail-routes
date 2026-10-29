const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game, GameError } = require('./game');
const MAP = require('../shared/map');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ROOM_IDLE_MS = 2 * 60 * 60 * 1000; // drop rooms nobody is connected to after 2h
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// ---------- static files ----------

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const filePath = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- rooms ----------

const rooms = new Map(); // code -> { game, sockets: Map<playerId, ws>, idleTimer }

function newRoomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function broadcast(room) {
  for (const [playerId, ws] of room.sockets) {
    send(ws, { type: 'state', state: room.game.viewFor(playerId) });
  }
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function attach(ws, room, player) {
  const old = room.sockets.get(player.id);
  if (old && old !== ws) old.close(4000, 'Opened in another tab');
  clearTimeout(room.idleTimer);
  room.sockets.set(player.id, ws);
  player.connected = true;
  ws.room = room;
  ws.playerId = player.id;
  send(ws, { type: 'welcome', code: room.game.code, playerId: player.id, token: player.token, map: MAP });
  broadcast(room);
}

function detach(ws) {
  const room = ws.room;
  if (!room || room.sockets.get(ws.playerId) !== ws) return;
  room.sockets.delete(ws.playerId);
  const player = room.game.players.find((p) => p.id === ws.playerId);
  if (player) player.connected = false;
  // Leaving a lobby frees the seat; mid-game the seat is kept for reconnecting.
  if (room.game.phase === 'lobby') room.game.removePlayer(ws.playerId);
  if (room.sockets.size === 0) {
    room.idleTimer = setTimeout(() => rooms.delete(room.game.code), ROOM_IDLE_MS);
  }
  broadcast(room);
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'create': {
      const room = { game: new Game(newRoomCode()), sockets: new Map(), idleTimer: null };
      rooms.set(room.game.code, room);
      attach(ws, room, room.game.addPlayer(msg.name));
      return;
    }
    case 'join': {
      const room = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!room) throw new GameError('No room with that code');
      attach(ws, room, room.game.addPlayer(msg.name));
      return;
    }
    case 'rejoin': {
      const room = rooms.get(String(msg.code || '').toUpperCase());
      const player = room && room.game.players.find((p) => p.token === msg.token);
      if (!player) {
        send(ws, { type: 'rejoinFailed' });
        return;
      }
      attach(ws, room, player);
      return;
    }
    case 'action': {
      if (!ws.room) throw new GameError('Join a room first');
      ws.room.game.handle(ws.playerId, msg.action, msg);
      broadcast(ws.room);
      return;
    }
    default:
      throw new GameError('Unknown message');
  }
}

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    try {
      handleMessage(ws, msg);
    } catch (err) {
      if (!(err instanceof GameError)) console.error(err);
      send(ws, { type: 'error', message: err instanceof GameError ? err.message : 'Server error' });
    }
  });
  ws.on('close', () => detach(ws));
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
});

// Hosting proxies drop idle WebSockets, and dead connections otherwise linger,
// so ping every 25s and drop clients that stopped answering.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

server.listen(PORT, () => {
  console.log(`Rail Routes running at http://localhost:${PORT}`);
});
