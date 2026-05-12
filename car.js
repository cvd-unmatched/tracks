import { dist, clamp, segIntersect } from './utils.js';
import { NeuralNet } from './nn.js';
import {
  CAR_L, CAR_W, SENSOR_COUNT, SENSOR_ANGLES, SENSOR_RANGE,
  ACCEL, NN_TOPOLOGY, STALE_LIMIT, carConfig
} from './constants.js';

export class Car {
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
    this.nextCP = 0;
    this.cpPassed = 0;
    this.staleTicks = 0;
    this.ticks = 0;
    this.sensors = new Array(SENSOR_COUNT).fill(1);
    this.sensorPts = [];
    this.nearbyWalls = null;
  }

  // Map current progress to a centerline index (for wall proximity filtering)
  getTrackIdx() {
    if (this.cpPassed === 0) return 0;
    const numCP = this.track.checkpoints.length;
    const prevCP = (this.nextCP - 1 + numCP) % numCP;
    return this.track.checkpoints[prevCP].centerIdx;
  }

  refreshWalls() {
    this.nearbyWalls = this.track.getWallsNear(this.getTrackIdx());
  }

  // One physics tick: sense -> think -> move -> collide -> score
  update() {
    if (!this.alive) return;
    this.ticks++;
    this.staleTicks++;
    if (this.staleTicks > STALE_LIMIT) { this.alive = false; return; }

    if (!this.nearbyWalls || this.ticks % 4 === 1) this.refreshWalls();

    this.castSensors();
    const inputs = [...this.sensors, this.speed / carConfig.maxSpeed];
    const [steer, accel] = this.brain.predict(inputs);

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
      this.sensors[i] = minT;
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
      this.staleTicks = 0;
      this.nextCP = (this.nextCP + 1) % this.track.checkpoints.length;
      this.refreshWalls();
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
