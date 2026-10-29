// Test map: a small fictional region. Coordinates are in a 1000x700 board space.

const CARD_COLORS = ['black', 'blue', 'green', 'grey', 'orange', 'pink', 'purple', 'red'];

const CITIES = {
  northport:   { name: 'Northport',   x: 100, y: 80 },
  frostwick:   { name: 'Frostwick',   x: 330, y: 60 },
  highcrag:    { name: 'Highcrag',    x: 560, y: 90 },
  pinehollow:  { name: 'Pinehollow',  x: 790, y: 70 },
  eastmere:    { name: 'Eastmere',    x: 930, y: 180 },
  saltmarsh:   { name: 'Saltmarsh',   x: 80,  y: 260 },
  ironford:    { name: 'Ironford',    x: 270, y: 220 },
  millbrook:   { name: 'Millbrook',   x: 470, y: 250 },
  copperton:   { name: 'Copperton',   x: 680, y: 230 },
  duskvale:    { name: 'Duskvale',    x: 870, y: 330 },
  westhaven:   { name: 'Westhaven',   x: 110, y: 440 },
  redrock:     { name: 'Redrock',     x: 330, y: 400 },
  lanternfall: { name: 'Lanternfall', x: 540, y: 420 },
  brightwater: { name: 'Brightwater', x: 740, y: 430 },
  sunreach:    { name: 'Sunreach',    x: 920, y: 520 },
  coralbay:    { name: 'Coralbay',    x: 130, y: 610 },
  dunmore:     { name: 'Dunmore',     x: 390, y: 590 },
  emberfalls:  { name: 'Ember Falls', x: 640, y: 600 },
  southgate:   { name: 'Southgate',   x: 850, y: 640 },
};

// [cityA, cityB, length, color, secondColor?]  'any' = pay with any single color.
// A fifth entry makes it a double route (two parallel tracks).
const ROUTE_DEFS = [
  ['northport', 'frostwick', 3, 'blue'],
  ['frostwick', 'highcrag', 3, 'red', 'any'],
  ['highcrag', 'pinehollow', 3, 'green'],
  ['pinehollow', 'eastmere', 2, 'any'],
  ['northport', 'saltmarsh', 2, 'orange'],
  ['northport', 'ironford', 3, 'any'],
  ['frostwick', 'ironford', 2, 'purple'],
  ['frostwick', 'millbrook', 3, 'pink'],
  ['highcrag', 'millbrook', 2, 'black', 'grey'],
  ['highcrag', 'copperton', 2, 'any'],
  ['pinehollow', 'copperton', 2, 'orange'],
  ['eastmere', 'copperton', 3, 'purple'],
  ['eastmere', 'duskvale', 2, 'red', 'green'],
  ['saltmarsh', 'ironford', 3, 'black'],
  ['saltmarsh', 'westhaven', 2, 'any', 'any'],
  ['ironford', 'millbrook', 3, 'any'],
  ['ironford', 'redrock', 3, 'green'],
  ['ironford', 'westhaven', 4, 'red'],
  ['millbrook', 'copperton', 3, 'red'],
  ['millbrook', 'lanternfall', 2, 'blue', 'orange'],
  ['millbrook', 'redrock', 3, 'grey'],
  ['copperton', 'duskvale', 3, 'pink', 'black'],
  ['copperton', 'brightwater', 3, 'any'],
  ['duskvale', 'brightwater', 2, 'purple'],
  ['duskvale', 'sunreach', 3, 'blue'],
  ['westhaven', 'redrock', 3, 'pink'],
  ['westhaven', 'coralbay', 2, 'green'],
  ['redrock', 'lanternfall', 3, 'orange', 'purple'],
  ['redrock', 'dunmore', 3, 'red'],
  ['redrock', 'coralbay', 4, 'any'],
  ['lanternfall', 'brightwater', 3, 'grey'],
  ['lanternfall', 'emberfalls', 3, 'any'],
  ['lanternfall', 'dunmore', 3, 'black'],
  ['brightwater', 'sunreach', 3, 'orange'],
  ['brightwater', 'emberfalls', 3, 'blue', 'red'],
  ['sunreach', 'southgate', 2, 'grey'],
  ['coralbay', 'dunmore', 4, 'orange', 'blue'],
  ['dunmore', 'emberfalls', 4, 'pink'],
  ['emberfalls', 'southgate', 3, 'green', 'any'],
];

const ROUTES = [];
for (const [a, b, len, color, color2] of ROUTE_DEFS) {
  if (color2) {
    const id1 = `r${ROUTES.length}`;
    const id2 = `r${ROUTES.length + 1}`;
    ROUTES.push({ id: id1, a, b, len, color, lane: -1, sibling: id2 });
    ROUTES.push({ id: id2, a, b, len, color: color2, lane: 1, sibling: id1 });
  } else {
    ROUTES.push({ id: `r${ROUTES.length}`, a, b, len, color, lane: 0, sibling: null });
  }
}

// Destination tickets: generated from city pairs, worth their shortest-path length.
function shortestPaths() {
  const ids = Object.keys(CITIES);
  const dist = {};
  for (const i of ids) {
    dist[i] = {};
    for (const j of ids) dist[i][j] = i === j ? 0 : Infinity;
  }
  for (const r of ROUTES) {
    dist[r.a][r.b] = Math.min(dist[r.a][r.b], r.len);
    dist[r.b][r.a] = Math.min(dist[r.b][r.a], r.len);
  }
  for (const k of ids) for (const i of ids) for (const j of ids) {
    if (dist[i][k] + dist[k][j] < dist[i][j]) dist[i][j] = dist[i][k] + dist[k][j];
  }
  return dist;
}

function buildTickets() {
  const dist = shortestPaths();
  const ids = Object.keys(CITIES);
  const tickets = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const d = dist[ids[i]][ids[j]];
      // Keep a spread of medium and long tickets; skip trivial neighbours.
      if (d >= 5 && (i + j) % 2 === 0) {
        tickets.push({ id: `t${tickets.length}`, a: ids[i], b: ids[j], points: d });
      }
    }
  }
  return tickets;
}

const TICKETS = buildTickets();

module.exports = { CARD_COLORS, CITIES, ROUTES, TICKETS };
