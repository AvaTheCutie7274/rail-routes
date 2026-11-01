// Map editor: place cities on a background image, draw routes between them (with bend
// points for curves), pick colours, and save the result as a map file the game can load.
// Work is kept in this browser automatically, so the lobby can use it directly.
const EDITOR_KEY = 'railRoutesEditorMap';
const SVG_NS = 'http://www.w3.org/2000/svg';
const { BOARD_WIDTH, ROUTE_COLORS, MAX_ROUTE_LEN, MapError, buildMap, colorName } = RailMap;
const DEFAULT_SPACE = 50;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // bigger images are shrunk before they're stored

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
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  return node;
};
const colorLabel = (c) => (c === 'any' ? 'any colour (grey)' : colorName(c));

let doc = blankDoc();
let tool = 'city';
let selected = null; // { kind: 'city' | 'route', id }
let drawing = null; // route being drawn: { from, bends }
let drag = null;
let pointer = null; // last pointer position on the board, for the drawing preview
let view = null; // current viewBox { x, y, w, h }
let undoStack = [];
let redoStack = [];
let saveWarned = false;

function blankDoc() {
  return { name: 'My map', height: 700, background: null, pixelated: false, spaceSize: DEFAULT_SPACE, cities: [], routes: [] };
}

// ---------- document helpers ----------

const cityById = (id) => doc.cities.find((c) => c.id === id);
const routeById = (id) => doc.routes.find((r) => r.id === id);
const routeBetween = (a, b) => doc.routes.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));

function nextId(prefix, list) {
  let n = 1;
  for (const item of list) {
    const m = String(item.id).match(/(\d+)$/);
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }
  return `${prefix}${n}`;
}

function nextCityName() {
  let n = doc.cities.length + 1;
  while (doc.cities.some((c) => c.name.toLowerCase() === `city ${n}`)) n++;
  return `City ${n}`;
}

// How long a route would be if its length followed its drawn path.
function fittedLength(r) {
  return RouteLayout.fitLength(cityById(r.a), cityById(r.b), r.points, doc.spaceSize);
}

// Routes on "auto" follow their drawn length; call after anything moves.
function refit() {
  for (const r of doc.routes) {
    if (r.auto) r.len = Math.min(MAX_ROUTE_LEN, fittedLength(r));
  }
}

// What gets saved and sent to the game.
function exportDoc() {
  refit();
  return {
    format: 'rail-routes-map',
    version: 1,
    name: doc.name,
    width: BOARD_WIDTH,
    height: doc.height,
    background: doc.background,
    pixelated: doc.pixelated,
    spaceSize: doc.spaceSize,
    cities: doc.cities.map(({ id, name, x, y }) => ({ id, name, x: round(x), y: round(y) })),
    routes: doc.routes.map(({ id, a, b, len, auto, color, color2, points }) => ({
      id, a, b, len, auto, color, color2, points: points.map(([x, y]) => [round(x), round(y)]),
    })),
  };
}
const round = (v) => Math.round(v * 10) / 10;

function importDoc(data) {
  if (!data || !Array.isArray(data.cities) || !Array.isArray(data.routes)) throw new Error('That file is not a map');
  const d = blankDoc();
  d.name = String(data.name || d.name);
  d.height = Number(data.height) || d.height;
  d.background = typeof data.background === 'string' ? data.background : null;
  d.pixelated = !!data.pixelated;
  d.spaceSize = Number(data.spaceSize) || DEFAULT_SPACE;
  d.cities = data.cities.map((c, i) => ({ id: String(c.id || `c${i + 1}`), name: String(c.name || ''), x: Number(c.x), y: Number(c.y) }));
  d.routes = data.routes.map((r, i) => ({
    id: String(r.id || `r${i + 1}`),
    a: String(r.a),
    b: String(r.b),
    len: Number(r.len) || 1,
    auto: r.auto === true,
    color: ROUTE_COLORS.includes(r.color) ? r.color : 'any',
    color2: ROUTE_COLORS.includes(r.color2) ? r.color2 : null,
    points: Array.isArray(r.points) ? r.points.map(([x, y]) => [Number(x), Number(y)]) : [],
  }));
  return d;
}

// ---------- undo & saving ----------

// Background images are big, so undo steps share the image rather than copying it.
const snapshot = () => ({ json: JSON.stringify({ ...doc, background: null }), background: doc.background });

function checkpoint() {
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
}

function restore(snap) {
  doc = { ...JSON.parse(snap.json), background: snap.background };
  if (selected && !(selected.kind === 'city' ? cityById(selected.id) : routeById(selected.id))) selected = null;
  drawing = null;
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  changed();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  changed();
}

let saveTimer;
function changed({ panel = true } = {}) {
  refit();
  renderCanvas();
  if (panel) renderPanel();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLocal, 400);
}

function saveLocal() {
  try {
    localStorage.setItem(EDITOR_KEY, JSON.stringify(exportDoc()));
    saveWarned = false;
  } catch {
    if (!saveWarned) toast('This map is too big to keep in the browser. Use "Save map file" so you don\'t lose it.', 6000);
    saveWarned = true;
  }
}

function loadLocal() {
  try {
    const data = JSON.parse(localStorage.getItem(EDITOR_KEY));
    if (data) doc = importDoc(data);
  } catch {}
}

// ---------- coordinates & view ----------

const canvas = $('canvas');

function boardPoint(e) {
  const p = canvas.createSVGPoint();
  p.x = e.clientX;
  p.y = e.clientY;
  const q = p.matrixTransform(canvas.getScreenCTM().inverse());
  return { x: q.x, y: q.y };
}

const clampToBoard = (p) => ({ x: Math.max(0, Math.min(BOARD_WIDTH, p.x)), y: Math.max(0, Math.min(doc.height, p.y)) });

function fitView() {
  const pad = 20;
  view = { x: -pad, y: -pad, w: BOARD_WIDTH + 2 * pad, h: doc.height + 2 * pad };
  applyView();
}

function applyView() {
  canvas.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = boardPoint(e);
  const factor = Math.exp(Math.sign(e.deltaY) * 0.15);
  const w = Math.max(80, Math.min(BOARD_WIDTH * 4, view.w * factor));
  const scale = w / view.w;
  view = { x: p.x - (p.x - view.x) * scale, y: p.y - (p.y - view.y) * scale, w, h: view.h * scale };
  applyView();
}, { passive: false });

// ---------- drawing the canvas ----------

// The background stays put between redraws; redrawing a big image on every drag frame is slow.
const boardRect = svg('rect', { class: 'board-bg', x: 0, y: 0, width: BOARD_WIDTH });
const bgImage = svg('image', { class: 'bg', x: 0, y: 0, width: BOARD_WIDTH, preserveAspectRatio: 'none' });
const layer = svg('g');
canvas.append(boardRect, bgImage, layer);

function renderCanvas() {
  boardRect.setAttribute('height', doc.height);
  bgImage.setAttribute('height', doc.height);
  if (bgImage.getAttribute('href') !== (doc.background || '')) bgImage.setAttribute('href', doc.background || '');
  bgImage.classList.toggle('pixelated', doc.pixelated);
  bgImage.style.display = doc.background ? '' : 'none';
  layer.replaceChildren();

  const routeLayer = svg('g');
  for (const r of doc.routes) {
    const a = cityById(r.a);
    const b = cityById(r.b);
    if (!a || !b) continue;
    const isSel = selected && selected.kind === 'route' && selected.id === r.id;
    const g = svg('g', { class: `ed-route${isSel ? ' selected' : ''}`, 'data-route': r.id });
    const lanes = r.color2 ? [[r.color, -1], [r.color2, 1]] : [[r.color, 0]];
    let line;
    for (const [color, lane] of lanes) {
      const layout = RouteLayout.slots(a, b, r.points, r.len, lane);
      line = layout.line;
      for (const s of layout.slots) {
        g.append(svg('image', {
          href: `spaces/${color}.png`, x: -layout.carW / 2, y: -layout.carH / 2, width: layout.carW, height: layout.carH,
          transform: `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)}) rotate(${s.angle.toFixed(1)})`,
        }));
      }
    }
    // A wide invisible line along the route makes it easy to click.
    g.prepend(svg('polyline', { class: 'hit', points: line.map((p) => p.join(',')).join(' ') }));
    routeLayer.append(g);
  }
  layer.append(routeLayer);

  // Bend handles for the selected route.
  const sel = selected && selected.kind === 'route' && routeById(selected.id);
  if (sel) {
    sel.points.forEach(([x, y], i) => {
      layer.append(svg('circle', { class: 'bend', cx: x, cy: y, r: 6, 'data-bend': i }));
    });
  }

  const cityLayer = svg('g');
  for (const c of doc.cities) {
    const isSel = (selected && selected.kind === 'city' && selected.id === c.id) || (drawing && drawing.from === c.id);
    const g = svg('g', { class: `city${isSel ? ' hl' : ''}`, 'data-city': c.id });
    g.append(svg('circle', { cx: c.x, cy: c.y, r: 11 }));
    const label = svg('text', { x: c.x, y: c.y - 18, 'text-anchor': 'middle' });
    label.textContent = c.name;
    g.append(label);
    cityLayer.append(g);
  }
  layer.append(cityLayer);

  if (drawing) {
    const from = cityById(drawing.from);
    const pts = [[from.x, from.y], ...drawing.bends];
    if (pointer) pts.push([pointer.x, pointer.y]);
    layer.append(svg('polyline', { class: 'draft', points: pts.map((p) => p.join(',')).join(' ') }));
    for (const [x, y] of drawing.bends) layer.append(svg('circle', { class: 'bend draft-bend', cx: x, cy: y, r: 5 }));
  }
  renderHint();
}

function renderHint() {
  let text;
  if (drawing) text = `From ${cityById(drawing.from).name}: click the map to add bends, then click the city it goes to. Esc cancels.`;
  else if (selected && selected.kind === 'route') text = 'Drag the dots to bend the route. Double-click the route to add a bend, double-click a dot to remove it.';
  else if (tool === 'city') text = doc.background || doc.cities.length ? 'Click the map to add a city. Drag cities to move them.' : 'Start by loading a map image in the panel, then click to add cities.';
  else text = 'Click the city a route starts at.';
  $('hint').textContent = text;
  $('tool-city').classList.toggle('active', tool === 'city');
  $('tool-route').classList.toggle('active', tool === 'route');
  $('undo-btn').disabled = !undoStack.length;
  $('redo-btn').disabled = !redoStack.length;
}

// ---------- pointer handling ----------

function hitTarget(e) {
  const t = e.target;
  const city = t.closest && t.closest('[data-city]');
  if (city) return { kind: 'city', id: city.dataset.city };
  if (t.dataset && t.dataset.bend != null && !t.classList.contains('draft-bend')) return { kind: 'bend', index: Number(t.dataset.bend) };
  const route = t.closest && t.closest('[data-route]');
  if (route) return { kind: 'route', id: route.dataset.route };
  return { kind: 'empty' };
}

function select(sel) {
  selected = sel;
  changed();
}

canvas.addEventListener('pointerdown', (e) => {
  const p = boardPoint(e);
  // Middle button, or holding space, pans the view.
  if (e.button === 1 || spaceHeld) {
    e.preventDefault();
    drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, view: { ...view } };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (e.button === 2) {
    if (drawing) { drawing = null; renderCanvas(); }
    return;
  }
  if (e.button !== 0) return;
  const hit = hitTarget(e);

  if (drawing) {
    if (hit.kind === 'city' && hit.id !== drawing.from) finishRoute(hit.id);
    else if (hit.kind !== 'city') { drawing.bends.push([p.x, p.y]); renderCanvas(); }
    return;
  }

  if (hit.kind === 'bend') {
    drag = { kind: 'bend', routeId: selected.id, index: hit.index, moved: false };
  } else if (hit.kind === 'city') {
    if (tool === 'route') {
      selected = null;
      drawing = { from: hit.id, bends: [] };
      pointer = p;
      changed();
      return;
    }
    const c = cityById(hit.id);
    drag = { kind: 'city', id: hit.id, dx: c.x - p.x, dy: c.y - p.y, moved: false };
    if (!selected || selected.id !== hit.id) select(hit);
  } else if (hit.kind === 'route') {
    if (!selected || selected.id !== hit.id) select(hit);
  } else if (tool === 'city') {
    checkpoint();
    const pos = clampToBoard(p);
    const city = { id: nextId('c', doc.cities), name: nextCityName(), x: pos.x, y: pos.y };
    doc.cities.push(city);
    selected = { kind: 'city', id: city.id };
    changed();
    const input = $('city-name');
    if (input) { input.focus(); input.select(); }
    return;
  } else if (selected) {
    select(null);
  }
  if (drag) canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (drag && drag.kind === 'pan') {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.max(drag.view.w / rect.width, drag.view.h / rect.height);
    view = { ...drag.view, x: drag.view.x - (e.clientX - drag.startX) * scale, y: drag.view.y - (e.clientY - drag.startY) * scale };
    applyView();
    return;
  }
  const p = boardPoint(e);
  if (drag) {
    if (!drag.moved) { checkpoint(); drag.moved = true; }
    if (drag.kind === 'city') {
      const c = cityById(drag.id);
      Object.assign(c, clampToBoard({ x: p.x + drag.dx, y: p.y + drag.dy }));
    } else if (drag.kind === 'bend') {
      const pos = clampToBoard(p);
      routeById(drag.routeId).points[drag.index] = [pos.x, pos.y];
    }
    refit();
    renderCanvas();
    return;
  }
  if (drawing) {
    pointer = p;
    renderCanvas();
  }
});

function endDrag() {
  if (drag && drag.moved) changed();
  drag = null;
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('dblclick', (e) => {
  const hit = hitTarget(e);
  if (hit.kind === 'bend') {
    checkpoint();
    routeById(selected.id).points.splice(hit.index, 1);
    changed();
  } else if (hit.kind === 'route') {
    addBend(routeById(hit.id), boardPoint(e));
  }
});

// Put a new bend where the route was double-clicked, between the points either side of it.
function addBend(r, p) {
  const a = cityById(r.a);
  const b = cityById(r.b);
  const pts = [[a.x, a.y], ...r.points, [b.x, b.y]];
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = segmentDistance(p, pts[i], pts[i + 1]);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  checkpoint();
  r.points.splice(best, 0, [p.x, p.y]);
  selected = { kind: 'route', id: r.id };
  changed();
}

function segmentDistance(p, [x0, y0], [x1, y1]) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.y - y0) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (x0 + dx * t), p.y - (y0 + dy * t));
}

function finishRoute(to) {
  const { from, bends } = drawing;
  drawing = null;
  const existing = routeBetween(from, to);
  if (existing) {
    toast('Those cities already have a route. Tick "Double route" on it for a second track.');
    selected = { kind: 'route', id: existing.id };
    changed();
    return;
  }
  checkpoint();
  const route = { id: nextId('r', doc.routes), a: from, b: to, len: 1, auto: true, color: 'any', color2: null, points: bends };
  doc.routes.push(route);
  selected = { kind: 'route', id: route.id };
  changed();
}

// ---------- keyboard ----------

let spaceHeld = false;
const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (drawing) drawing = null;
    else selected = null;
    if (typing()) document.activeElement.blur();
    changed();
    return;
  }
  if (typing()) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
  else if (e.key === ' ') { e.preventDefault(); spaceHeld = true; canvas.classList.add('panning'); }
  else if (e.key.toLowerCase() === 'c' && !ctrl) setTool('city');
  else if (e.key.toLowerCase() === 'r' && !ctrl) setTool('route');
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ') { spaceHeld = false; canvas.classList.remove('panning'); }
});

function setTool(t) {
  tool = t;
  drawing = null;
  changed();
}

function deleteSelected() {
  if (!selected) return;
  checkpoint();
  if (selected.kind === 'city') {
    doc.cities = doc.cities.filter((c) => c.id !== selected.id);
    doc.routes = doc.routes.filter((r) => r.a !== selected.id && r.b !== selected.id);
  } else {
    doc.routes = doc.routes.filter((r) => r.id !== selected.id);
  }
  selected = null;
  changed();
}

// ---------- side panel ----------

function section(title, ...children) {
  return el('section', { class: 'box' }, el('h2', {}, title), ...children);
}

function renderPanel() {
  const panel = $('panel');
  const parts = [];
  if (selected && selected.kind === 'city') parts.push(cityPanel(cityById(selected.id)));
  if (selected && selected.kind === 'route') parts.push(routePanel(routeById(selected.id)));
  parts.push(mapPanel(), checkPanel(), filePanel());
  panel.replaceChildren(...parts);
}

function cityPanel(c) {
  const routes = doc.routes.filter((r) => r.a === c.id || r.b === c.id).length;
  const input = el('input', { id: 'city-name', maxlength: 24, value: c.name });
  let typingStarted = false;
  input.addEventListener('input', () => {
    if (!typingStarted) { checkpoint(); typingStarted = true; }
    c.name = input.value;
    changed({ panel: false });
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  input.addEventListener('change', () => { c.name = c.name.trim(); changed(); });
  return section('City',
    el('label', { class: 'field' }, 'Name', input),
    el('p', { class: 'sub' }, `${routes} route${routes === 1 ? '' : 's'}. Drag it on the map to move it.`),
    el('div', { class: 'row' },
      el('button', { onclick: () => { setTool('route'); drawing = { from: c.id, bends: [] }; selected = null; changed(); } }, 'Draw a route from here'),
      el('button', { class: 'danger', onclick: deleteSelected }, 'Delete city')));
}

function colorPicker(current, onPick) {
  return el('div', { class: 'swatches' }, ...ROUTE_COLORS.map((c) => el('button', {
    class: `swatch-btn${c === current ? ' selected' : ''}`,
    title: colorLabel(c),
    onclick: () => onPick(c),
  }, el('img', { src: `spaces/${c}.png`, alt: colorLabel(c) }))));
}

function routePanel(r) {
  const a = cityById(r.a);
  const b = cityById(r.b);
  const set = (fn) => () => { checkpoint(); fn(); changed(); };
  const fit = fittedLength(r);
  const lenRow = el('div', { class: 'len-row' },
    el('button', { class: 'small', disabled: r.len <= 1, onclick: set(() => { r.auto = false; r.len--; }) }, '−'),
    el('strong', {}, `${r.len} space${r.len === 1 ? '' : 's'}`),
    el('button', { class: 'small', disabled: r.len >= MAX_ROUTE_LEN, onclick: set(() => { r.auto = false; r.len++; }) }, '+'),
    r.auto ? el('span', { class: 'sub' }, 'auto') : el('button', { class: 'small', onclick: set(() => { r.auto = true; }) }, 'Auto'));
  const notes = [];
  if (fit > MAX_ROUTE_LEN) notes.push(`This route is long enough for ${fit} spaces, but the most is ${MAX_ROUTE_LEN}. Its spaces are stretched; consider a city in between.`);

  return section(`Route: ${a.name} – ${b.name}`,
    el('span', { class: 'field-label' }, r.color2 ? 'Colour of track 1' : 'Colour'),
    colorPicker(r.color, (c) => { checkpoint(); r.color = c; changed(); }),
    el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: !!r.color2, onchange: (e) => { checkpoint(); r.color2 = e.target.checked ? 'any' : null; changed(); } }),
      'Double route (two tracks side by side)'),
    r.color2 ? el('span', { class: 'field-label' }, 'Colour of track 2') : '',
    r.color2 ? colorPicker(r.color2, (c) => { checkpoint(); r.color2 = c; changed(); }) : '',
    el('span', { class: 'field-label' }, 'Length'),
    lenRow,
    el('p', { class: 'sub' }, r.auto ? 'Set from how long the route is drawn. Use − / + to choose yourself.' : `You set this. Auto would make it ${Math.min(fit, MAX_ROUTE_LEN)}.`),
    ...notes.map((n) => el('p', { class: 'warn' }, n)),
    el('p', { class: 'sub' }, `${r.points.length} bend point${r.points.length === 1 ? '' : 's'}. Double-click the route to add one, double-click a dot to remove it.`),
    el('div', { class: 'row' },
      el('button', { disabled: !r.points.length, onclick: set(() => { r.points = []; }) }, 'Straighten'),
      el('button', { class: 'danger', onclick: deleteSelected }, 'Delete route')));
}

function mapPanel() {
  const name = el('input', { maxlength: 40, value: doc.name });
  name.addEventListener('change', () => { checkpoint(); doc.name = name.value.trim() || 'My map'; changed(); });
  const space = el('input', { type: 'range', min: 25, max: 90, step: 1, value: doc.spaceSize });
  const spaceText = el('span', { class: 'sub' }, String(doc.spaceSize));
  space.addEventListener('pointerdown', () => checkpoint());
  space.addEventListener('keydown', () => checkpoint());
  space.addEventListener('input', () => {
    doc.spaceSize = Number(space.value);
    spaceText.textContent = space.value;
    changed({ panel: false });
  });
  space.addEventListener('change', () => changed());

  return section('Map',
    el('label', { class: 'field' }, 'Name', name),
    el('span', { class: 'field-label' }, 'Background image'),
    el('div', { class: 'row' },
      el('button', { onclick: () => $('bg-file').click() }, doc.background ? 'Change image…' : 'Load image…'),
      doc.background ? el('button', { onclick: () => { checkpoint(); doc.background = null; changed(); } }, 'Remove') : ''),
    doc.background ? el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: doc.pixelated, onchange: (e) => { doc.pixelated = e.target.checked; changed(); } }),
      'Pixel art (keep it sharp)') : '',
    el('span', { class: 'field-label' }, 'Track space size'),
    el('div', { class: 'row range-row' }, space, spaceText),
    el('p', { class: 'sub' }, 'Smaller spaces make every auto-length route longer.'));
}

function checkPanel() {
  let built;
  try {
    built = buildMap(exportDoc());
  } catch (err) {
    if (!(err instanceof MapError)) throw err;
    return section('Ready to play?', el('p', { class: 'warn' }, err.message));
  }
  const problems = [];
  const lonely = doc.cities.filter((c) => !doc.routes.some((r) => r.a === c.id || r.b === c.id));
  if (lonely.length) problems.push(`No routes yet: ${lonely.map((c) => c.name).join(', ')}`);
  const groups = countGroups();
  if (groups > 1) problems.push(`The map is in ${groups} separate pieces, so some tickets can never be completed.`);
  const maxPlayers = Math.min(8, Math.floor(built.TICKETS.length / 3));
  if (maxPlayers < 2) problems.push(`Only ${built.TICKETS.length} tickets, too few to play. Add more cities and routes.`);
  else if (maxPlayers < 8) problems.push(`${built.TICKETS.length} tickets: enough for up to ${maxPlayers} players.`);
  return section('Ready to play?',
    el('p', { class: 'sub' }, `${doc.cities.length} cities, ${built.ROUTES.length} tracks, ${built.totalSpaces} spaces, ${built.TICKETS.length} tickets.`),
    ...problems.map((p) => el('p', { class: 'warn' }, p)),
    problems.length ? '' : el('p', { class: 'good' }, 'Looks good!'),
    el('p', { class: 'sub' }, 'Your map is kept in this browser. In a game lobby, the host can click "Use … from editor", or load a saved map file.'));
}

function countGroups() {
  const seen = new Set();
  let groups = 0;
  for (const c of doc.cities) {
    if (seen.has(c.id)) continue;
    groups++;
    const stack = [c.id];
    seen.add(c.id);
    while (stack.length) {
      const id = stack.pop();
      for (const r of doc.routes) {
        const next = r.a === id ? r.b : r.b === id ? r.a : null;
        if (next && !seen.has(next)) { seen.add(next); stack.push(next); }
      }
    }
  }
  return groups;
}

function filePanel() {
  return section('File',
    el('div', { class: 'row wrap' },
      el('button', { class: 'primary', onclick: saveFile }, 'Save map file'),
      el('button', { onclick: () => $('map-file').click() }, 'Open map file…'),
      el('button', { onclick: newMap }, 'New map'),
      el('button', { onclick: copyTestMap }, 'Edit the test map')));
}

// ---------- files ----------

function saveFile() {
  const blob = new Blob([JSON.stringify(exportDoc())], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `${doc.name.replace(/[^\w -]+/g, '').trim() || 'map'}.railmap.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function newMap() {
  if (doc.cities.length && !confirm('Start a new map? Save this one as a file first if you want to keep it.')) return;
  checkpoint();
  doc = blankDoc();
  selected = null;
  drawing = null;
  fitView();
  changed();
}

function copyTestMap() {
  if (doc.cities.length && !confirm('Replace this map with a copy of the test map?')) return;
  checkpoint();
  doc = importDoc({ ...RailMap.DEFAULT_MAP, routes: RailMap.DEFAULT_MAP.routes.map((r, i) => ({ ...r, id: `r${i + 1}`, auto: false })) });
  doc.name = 'Test map copy';
  selected = null;
  fitView();
  changed();
}

$('map-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = importDoc(JSON.parse(await file.text()));
    checkpoint();
    doc = data;
    selected = null;
    drawing = null;
    fitView();
    changed();
  } catch {
    toast('That file is not a map');
  }
});

$('bg-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { dataUrl, width, height } = await loadImage(file);
    checkpoint();
    const newHeight = Math.max(100, Math.min(4000, Math.round((BOARD_WIDTH * height) / width)));
    // Keep cities and bends in the same place relative to the picture.
    const sy = newHeight / doc.height;
    if (sy !== 1) {
      for (const c of doc.cities) c.y *= sy;
      for (const r of doc.routes) r.points = r.points.map(([x, y]) => [x, y * sy]);
    }
    doc.height = newHeight;
    doc.background = dataUrl;
    // Small images are probably pixel art.
    doc.pixelated = width <= 800;
    fitView();
    changed();
  } catch (err) {
    toast(err.message || 'Could not load that image');
  }
});

// Reads an image file; very large ones are shrunk so the map file stays a sensible size.
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image the browser can open'));
      img.onload = () => {
        const { naturalWidth: width, naturalHeight: height } = img;
        if (file.size <= MAX_IMAGE_BYTES && /^data:image\/(png|jpeg|gif|webp);/.test(reader.result)) {
          resolve({ dataUrl: reader.result, width, height });
          return;
        }
        const scale = Math.min(1, 2400 / width);
        const c = document.createElement('canvas');
        c.width = Math.round(width * scale);
        c.height = Math.round(height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve({ dataUrl: c.toDataURL('image/jpeg', 0.88), width: c.width, height: c.height });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- misc ----------

let toastTimer;
function toast(text, ms = 3500) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

$('tool-city').addEventListener('click', () => setTool('city'));
$('tool-route').addEventListener('click', () => setTool('route'));
$('undo-btn').addEventListener('click', undo);
$('redo-btn').addEventListener('click', redo);
$('fit-btn').addEventListener('click', fitView);

loadLocal();
fitView();
changed();
