// ─── Utilities ───────────────────────────────────────────────────
// Distance between two points
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
// Linear interpolation between two points by factor t (0..1)
function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
// Clamp value between lo and hi
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Line segment intersection: returns intersection point + parameter t, or null
function segIntersect(a, b, c, d) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const ex = d.x - c.x, ey = d.y - c.y;
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-10) return null; // parallel
  const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / denom;
  const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null; // no hit
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
function smoothPath(waypoints, samplesPerSeg = 12) {
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

// ─── Neural Network ──────────────────────────────────────────────
// Simple feedforward neural net used as the car's "brain"
class NeuralNet {
  // Topology e.g. [6, 8, 2] = 6 inputs, 8 hidden, 2 outputs
  constructor(topology) {
    this.topology = topology;
    this.weights = [];
    // Initialize weights + biases with random values
    for (let i = 1; i < topology.length; i++) {
      const fanIn = topology[i - 1], fanOut = topology[i];
      for (let j = 0; j < fanOut; j++) {
        for (let k = 0; k < fanIn; k++) this.weights.push(Math.random() * 2 - 1);
        this.weights.push(Math.random() * 0.4 - 0.2); // bias
      }
    }
  }

  // Forward pass: feed inputs through layers, tanh activation
  predict(inputs) {
    let current = inputs.slice();
    let wi = 0;
    for (let l = 1; l < this.topology.length; l++) {
      const prev = current;
      current = [];
      for (let j = 0; j < this.topology[l]; j++) {
        let sum = 0;
        for (let k = 0; k < prev.length; k++) sum += prev[k] * this.weights[wi++];
        sum += this.weights[wi++]; // bias
        current.push(Math.tanh(sum));
      }
    }
    return current;
  }

  clone() {
    const nn = new NeuralNet(this.topology);
    nn.weights = this.weights.slice();
    return nn;
  }

  // Randomly nudge weights: rate = probability, strength = magnitude
  mutate(rate, strength) {
    for (let i = 0; i < this.weights.length; i++) {
      if (Math.random() < rate) {
        this.weights[i] += (Math.random() * 2 - 1) * strength;
      }
    }
  }

  // Single-point crossover: take first half from parent a, second from b
  static crossover(a, b) {
    const child = a.clone();
    const split = Math.floor(Math.random() * child.weights.length);
    for (let i = split; i < child.weights.length; i++) {
      child.weights[i] = b.weights[i];
    }
    return child;
  }
}

// ─── Track ───────────────────────────────────────────────────────
// Builds a race track from user-placed waypoints: smooth centerline,
// left/right walls, checkpoints, and start position
class Track {
  constructor(waypoints, halfWidth = 40) {
    this.waypoints = waypoints; // raw user clicks (stored for export)
    this.halfWidth = halfWidth; // road half-width in pixels
    this.build();
  }

  build() {
    // Smooth waypoints into a dense centerline with Catmull-Rom
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
      const nx = -ty / len, ny = tx / len; // perpendicular normal
      this.left.push({ x: center[i].x + nx * this.halfWidth, y: center[i].y + ny * this.halfWidth });
      this.right.push({ x: center[i].x - nx * this.halfWidth, y: center[i].y - ny * this.halfWidth });
    }

    // Build wall segments (used for collision + sensor ray casting)
    // Each wall is tagged with its centerline index for proximity filtering
    this.walls = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.walls.push({ p1: this.left[i], p2: this.left[j], idx: i });
      this.walls.push({ p1: this.right[i], p2: this.right[j], idx: i });
    }

    // Place ~60 checkpoints evenly around the loop (used for fitness scoring)
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

    // Average pixel distance between consecutive center points (for unit conversion)
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
      if (diff > n / 2) diff = n - diff; // wrap around
      return diff <= range;
    });
  }

  // Check every 3rd point: road must be wide enough for a car to fit
  validate() {
    const n = this.center.length;
    for (let i = 0; i < n; i += 3) {
      if (dist(this.left[i], this.right[i]) < CAR_W * 1.5) return false;
    }
    return true;
  }
}

// ─── Car ─────────────────────────────────────────────────────────
const CAR_L = 18, CAR_W = 9;          // car body dimensions (px)
const SENSOR_COUNT = 5;                // number of distance sensors
const SENSOR_ANGLES = [-Math.PI/2, -Math.PI/4, 0, Math.PI/4, Math.PI/2]; // fan of rays
const SENSOR_RANGE = 160;             // max sensor ray length (px)
const ACCEL = 0.25;                   // acceleration per tick
const NN_TOPOLOGY = [SENSOR_COUNT + 1, 8, 2]; // 6 in (5 sensors + speed), 8 hidden, 2 out (steer + accel)
const STALE_LIMIT = 150;              // die after this many ticks without a new checkpoint

// Live-tweakable car physics (changed by UI sliders)
const carConfig = {
  maxSpeed: 5.5,
  minSpeed: 0.8,
  turnRate: 0.055,
};

class Car {
  constructor(track, brain) {
    this.track = track;
    this.brain = brain || new NeuralNet(NN_TOPOLOGY);
    this.reset();
  }

  reset() {
    this.x = this.track.startPos.x;
    this.y = this.track.startPos.y;
    this.angle = this.track.startAngle;
    this.speed = 2;
    this.alive = true;
    this.fitness = 0;
    this.nextCP = 0;       // index of the next checkpoint to cross
    this.cpPassed = 0;     // total checkpoints crossed (can exceed track length = laps)
    this.staleTicks = 0;   // ticks since last checkpoint
    this.ticks = 0;        // total ticks alive
    this.sensors = new Array(SENSOR_COUNT).fill(1);
    this.sensorPts = [];   // endpoint of each sensor ray (for rendering)
    this.nearbyWalls = null;
  }

  // Map current progress to a centerline index (for wall proximity filtering)
  getTrackIdx() {
    if (this.cpPassed === 0) return 0;
    const numCP = this.track.checkpoints.length;
    const prevCP = (this.nextCP - 1 + numCP) % numCP;
    return this.track.checkpoints[prevCP].centerIdx;
  }

  // Refresh the filtered wall set around the car's current track position
  refreshWalls() {
    this.nearbyWalls = this.track.getWallsNear(this.getTrackIdx());
  }

  // One physics tick: sense -> think -> move -> collide -> score
  update() {
    if (!this.alive) return;
    this.ticks++;
    this.staleTicks++;
    if (this.staleTicks > STALE_LIMIT) { this.alive = false; return; }

    // Refresh nearby walls every 4 ticks or on first tick
    if (!this.nearbyWalls || this.ticks % 4 === 1) this.refreshWalls();

    // Sense: cast rays to detect walls
    this.castSensors();
    // Think: feed sensors + normalized speed into the neural net
    const inputs = [...this.sensors, this.speed / carConfig.maxSpeed];
    const [steer, accel] = this.brain.predict(inputs);

    // Move: apply steering and acceleration
    this.angle += steer * carConfig.turnRate;
    this.speed += accel * ACCEL;
    this.speed = clamp(this.speed, carConfig.minSpeed, carConfig.maxSpeed);

    // Sub-step movement at high speed to avoid phasing through walls
    const steps = this.speed > 3 ? 2 : 1;
    const dx = Math.cos(this.angle) * this.speed / steps;
    const dy = Math.sin(this.angle) * this.speed / steps;
    for (let s = 0; s < steps; s++) {
      this.x += dx;
      this.y += dy;
      if (this.checkCollision()) { this.alive = false; return; }
      this.checkCheckpoints();
    }
    this.computeFitness();
  }

  // Cast sensor rays outward, record distance to nearest wall (0..1)
  castSensors() {
    const walls = this.nearbyWalls || this.track.walls;
    this.sensorPts = [];
    for (let i = 0; i < SENSOR_COUNT; i++) {
      const a = this.angle + SENSOR_ANGLES[i];
      const ex = this.x + Math.cos(a) * SENSOR_RANGE;
      const ey = this.y + Math.sin(a) * SENSOR_RANGE;
      const origin = { x: this.x, y: this.y };
      const end = { x: ex, y: ey };
      let minT = 1;
      let hitPt = end;
      for (const w of walls) {
        const hit = segIntersect(origin, end, w.p1, w.p2);
        if (hit && hit.t < minT) { minT = hit.t; hitPt = hit; }
      }
      this.sensors[i] = minT; // 0 = wall right here, 1 = nothing in range
      this.sensorPts.push(hitPt);
    }
  }

  // Check if any edge of the car body intersects a wall
  checkCollision() {
    const walls = this.nearbyWalls || this.track.walls;
    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    const hl = CAR_L / 2, hw = CAR_W / 2;
    const corners = [
      { x: this.x + cos*hl - sin*hw, y: this.y + sin*hl + cos*hw },
      { x: this.x + cos*hl + sin*hw, y: this.y + sin*hl - cos*hw },
      { x: this.x - cos*hl + sin*hw, y: this.y - sin*hl - cos*hw },
      { x: this.x - cos*hl - sin*hw, y: this.y - sin*hl + cos*hw },
    ];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i+1)%4];
      for (const w of walls) {
        if (segIntersect(a, b, w.p1, w.p2)) return true;
      }
    }
    return false;
  }

  // Detect when the car crosses the next checkpoint line
  checkCheckpoints() {
    const cp = this.track.checkpoints[this.nextCP];
    const prev = { x: this.x - Math.cos(this.angle) * this.speed, y: this.y - Math.sin(this.angle) * this.speed };
    const cur = { x: this.x, y: this.y };
    if (segIntersect(prev, cur, cp.left, cp.right)) {
      this.cpPassed++;
      this.staleTicks = 0; // reset stale timer
      this.nextCP = (this.nextCP + 1) % this.track.checkpoints.length;
      this.refreshWalls(); // walls may change after crossing a checkpoint
    }
  }

  // Fitness = checkpoints passed + fractional progress toward next one
  computeFitness() {
    const cp = this.track.checkpoints[this.nextCP];
    const totalD = dist(
      this.track.checkpoints[(this.nextCP - 1 + this.track.checkpoints.length) % this.track.checkpoints.length].center,
      cp.center
    ) || 1;
    const myD = dist({ x: this.x, y: this.y }, cp.center);
    const partial = clamp(1 - myD / totalD, 0, 1);
    this.fitness = this.cpPassed + partial;
  }

  // Get the 4 corner positions of the car body (for rendering + collision)
  getCorners() {
    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    const hl = CAR_L / 2, hw = CAR_W / 2;
    return [
      { x: this.x + cos*hl - sin*hw, y: this.y + sin*hl + cos*hw },
      { x: this.x + cos*hl + sin*hw, y: this.y + sin*hl - cos*hw },
      { x: this.x - cos*hl + sin*hw, y: this.y - sin*hl - cos*hw },
      { x: this.x - cos*hl - sin*hw, y: this.y - sin*hl + cos*hw },
    ];
  }
}

// ─── Simulation ──────────────────────────────────────────────────
// Manages a population of cars and runs the genetic algorithm
class Simulation {
  constructor(track, popSize = 50, mutRate = 0.15) {
    this.track = track;
    this.popSize = popSize;
    this.mutRate = mutRate;
    this.mutStrength = 0.5;       // how much each mutated weight changes
    this.generation = 0;
    this.bestFitnessAll = 0;      // best fitness across all generations
    this.bestBrain = null;        // best neural net ever (carries across gens)
    this.fitnessHistory = [];     // best fitness per generation (for graph)
    this.genLog = [];             // detailed log per generation (for table)
    this.maxTicks = 2000;         // max ticks before forcing evolution
    this.tick = 0;
    this.spawn();
  }

  // Create a fresh batch of cars. First gen = random brains.
  // Later gens = clones of the best brain, mutated.
  spawn() {
    this.cars = [];
    this.tick = 0;
    for (let i = 0; i < this.popSize; i++) {
      const brain = (i === 0 && this.bestBrain)
        ? this.bestBrain.clone()         // car 0 = exact copy of best
        : (this.bestBrain ? this.bestBrain.clone() : new NeuralNet(NN_TOPOLOGY));
      if (i > 0) brain.mutate(this.mutRate, this.mutStrength);
      this.cars.push(new Car(this.track, brain));
    }
  }

  // Advance simulation by one tick. End generation if all dead or timeout.
  step() {
    this.tick++;

    let anyAlive = false;
    for (const c of this.cars) {
      if (c.alive) { c.update(); anyAlive = true; }
    }
    if (!anyAlive || this.tick >= this.maxTicks) {
      this.evolve();
    }
  }

  // End of generation: pick the best, breed, mutate, spawn next gen
  evolve() {
    this.cars.sort((a, b) => b.fitness - a.fitness);
    const bestFit = this.cars[0].fitness;

    // Track all-time best
    if (bestFit > this.bestFitnessAll) {
      this.bestFitnessAll = bestFit;
      this.bestBrain = this.cars[0].brain.clone();
    }
    this.fitnessHistory.push(bestFit);

    // Log this generation's stats
    const bestCar = this.cars[0];
    const numCP = this.track.checkpoints.length;
    this.genLog.push({
      gen: this.generation,
      fitness: bestFit,
      ticks: bestCar.ticks,
      dist: Math.round((bestFit / numCP) * 100), // % of one lap
    });

    // Selection: top 10% are elite (copied unchanged), top 35% form the breeding pool
    const eliteCount = Math.max(2, Math.floor(this.popSize * 0.1));
    const pool = this.cars.slice(0, Math.floor(this.popSize * 0.35));

    const newBrains = [];
    for (let i = 0; i < eliteCount; i++) {
      newBrains.push(this.cars[i].brain.clone());
    }
    newBrains.push(this.bestBrain.clone()); // always keep all-time best

    // Fill remaining slots with crossover + mutation from the breeding pool
    while (newBrains.length < this.popSize) {
      const pA = pool[Math.floor(Math.random() * pool.length)].brain;
      const pB = pool[Math.floor(Math.random() * pool.length)].brain;
      const child = NeuralNet.crossover(pA, pB);
      child.mutate(this.mutRate, this.mutStrength);
      newBrains.push(child);
    }

    this.generation++;
    this.cars = [];
    this.tick = 0;
    for (const brain of newBrains) {
      this.cars.push(new Car(this.track, brain));
    }
  }

  aliveCount() { return this.cars.filter(c => c.alive).length; }

  // Return the best currently alive car (for camera/highlight)
  bestCar() {
    let best = null;
    for (const c of this.cars) {
      if (c.alive && (!best || c.fitness > best.fitness)) best = c;
    }
    return best || this.cars[0];
  }

  currentBestFitness() {
    return Math.max(...this.cars.map(c => c.fitness));
  }
}

// ─── Presets ─────────────────────────────────────────────────────
// Built-in track presets (fallback if tracks.json is missing)
const BUILTIN_PRESETS = [
  { name:'Oval', color:'go', type:'circle', count:16, rx:0.34, ry:0.32 },
  { name:'Complex', color:'t-blue', offsets:[[-280,60],[-240,-80],[-120,-160],[40,-180],[180,-120],[280,-40],[300,80],[220,180],[80,160],[-60,200],[-180,180],[-300,140]] },
  { name:'Figure 8', color:'t-orange', offsets:[[-260,-20],[-120,-180],[100,-200],[260,-80],[60,60],[-60,-60],[-260,80],[-100,200],[120,180],[260,20]] },
];
let trackPresets = [...BUILTIN_PRESETS];

// Try to load presets from tracks.json, fall back to built-ins
async function loadTracksFile() {
  try {
    const resp = await fetch('tracks.json');
    if (!resp.ok) return;
    const data = await resp.json();
    if (Array.isArray(data) && data.length) trackPresets = data;
  } catch (_) {}
}

// Convert a preset definition into absolute waypoint coordinates.
// Auto-scales offsets to fit the current viewport with a 60px margin.
function presetToWaypoints(preset, w, h) {
  const cx = w / 2, cy = h / 2;
  if (preset.type === 'circle') {
    const pts = [];
    for (let i = 0; i < preset.count; i++) {
      const a = (i / preset.count) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * (w * preset.rx), y: cy + Math.sin(a) * (h * preset.ry) });
    }
    return pts;
  }
  if (preset.offsets) {
    const margin = 60;
    let maxDx = 0, maxDy = 0;
    for (const [dx, dy] of preset.offsets) {
      maxDx = Math.max(maxDx, Math.abs(dx));
      maxDy = Math.max(maxDy, Math.abs(dy));
    }
    const sx = maxDx > 0 ? Math.min(1, (cx - margin) / maxDx) : 1;
    const sy = maxDy > 0 ? Math.min(1, (cy - margin) / maxDy) : 1;
    const scale = Math.min(sx, sy);
    return preset.offsets.map(([dx, dy]) => ({ x: cx + dx * scale, y: cy + dy * scale }));
  }
  return [];
}

// Dynamically create preset buttons in the draw-mode panel
function renderPresetButtons() {
  const container = document.getElementById('preset-btns');
  if (!container) return;
  const colors = ['go','t-blue','t-orange','go','t-blue','t-orange'];
  container.innerHTML = '';
  trackPresets.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.className = p.color || colors[i % colors.length];
    btn.textContent = p.name;
    btn.onclick = () => app.loadPreset(i);
    container.appendChild(btn);
  });
}

// ─── Scenery Generation ──────────────────────────────────────────
// Random decorative objects placed away from the road
const HOUSE_COLORS = ['#e74c3c','#3498db','#f1c40f','#e67e22','#9b59b6','#1abc9c','#fff'];
const ROOF_COLORS  = ['#c0392b','#8d4925','#6b4226','#b53d1e','#7b3f6e'];

function generateScenery(track, W, H) {
  const items = [];
  const rng = (lo, hi) => lo + Math.random() * (hi - lo);
  const attempts = 120;

  for (let a = 0; a < attempts; a++) {
    const x = rng(30, W - 30);
    const y = rng(30, H - 30);
    // Skip if too close to the road
    let tooClose = false;
    for (let i = 0; i < track.center.length; i += 4) {
      if (dist({x, y}, track.center[i]) < track.halfWidth + 36) { tooClose = true; break; }
    }
    if (tooClose) continue;

    // Randomly pick a scenery type
    const r = Math.random();
    if (r < 0.35) {
      items.push({ type: 'tree', x, y, size: rng(6, 11) });
    } else if (r < 0.55) {
      items.push({
        type: 'house', x, y,
        w: rng(20, 32), h: rng(16, 24),
        color: HOUSE_COLORS[Math.floor(Math.random() * HOUSE_COLORS.length)],
        roof: ROOF_COLORS[Math.floor(Math.random() * ROOF_COLORS.length)],
      });
    } else if (r < 0.7) {
      items.push({ type: 'bush', x, y, size: rng(4, 8) });
    } else if (r < 0.78) {
      items.push({ type: 'pond', x, y, rx: rng(14, 28), ry: rng(10, 20) });
    } else {
      items.push({ type: 'fence', x, y, len: rng(24, 50), angle: Math.random() * Math.PI });
    }
  }
  return items;
}

// Draw all scenery items onto the canvas
function drawScenery(ctx, items) {
  for (const it of items) {
    switch (it.type) {
      case 'tree': {
        ctx.fillStyle = '#5d4037';
        ctx.fillRect(it.x - 2, it.y + 2, 4, it.size); // trunk
        ctx.fillStyle = '#2e7d32';
        ctx.beginPath();
        ctx.arc(it.x, it.y - 1, it.size, 0, Math.PI * 2); // canopy
        ctx.fill();
        ctx.fillStyle = '#1b5e20';
        ctx.beginPath();
        ctx.arc(it.x - 2, it.y + 1, it.size * 0.55, 0, Math.PI * 2); // shadow blob
        ctx.fill();
        break;
      }
      case 'house': {
        ctx.fillStyle = it.color;
        ctx.fillRect(it.x - it.w/2, it.y - it.h/2, it.w, it.h); // walls
        ctx.strokeStyle = '#5d4037';
        ctx.lineWidth = 1;
        ctx.strokeRect(it.x - it.w/2, it.y - it.h/2, it.w, it.h);
        ctx.fillStyle = it.roof;
        ctx.beginPath(); // triangular roof
        ctx.moveTo(it.x - it.w/2 - 4, it.y - it.h/2);
        ctx.lineTo(it.x, it.y - it.h/2 - 14);
        ctx.lineTo(it.x + it.w/2 + 4, it.y - it.h/2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#5d4037';
        ctx.fillRect(it.x - 3, it.y - it.h/2 + it.h * 0.35, 6, it.h * 0.65); // door
        ctx.fillStyle = '#bbdefb';
        ctx.fillRect(it.x + it.w * 0.15, it.y - it.h/2 + 4, 6, 5); // window
        if (it.w > 24) ctx.fillRect(it.x - it.w * 0.15 - 6, it.y - it.h/2 + 4, 6, 5);
        break;
      }
      case 'bush': {
        ctx.fillStyle = '#388E3C';
        ctx.beginPath();
        ctx.arc(it.x, it.y, it.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2E7D32';
        ctx.beginPath();
        ctx.arc(it.x + it.size * 0.4, it.y - it.size * 0.2, it.size * 0.7, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'pond': {
        ctx.fillStyle = '#4fc3f7';
        ctx.beginPath();
        ctx.ellipse(it.x, it.y, it.rx, it.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; // highlight
        ctx.beginPath();
        ctx.ellipse(it.x - it.rx * 0.2, it.y - it.ry * 0.2, it.rx * 0.4, it.ry * 0.3, -0.3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'fence': {
        const cos = Math.cos(it.angle), sin = Math.sin(it.angle);
        ctx.strokeStyle = '#8d6e63';
        ctx.lineWidth = 2;
        ctx.beginPath(); // horizontal rail
        ctx.moveTo(it.x - cos * it.len/2, it.y - sin * it.len/2);
        ctx.lineTo(it.x + cos * it.len/2, it.y + sin * it.len/2);
        ctx.stroke();
        const posts = 4; // vertical posts
        for (let p = 0; p <= posts; p++) {
          const t = p / posts - 0.5;
          const px = it.x + cos * it.len * t;
          const py = it.y + sin * it.len * t;
          ctx.fillStyle = '#6d4c41';
          ctx.fillRect(px - 1.5, py - 5, 3, 7);
        }
        break;
      }
    }
  }
}

// ─── Paper Texture ──────────────────────────────────────────────
// Generates a canvas-based paper texture and applies it as the UI panel background
function generatePaperTexture() {
  const w = 300, h = 800;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // Base warm paper color
  ctx.fillStyle = '#f4ead4';
  ctx.fillRect(0, 0, w, h);

  // Per-pixel noise for paper grain
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const noise = (Math.random() - 0.5) * 18;
    d[i]     = Math.min(255, Math.max(0, d[i] + noise));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + noise));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + noise - 3));
  }
  ctx.putImageData(id, 0, 0);

  // Warm-toned age stains
  for (let i = 0; i < 12; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 20 + Math.random() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${180 + Math.random()*30}, ${160 + Math.random()*30}, ${110 + Math.random()*30}, ${0.04 + Math.random()*0.06})`);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // Soft horizontal crease marks
  ctx.save();
  for (let i = 0; i < 3; i++) {
    const y1 = 50 + Math.random() * (h - 100);
    const ctrl = Math.random() * 40 - 20;
    ctx.beginPath();
    ctx.moveTo(0, y1);
    ctx.quadraticCurveTo(w / 2, y1 + ctrl, w, y1 + Math.random() * 20 - 10);
    ctx.strokeStyle = `rgba(180, 160, 120, ${0.06 + Math.random() * 0.08})`;
    ctx.lineWidth = 8 + Math.random() * 15;
    ctx.stroke();
  }

  // Visible fold line (dark crease + light highlight)
  const foldY = h * (0.3 + Math.random() * 0.4);
  ctx.beginPath();
  ctx.moveTo(0, foldY - 2);
  ctx.lineTo(w, foldY + 4);
  ctx.strokeStyle = 'rgba(160, 140, 100, 0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, foldY);
  ctx.lineTo(w, foldY + 6);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Faint coffee-ring stains
  for (let i = 0; i < 2; i++) {
    const sx = Math.random() * w;
    const sy = Math.random() * h;
    const sr = 15 + Math.random() * 35;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
    sg.addColorStop(0, `rgba(160, 130, 80, ${0.05 + Math.random() * 0.05})`);
    sg.addColorStop(0.6, `rgba(170, 140, 90, ${0.02 + Math.random() * 0.03})`);
    sg.addColorStop(1, 'transparent');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.ellipse(sx, sy, sr, sr * 0.7, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Tiny dark specks
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(100, 80, 50, ${0.01 + Math.random() * 0.02})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1 + Math.random() * 3);
  }

  // Apply as panel background
  const panel = document.getElementById('panel');
  panel.style.backgroundImage = `url(${c.toDataURL()})`;
  panel.style.backgroundSize = `${w}px ${h}px`;
}

// ─── App ─────────────────────────────────────────────────────────
// Main application controller: handles drawing, simulation, UI, and rendering
class App {
  constructor() {
    this.canvas = document.getElementById('main');
    this.ctx = this.canvas.getContext('2d');
    this.graph = document.getElementById('graph');
    this.gCtx = this.graph.getContext('2d');

    this.mode = 'draw';       // 'draw' or 'sim'
    this.waypoints = [];      // user-placed waypoints during draw mode
    this.hoverClose = false;  // true when mouse is near the first waypoint (to close loop)
    this.track = null;
    this.sim = null;
    this.speed = 5;           // simulation speed multiplier (steps per frame)
    this.popSize = 50;
    this.mutRate = 0.15;
    this.scenery = [];

    this.resize();
    this.grassPattern = this.createGrassPattern();
    window.addEventListener('resize', () => { this.resize(); this.grassPattern = this.createGrassPattern(); });
    this.canvas.addEventListener('click', e => this.onClick(e));
    this.canvas.addEventListener('mousemove', e => this.onMove(e));
    window.addEventListener('keydown', e => this.onKey(e));

    this.loop();
  }

  // Create a tiled grass texture with random bright/dark flecks
  createGrassPattern() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#4a8c3f';
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 120; i++) {
      const bright = Math.random() > 0.5;
      g.fillStyle = bright ? 'rgba(70,150,55,0.25)' : 'rgba(35,75,28,0.18)';
      g.fillRect(Math.random()*64, Math.random()*64, 1+Math.random()*2, 1+Math.random()*2);
    }
    return this.ctx.createPattern(c, 'repeat');
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    this.graph.width = this.graph.clientWidth * dpr;
    this.graph.height = this.graph.clientHeight * dpr;
    this.gCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ─── Draw Mode Input ────────────────────────────────────────────
  onClick(e) {
    if (this.mode !== 'draw') return;
    const p = { x: e.clientX, y: e.clientY };
    // Close the loop if clicking near the first waypoint
    if (this.waypoints.length >= 3 && dist(p, this.waypoints[0]) < 30) {
      this.finishTrack();
      return;
    }
    this.waypoints.push(p);
  }

  onMove(e) {
    if (this.mode !== 'draw') return;
    const p = { x: e.clientX, y: e.clientY };
    this.hoverClose = this.waypoints.length >= 3 && dist(p, this.waypoints[0]) < 30;
    this.mousePos = p;
  }

  onKey(e) {
    if (e.code === 'Space' && this.mode === 'sim') {
      this.paused = !this.paused;
      e.preventDefault();
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && this.mode === 'draw') {
      e.preventDefault();
      this.undoLast();
    }
  }

  undoLast() {
    if (this.waypoints.length > 0) {
      this.waypoints.pop();
      this.hoverClose = false;
    }
  }

  clearTrack() {
    this.waypoints = [];
    this.hoverClose = false;
  }

  // Load a preset track by index and start simulation
  loadPreset(index) {
    const preset = trackPresets[index];
    if (!preset) return;
    this.waypoints = presetToWaypoints(preset, this.canvas.width, this.canvas.height);
    this.finishTrack();
  }

  // Build track from waypoints, validate, and start simulation
  finishTrack() {
    if (this.waypoints.length < 3) return;
    const candidate = new Track(this.waypoints);
    if (!candidate.valid) {
      this.showWarning('Road is too narrow for a car to fit. Spread your waypoints out more.');
      return;
    }
    this.track = candidate;
    this.scenery = generateScenery(this.track, this.canvas.width, this.canvas.height);
    this.sim = new Simulation(this.track, this.popSize, this.mutRate);
    this.mode = 'sim';
    this.paused = false;
    document.getElementById('draw-ui').classList.add('hidden');
    document.getElementById('sim-ui').classList.remove('hidden');
    document.getElementById('instructions').classList.add('hidden');
    this.resizeGraph();
    this.syncSliders();
  }

  // Force all range sliders to re-sync their thumb position.
  // Needed because sliders inside display:none elements don't lay out correctly.
  syncSliders() {
    for (const el of document.querySelectorAll('#sim-ui input[type=range]')) {
      const v = el.value;
      el.value = '';
      el.value = v;
    }
  }

  // Size the graph canvas correctly (must be called when sim-ui is visible)
  resizeGraph() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.graph.clientWidth;
    const h = this.graph.clientHeight;
    if (w > 0 && h > 0) {
      this.graph.width = w * dpr;
      this.graph.height = h * dpr;
      this.gCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  showWarning(msg) {
    let el = document.getElementById('track-warning');
    if (!el) {
      el = document.createElement('div');
      el.id = 'track-warning';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(this._warnTimer);
    this._warnTimer = setTimeout(() => el.classList.remove('visible'), 3000);
  }

  // Return to draw mode, clear everything
  newTrack() {
    this.mode = 'draw';
    this.waypoints = [];
    this.track = null;
    this.sim = null;
    this.scenery = [];
    document.getElementById('draw-ui').classList.remove('hidden');
    document.getElementById('sim-ui').classList.add('hidden');
    document.getElementById('instructions').classList.remove('hidden');
    renderPresetButtons();
  }

  // Restart the AI with fresh brains on the same track
  resetAI() {
    if (!this.track) return;
    this.sim = new Simulation(this.track, this.popSize, this.mutRate);
  }

  // ─── Settings (called by UI sliders/selects) ───────────────────
  setSpeed(v) { this.speed = v; }
  setMutation(v) {
    this.mutRate = v / 100;
    if (this.sim) this.sim.mutRate = this.mutRate;
  }
  setPopulation(v) { this.popSize = v; } // takes effect on next resetAI()
  setMaxSpeed(v) { carConfig.maxSpeed = v; }   // immediate
  setMinSpeed(v) { carConfig.minSpeed = v; }   // immediate
  setTurnRate(v) { carConfig.turnRate = v; }   // immediate
  setMaxTicks(v) { if (this.sim) this.sim.maxTicks = v; } // immediate

  // Copy current track waypoints to clipboard as tracks.json-compatible JSON
  exportTrack() {
    const wp = this.track ? this.track.waypoints : this.waypoints;
    if (!wp || !wp.length) return;
    const cx = this.canvas.width / 2, cy = this.canvas.height / 2;
    const offsets = wp.map(p => [Math.round(p.x - cx), Math.round(p.y - cy)]);
    const entry = { name: 'My Track', color: 'go', offsets };
    const json = JSON.stringify(entry, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      this.showWarning('Track copied to clipboard! Paste it into your TRACKS file.');
    }).catch(() => {
      console.log(json);
      this.showWarning('Check the browser console for the track JSON.');
    });
  }

  // ─── Main Loop ─────────────────────────────────────────────────
  // Runs every animation frame: step simulation, then render
  loop() {
    if (this.mode === 'sim' && !this.paused && this.sim) {
      for (let i = 0; i < this.speed; i++) this.sim.step();
      this.updateUI();
    }
    this.render();
    requestAnimationFrame(() => this.loop());
  }

  // Refresh the stats panel, graph, and gen log
  updateUI() {
    document.getElementById('gen').textContent = this.sim.generation;
    document.getElementById('alive').textContent = this.sim.aliveCount();
    document.getElementById('bestGen').textContent = this.sim.currentBestFitness().toFixed(1);
    document.getElementById('bestAll').textContent = this.sim.bestFitnessAll.toFixed(1);
    this.drawGraph();
    this.updateGenLog();
  }

  // Draw the fitness-per-generation line chart
  drawGraph() {
    const c = this.gCtx;
    const w = this.graph.clientWidth, h = this.graph.clientHeight;
    c.clearRect(0, 0, w, h);
    const hist = this.sim.fitnessHistory;
    if (hist.length < 2) return;
    const maxVal = Math.max(...hist) || 1;
    // Show last 80 generations max
    const startI = Math.max(0, hist.length - 80);
    const slice = hist.slice(startI);

    c.strokeStyle = '#a67c52';
    c.lineWidth = 1.5;
    c.beginPath();
    slice.forEach((v, i) => {
      const x = (i / (slice.length - 1)) * w;
      const y = h - 3 - (v / maxVal) * (h - 6);
      i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
    });
    c.stroke();

    // Fill area under the line with a gradient
    const grad = c.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(166,124,82,0.2)');
    grad.addColorStop(1, 'rgba(166,124,82,0)');
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.closePath();
    c.fillStyle = grad;
    c.fill();
  }

  // Populate the generation log table (newest first)
  updateGenLog() {
    const body = document.getElementById('gen-log-body');
    if (!body) return;
    const log = this.sim.genLog;
    if (body.childElementCount === log.length) return; // no new entries
    body.innerHTML = '';
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      const row = document.createElement('div');
      row.className = 'log-row';
      row.innerHTML =
        `<span>${e.gen}</span>` +
        `<span>${e.fitness.toFixed(1)}</span>` +
        `<span>${e.ticks}</span>` +
        `<span class="laps">${e.dist}%</span>`;
      body.appendChild(row);
    }
  }

  // ─── Rendering ─────────────────────────────────────────────────
  render() {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;

    // Background: tiled grass pattern
    ctx.fillStyle = this.grassPattern || '#4a8c3f';
    ctx.fillRect(0, 0, W, H);

    if (this.mode === 'draw') {
      this.renderDrawMode(ctx);
    } else {
      this.renderSimMode(ctx);
    }
  }

  // Draw mode: show waypoints, preview track outline, hover indicator
  renderDrawMode(ctx) {
    const wps = this.waypoints;
    if (wps.length === 0) return;

    // Preview the track if we have enough waypoints
    if (wps.length >= 3) {
      try {
        const preview = new Track(wps);
        this.renderRoad(ctx, preview, 0.4);
        // Red dashed outline if track is invalid (too narrow)
        if (!preview.valid) {
          ctx.save();
          ctx.strokeStyle = 'rgba(231,76,60,0.6)';
          ctx.lineWidth = 5;
          ctx.setLineDash([8, 6]);
          ctx.beginPath();
          preview.left.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
          ctx.closePath();
          ctx.stroke();
          ctx.beginPath();
          preview.right.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
          ctx.closePath();
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      } catch(e) {}
    }

    // Dashed line connecting waypoints + mouse cursor
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    wps.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    if (this.mousePos && !this.hoverClose) ctx.lineTo(this.mousePos.x, this.mousePos.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Waypoint dots (first one is larger, turns green when hoverable)
    wps.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === 0 ? 10 : 6, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? (this.hoverClose ? '#4ade80' : '#fff') : '#fff';
      ctx.fill();
      ctx.strokeStyle = '#2e7d32';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Green ring around first waypoint when close enough to close the loop
    if (this.hoverClose) {
      ctx.beginPath();
      ctx.arc(wps[0].x, wps[0].y, 20, 0, Math.PI * 2);
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  // Draw road surface with walls, center dashes, and edge lines
  renderRoad(ctx, track, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;

    // Road fill (gray asphalt between left and right edges)
    ctx.beginPath();
    track.left.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    const rightReversed = [...track.right].reverse();
    ctx.moveTo(rightReversed[0].x, rightReversed[0].y);
    rightReversed.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fillStyle = '#6b6b6b';
    ctx.fill('evenodd');
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha + 0.2);

    // White edge lines
    ctx.beginPath();
    track.left.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    track.right.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();

    // Dashed center line
    ctx.setLineDash([14, 10]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    track.center.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  }

  // Sim mode: draw scenery, road, start/finish line, all cars
  renderSimMode(ctx) {
    drawScenery(ctx, this.scenery);

    this.renderRoad(ctx, this.track, 1);

    // Checkerboard start/finish line
    const startCp = this.track.checkpoints[0];
    const dx = startCp.right.x - startCp.left.x;
    const dy = startCp.right.y - startCp.left.y;
    const len = Math.hypot(dx, dy);
    const blocks = 8;
    for (let b = 0; b < blocks; b++) {
      const t1 = b / blocks, t2 = (b + 1) / blocks;
      const p1 = lerp(startCp.left, startCp.right, t1);
      const p2 = lerp(startCp.left, startCp.right, t2);
      ctx.fillStyle = b % 2 === 0 ? '#fff' : '#222';
      const nx = -dy / len * 4, ny = dx / len * 4;
      ctx.beginPath();
      ctx.moveTo(p1.x - nx, p1.y - ny);
      ctx.lineTo(p2.x - nx, p2.y - ny);
      ctx.lineTo(p2.x + nx, p2.y + ny);
      ctx.lineTo(p1.x + nx, p1.y + ny);
      ctx.closePath();
      ctx.fill();
    }

    if (!this.sim) return;

    // Draw all cars, best car last (on top)
    const best = this.sim.bestCar();

    for (const car of this.sim.cars) {
      if (car === best) continue;
      this.renderCar(ctx, car, false);
    }
    if (best) this.renderCar(ctx, best, true);
  }

  // Draw a single car: body, sensors (best only), windshield details
  renderCar(ctx, car, isBest) {
    const corners = car.getCorners();

    // Dead cars are semi-transparent
    if (!car.alive && !isBest) {
      ctx.globalAlpha = 0.5;
    }

    // Best car gets sensor ray visualization
    if (car.alive && isBest) {
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < SENSOR_COUNT; i++) {
        const hit = car.sensorPts[i];
        if (!hit) continue;
        ctx.strokeStyle = car.sensors[i] < 0.2 ? '#e74c3c' : '#fff'; // red if close to wall
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(car.x, car.y);
        ctx.lineTo(hit.x, hit.y);
        ctx.stroke();
        ctx.fillStyle = car.sensors[i] < 0.2 ? '#e74c3c' : '#fff';
        ctx.beginPath();
        ctx.arc(hit.x, hit.y, 2.5, 0, Math.PI * 2); // hit point dot
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Car body shape
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();

    // Color: brown=dead, yellow+glow=best, red=alive
    if (!car.alive) {
      ctx.fillStyle = '#8d6e63';
    } else if (isBest) {
      ctx.fillStyle = '#f1c40f';
      ctx.shadowColor = '#f39c12';
      ctx.shadowBlur = 10;
    } else {
      ctx.fillStyle = '#e74c3c';
    }
    ctx.fill();
    ctx.shadowBlur = 0;

    // Outline for alive cars
    if (car.alive) {
      ctx.strokeStyle = isBest ? '#f39c12' : '#c0392b';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Windshield dots on the best car
    if (car.alive && isBest) {
      const cos = Math.cos(car.angle), sin = Math.sin(car.angle);
      ctx.fillStyle = '#81d4fa';
      const wx = CAR_L * 0.2, wy = CAR_W * 0.35;
      ctx.beginPath();
      ctx.arc(car.x + cos * CAR_L * 0.2 - sin * wy, car.y + sin * CAR_L * 0.2 + cos * wy, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(car.x + cos * CAR_L * 0.2 + sin * wy, car.y + sin * CAR_L * 0.2 - cos * wy, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }
}

// ─── Panel drag & minimize ──────────────────────────────────────
// Make the panel draggable by its header bar
(function() {
  const panel = document.getElementById('panel');
  const header = document.getElementById('panel-header');
  let dragging = false, ox = 0, oy = 0;

  header.addEventListener('mousedown', e => {
    if (e.target.id === 'info-btn' || e.target.id === 'minimize-btn') return;
    dragging = true;
    ox = e.clientX - panel.offsetLeft;
    oy = e.clientY - panel.offsetTop;
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    panel.style.left = Math.max(0, e.clientX - ox) + 'px';
    panel.style.top = Math.max(0, e.clientY - oy) + 'px';
  });
  window.addEventListener('mouseup', () => { dragging = false; });
})();

// Toggle panel between full and minimized (stats only) view
let panelMinimized = false;
function togglePanel() {
  panelMinimized = !panelMinimized;
  const details = document.getElementById('panel-details');
  const drawUI = document.getElementById('draw-ui');
  const btn = document.getElementById('minimize-btn');
  const infoTip = document.getElementById('info-tip');
  if (panelMinimized) {
    if (details) details.style.display = 'none';
    if (drawUI) drawUI.style.display = 'none';
    infoTip.classList.add('hidden');
    btn.innerHTML = '+';
  } else {
    if (details) details.style.display = '';
    if (drawUI) drawUI.style.display = '';
    btn.innerHTML = '&#x2212;';
  }
}

// ─── Config & Title ─────────────────────────────────────────────
// Colors cycled per letter for the big splash title
const TITLE_COLORS = ['#e74c3c','#f39c12','#2ecc71','#3498db','#9b59b6','#e91e63','#00bcd4','#ff5722'];

// Load config.json (name, subtitle) with fallback defaults
async function loadConfig() {
  const fallback = { name: 'Tracks', subtitle: 'AI learns to drive' };
  try {
    const resp = await fetch('config.json');
    if (!resp.ok) return fallback;
    const data = await resp.json();
    return { ...fallback, ...data };
  } catch (_) { return fallback; }
}

// Apply config to all UI elements: page title, splash title, panel header
function applyConfig(cfg) {
  document.title = cfg.name;

  // Big colorful splash title: each letter gets a different color + random tilt
  const titleEl = document.getElementById('big-title');
  if (titleEl) {
    titleEl.innerHTML = '';
    [...cfg.name].forEach((ch, i) => {
      const span = document.createElement('span');
      span.textContent = ch;
      span.style.color = TITLE_COLORS[i % TITLE_COLORS.length];
      const rot = (Math.random() - 0.5) * 12;
      span.style.transform = `rotate(${rot}deg)`;
      titleEl.appendChild(span);
    });
  }

  const subtitleEl = document.getElementById('big-subtitle');
  if (subtitleEl) subtitleEl.textContent = cfg.subtitle;

  const panelTitle = document.getElementById('panel-title');
  if (panelTitle) panelTitle.textContent = cfg.name;
}

// ─── Init ───────────────────────────────────────────────────────
loadTracksFile().then(() => renderPresetButtons());
renderPresetButtons();        // show built-in presets immediately
generatePaperTexture();       // generate panel background
loadConfig().then(applyConfig); // load and apply config.json
const app = new App();        // start the app
