import { dist, segIntersect, smoothPath } from './utils.js';
import { CAR_W } from './constants.js';

// Builds a race track from user-placed waypoints: smooth centerline,
// left/right walls, checkpoints, and start position
export class Track {
  constructor(waypoints, halfWidth = 40) {
    this.waypoints = waypoints;
    this.halfWidth = halfWidth;
    this.build();
  }

  build() {
    const center = smoothPath(this.waypoints, 14);
    this.center = center;
    const n = center.length;
    this.left = [];
    this.right = [];

    // Compute left/right road edges by offsetting perpendicular to the tangent
    for (let i = 0; i < n; i++) {
      const prev = center[(i - 1 + n) % n];
      const next = center[(i + 1) % n];
      const tx = next.x - prev.x, ty = next.y - prev.y;
      const len = Math.hypot(tx, ty) || 1;
      const nx = -ty / len, ny = tx / len;
      this.left.push({ x: center[i].x + nx * this.halfWidth, y: center[i].y + ny * this.halfWidth });
      this.right.push({ x: center[i].x - nx * this.halfWidth, y: center[i].y - ny * this.halfWidth });
    }

    // Build wall segments tagged with centerline index for proximity filtering
    this.walls = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.walls.push({ p1: this.left[i], p2: this.left[j], idx: i });
      this.walls.push({ p1: this.right[i], p2: this.right[j], idx: i });
    }

    // ~60 checkpoints evenly around the loop (used for fitness scoring)
    const cpInterval = Math.max(1, Math.floor(n / 60));
    this.cpInterval = cpInterval;
    this.checkpoints = [];
    for (let i = 0; i < n; i += cpInterval) {
      this.checkpoints.push({
        left: this.left[i], right: this.right[i],
        center: center[i], index: this.checkpoints.length,
        centerIdx: i
      });
    }

    // Average pixel distance between consecutive center points
    let totalLen = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      totalLen += Math.hypot(center[j].x - center[i].x, center[j].y - center[i].y);
    }
    this.avgSegLen = totalLen / n;

    // Start position and angle (tangent at first center point)
    const tangentX = center[1].x - center[0].x;
    const tangentY = center[1].y - center[0].y;
    this.startPos = { x: center[0].x, y: center[0].y };
    this.startAngle = Math.atan2(tangentY, tangentX);

    this.valid = this.validate();
  }

  // Return only walls within 40% of the track around trackIdx.
  // Prevents cars from "seeing" walls on a distant overlapping section.
  getWallsNear(trackIdx) {
    const n = this.center.length;
    const range = Math.floor(n * 0.4);
    return this.walls.filter(w => {
      let diff = Math.abs(w.idx - trackIdx);
      if (diff > n / 2) diff = n - diff;
      return diff <= range;
    });
  }

  validate() {
    const n = this.center.length;
    const samplesPerWP = Math.round(n / this.waypoints.length);
    this.badWaypoints = new Set();

    const flagIdx = (centerIdx) => {
      this.badWaypoints.add(Math.floor(centerIdx / samplesPerWP) % this.waypoints.length);
    };

    for (let i = 0; i < n; i++) {
      // Only reject if left/right walls have fully crossed (road inverted)
      const j = (i + 1) % n;
      if (segIntersect(this.left[i], this.left[j], this.right[i], this.right[j])) flagIdx(i);
    }

    this.valid = this.badWaypoints.size === 0;
    return this.valid;
  }
}
