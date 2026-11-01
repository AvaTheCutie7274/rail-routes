// Maps: the built-in test map, plus the code that turns any map definition (built-in or
// made in the map editor) into the cities, routes and tickets the game uses.
// Runs on the server (require) and in the browser (window.RailMap) so the editor
// checks maps exactly the way the server will.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RailMap = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const CARD_COLORS = ['blue', 'cyan', 'darkblue', 'green', 'orange', 'pink', 'red', 'white', 'yellow'];
  const ROUTE_COLORS = [...CARD_COLORS, 'any'];
  const BOARD_WIDTH = 1000; // every map is scaled to this width; height follows the image
  const MAX_ROUTE_LEN = 8;
  const MAX_BACKGROUND_CHARS = 12 * 1024 * 1024;

  // Display name for a card colour id.
  const colorName = (color) => (color === 'darkblue' ? 'dark blue' : color);

  // Test map: a small fictional region on a 1000x700 board.
  // Routes are [cityA, cityB, length, color, secondColor?]; 'any' = pay with any single color.
  // A second colour makes it a double route (two parallel tracks).
  const DEFAULT_MAP = {
    name: 'Test map',
    width: BOARD_WIDTH,
    height: 700,
    cities: [
      ['northport', 'Northport', 100, 80],
      ['frostwick', 'Frostwick', 330, 60],
      ['highcrag', 'Highcrag', 560, 90],
      ['pinehollow', 'Pinehollow', 790, 70],
      ['eastmere', 'Eastmere', 930, 180],
      ['saltmarsh', 'Saltmarsh', 80, 260],
      ['ironford', 'Ironford', 270, 220],
      ['millbrook', 'Millbrook', 470, 250],
      ['copperton', 'Copperton', 680, 230],
      ['duskvale', 'Duskvale', 870, 330],
      ['westhaven', 'Westhaven', 110, 440],
      ['redrock', 'Redrock', 330, 400],
      ['lanternfall', 'Lanternfall', 540, 420],
      ['brightwater', 'Brightwater', 740, 430],
      ['sunreach', 'Sunreach', 920, 520],
      ['coralbay', 'Coralbay', 130, 610],
      ['dunmore', 'Dunmore', 390, 590],
      ['emberfalls', 'Ember Falls', 640, 600],
      ['southgate', 'Southgate', 850, 640],
    ].map(([id, name, x, y]) => ({ id, name, x, y })),
    routes: [
      ['northport', 'frostwick', 3, 'blue'],
      ['frostwick', 'highcrag', 3, 'red', 'any'],
      ['highcrag', 'pinehollow', 3, 'yellow'],
      ['pinehollow', 'eastmere', 2, 'any'],
      ['northport', 'saltmarsh', 2, 'orange'],
      ['northport', 'ironford', 3, 'any'],
      ['frostwick', 'ironford', 2, 'white'],
      ['frostwick', 'millbrook', 3, 'pink'],
      ['highcrag', 'millbrook', 2, 'darkblue', 'cyan'],
      ['highcrag', 'copperton', 2, 'any'],
      ['pinehollow', 'copperton', 2, 'cyan'],
      ['eastmere', 'copperton', 3, 'white'],
      ['eastmere', 'duskvale', 2, 'red', 'green'],
      ['saltmarsh', 'ironford', 3, 'darkblue'],
      ['saltmarsh', 'westhaven', 2, 'any', 'any'],
      ['ironford', 'millbrook', 3, 'any'],
      ['ironford', 'redrock', 3, 'green'],
      ['ironford', 'westhaven', 4, 'yellow'],
      ['millbrook', 'copperton', 3, 'red'],
      ['millbrook', 'lanternfall', 2, 'blue', 'orange'],
      ['millbrook', 'redrock', 3, 'cyan'],
      ['copperton', 'duskvale', 3, 'pink', 'darkblue'],
      ['copperton', 'brightwater', 3, 'any'],
      ['duskvale', 'brightwater', 2, 'yellow'],
      ['duskvale', 'sunreach', 3, 'cyan'],
      ['westhaven', 'redrock', 3, 'white'],
      ['westhaven', 'coralbay', 2, 'green'],
      ['redrock', 'lanternfall', 3, 'orange', 'yellow'],
      ['redrock', 'dunmore', 3, 'red'],
      ['redrock', 'coralbay', 4, 'any'],
      ['lanternfall', 'brightwater', 3, 'white'],
      ['lanternfall', 'emberfalls', 3, 'any'],
      ['lanternfall', 'dunmore', 3, 'darkblue'],
      ['brightwater', 'sunreach', 3, 'orange'],
      ['brightwater', 'emberfalls', 3, 'blue', 'pink'],
      ['sunreach', 'southgate', 2, 'darkblue'],
      ['coralbay', 'dunmore', 4, 'cyan', 'blue'],
      ['dunmore', 'emberfalls', 4, 'pink'],
      ['emberfalls', 'southgate', 3, 'green', 'any'],
    ].map(([a, b, len, color, color2]) => ({ a, b, len, color, color2: color2 || null, points: [] })),
  };

  class MapError extends Error {}

  // Destination tickets: generated from city pairs, worth their shortest-path length.
  function shortestPaths(cityIds, routes) {
    const dist = {};
    for (const i of cityIds) {
      dist[i] = {};
      for (const j of cityIds) dist[i][j] = i === j ? 0 : Infinity;
    }
    for (const r of routes) {
      dist[r.a][r.b] = Math.min(dist[r.a][r.b], r.len);
      dist[r.b][r.a] = Math.min(dist[r.b][r.a], r.len);
    }
    for (const k of cityIds) for (const i of cityIds) for (const j of cityIds) {
      if (dist[i][k] + dist[k][j] < dist[i][j]) dist[i][j] = dist[i][k] + dist[k][j];
    }
    return dist;
  }

  function buildTickets(cityIds, routes) {
    const dist = shortestPaths(cityIds, routes);
    const pairs = [];
    for (let i = 0; i < cityIds.length; i++) {
      for (let j = i + 1; j < cityIds.length; j++) {
        const d = dist[cityIds[i]][cityIds[j]];
        if (d !== Infinity) pairs.push({ i, j, d });
      }
    }
    // Skip trivial neighbours, but relax that on small maps so there are enough tickets to deal.
    let min = 5;
    while (min > 2 && pairs.filter((p) => p.d >= min).length < 40) min--;
    let picked = pairs.filter((p) => p.d >= min);
    // Big maps would have hundreds; keep a spread rather than all of them.
    if (picked.length >= 80) picked = picked.filter((p) => (p.i + p.j) % 2 === 0);
    return picked.map((p, n) => ({ id: `t${n}`, a: cityIds[p.i], b: cityIds[p.j], points: p.d }));
  }

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  // Checks a map definition and builds what the game needs. Throws MapError with a readable message.
  function buildMap(def) {
    if (!def || typeof def !== 'object') throw new MapError('That is not a map file');
    const name = String(def.name || 'Untitled map').trim().slice(0, 40) || 'Untitled map';
    const height = Math.round(Number(def.height));
    if (!(height >= 100 && height <= 4000)) throw new MapError('Map height is out of range');
    let background = null;
    if (def.background != null) {
      if (typeof def.background !== 'string' || !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(def.background)) {
        throw new MapError('The background image is not a PNG, JPEG, GIF or WebP');
      }
      if (def.background.length > MAX_BACKGROUND_CHARS) throw new MapError('The background image is too large (9 MB max)');
      background = def.background;
    }

    if (!Array.isArray(def.cities) || def.cities.length < 2) throw new MapError('A map needs at least 2 cities');
    if (def.cities.length > 150) throw new MapError('Too many cities (150 max)');
    const CITIES = {};
    const names = new Set();
    for (const c of def.cities) {
      const id = String(c && c.id || '');
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || CITIES[id]) throw new MapError('A city has a missing or repeated id');
      const cityName = String(c.name || '').trim().slice(0, 24);
      if (!cityName) throw new MapError('Every city needs a name');
      if (names.has(cityName.toLowerCase())) throw new MapError(`Two cities are called ${cityName}`);
      names.add(cityName.toLowerCase());
      if (!isNum(c.x) || !isNum(c.y) || c.x < 0 || c.x > BOARD_WIDTH || c.y < 0 || c.y > height) {
        throw new MapError(`${cityName} is off the map`);
      }
      CITIES[id] = { name: cityName, x: c.x, y: c.y };
    }

    if (!Array.isArray(def.routes) || !def.routes.length) throw new MapError('A map needs at least one route');
    if (def.routes.length > 400) throw new MapError('Too many routes (400 max)');
    const ROUTES = [];
    const pairs = new Set();
    for (const r of def.routes) {
      const a = String(r && r.a), b = String(r && r.b);
      if (!CITIES[a] || !CITIES[b] || a === b) throw new MapError('A route is not connected to two cities');
      const label = `${CITIES[a].name} – ${CITIES[b].name}`;
      const pair = [a, b].sort().join('|');
      if (pairs.has(pair)) throw new MapError(`There are two routes between ${CITIES[a].name} and ${CITIES[b].name}. Make it one double route instead.`);
      pairs.add(pair);
      if (!Number.isInteger(r.len) || r.len < 1 || r.len > MAX_ROUTE_LEN) throw new MapError(`${label} must be 1–${MAX_ROUTE_LEN} spaces long`);
      if (!ROUTE_COLORS.includes(r.color)) throw new MapError(`${label} has an unknown colour`);
      if (r.color2 != null && !ROUTE_COLORS.includes(r.color2)) throw new MapError(`${label} has an unknown second colour`);
      const points = r.points == null ? [] : r.points;
      if (!Array.isArray(points) || points.length > 30 || !points.every((p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1]))) {
        throw new MapError(`${label} has broken bend points`);
      }
      const base = { a, b, len: r.len, points: points.map(([x, y]) => [x, y]) };
      if (r.color2 != null) {
        const id1 = `r${ROUTES.length}`;
        const id2 = `r${ROUTES.length + 1}`;
        ROUTES.push({ id: id1, ...base, color: r.color, lane: -1, sibling: id2 });
        ROUTES.push({ id: id2, ...base, color: r.color2, lane: 1, sibling: id1 });
      } else {
        ROUTES.push({ id: `r${ROUTES.length}`, ...base, color: r.color, lane: 0, sibling: null });
      }
    }

    const TICKETS = buildTickets(Object.keys(CITIES), ROUTES);
    const totalSpaces = ROUTES.reduce((s, r) => s + r.len, 0);
    // pixelated: keep a pixel-art background sharp instead of smoothing it when scaled.
    return { name, width: BOARD_WIDTH, height, background, pixelated: !!def.pixelated, CARD_COLORS, CITIES, ROUTES, TICKETS, totalSpaces };
  }

  const DEFAULT = buildMap(DEFAULT_MAP);

  return {
    CARD_COLORS, ROUTE_COLORS, BOARD_WIDTH, MAX_ROUTE_LEN, DEFAULT_MAP, MapError, buildMap, colorName,
    // The built-in map, for code that doesn't care which map is in use.
    CITIES: DEFAULT.CITIES, ROUTES: DEFAULT.ROUTES, TICKETS: DEFAULT.TICKETS, DEFAULT,
  };
});
