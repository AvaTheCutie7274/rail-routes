// Where the track spaces of a route go on the board. Used by the game and the map editor.
// A route runs from city A through its bend points to city B along a smooth curve, and
// its spaces are spread evenly along that curve.
const RouteLayout = (() => {
  const SPRITE_ASPECT = 3; // space and car sprites are 36x12
  const MARGIN = 20; // gap left around each city
  const GAP = 3; // gap between spaces
  const MAX_CAR_W = 60;

  // Catmull-Rom curve through the points, as a dense polyline.
  function curve(points) {
    if (points.length === 2) return points;
    const out = [points[0]];
    const steps = 20;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(i - 1, 0)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(i + 2, points.length - 1)];
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const t2 = t * t;
        const t3 = t2 * t;
        const at = (k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
          + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
        out.push([at(0), at(1)]);
      }
    }
    return out;
  }

  function measure(line) {
    const dists = [0];
    for (let i = 1; i < line.length; i++) {
      dists.push(dists[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    }
    return dists;
  }

  // Point and direction at distance d along the polyline.
  function pointAt(line, dists, d) {
    let i = 1;
    while (i < line.length - 1 && dists[i] < d) i++;
    const [x0, y0] = line[i - 1];
    const [x1, y1] = line[i];
    const seg = dists[i] - dists[i - 1] || 1;
    const t = Math.max(0, Math.min(1, (d - dists[i - 1]) / seg));
    return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, ux: (x1 - x0) / seg, uy: (y1 - y0) / seg };
  }

  function path(a, b, bends) {
    const line = curve([[a.x, a.y], ...(bends || []), [b.x, b.y]]);
    return { line, dists: measure(line) };
  }

  // How many spaces fit along the route when each is `spaceLen` long.
  function fitLength(a, b, bends, spaceLen) {
    const { dists } = path(a, b, bends);
    const usable = dists[dists.length - 1] - 2 * MARGIN;
    return Math.max(1, Math.round((usable + GAP) / (spaceLen + GAP)));
  }

  // Centre and angle (degrees) of each space; lane -1/+1 shifts the two tracks of a double route apart.
  function slots(a, b, bends, len, lane) {
    const { line, dists } = path(a, b, bends);
    const total = dists[dists.length - 1];
    const slotLen = Math.max(4, (total - 2 * MARGIN - GAP * (len - 1)) / len);
    const carW = Math.min(slotLen, MAX_CAR_W);
    const carH = carW / SPRITE_ASPECT;
    const offset = lane * (carH / 2 + 1.5);
    const result = [];
    for (let i = 0; i < len; i++) {
      const p = pointAt(line, dists, MARGIN + slotLen / 2 + i * (slotLen + GAP));
      const angle = (Math.atan2(p.uy, p.ux) * 180) / Math.PI;
      result.push({
        x: p.x - p.uy * offset,
        y: p.y + p.ux * offset,
        // Turn sprites around when running right-to-left so the cars' wheels stay at the bottom.
        angle: Math.abs(angle) > 90 ? angle + 180 : angle,
      });
    }
    return { slots: result, carW, carH, line };
  }

  return { slots, fitLength, path };
})();
