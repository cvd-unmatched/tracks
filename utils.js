// Distance between two points
export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// Linear interpolation between two points by factor t (0..1)
export function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

// Clamp value between lo and hi
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Line segment intersection: returns intersection point + parameter t, or null
export function segIntersect(a, b, c, d) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const ex = d.x - c.x, ey = d.y - c.y;
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / denom;
  const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * dx, y: a.y + t * dy, t };
}

// Catmull-Rom spline interpolation between 4 control points at parameter t
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * (2*p1.x + (-p0.x+p2.x)*t + (2*p0.x-5*p1.x+4*p2.x-p3.x)*t2 + (-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
    y: 0.5 * (2*p1.y + (-p0.y+p2.y)*t + (2*p0.y-5*p1.y+4*p2.y-p3.y)*t2 + (-p0.y+3*p1.y-3*p2.y+p3.y)*t3)
  };
}

// Convert raw waypoints into a smooth closed loop using Catmull-Rom splines
export function smoothPath(waypoints, samplesPerSeg = 12) {
  const n = waypoints.length;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const p0 = waypoints[(i - 1 + n) % n];
    const p1 = waypoints[i];
    const p2 = waypoints[(i + 1) % n];
    const p3 = waypoints[(i + 2) % n];
    for (let j = 0; j < samplesPerSeg; j++) {
      pts.push(catmullRom(p0, p1, p2, p3, j / samplesPerSeg));
    }
  }
  return pts;
}
