import { dist, lerp } from './utils.js';
import { SENSOR_COUNT, CAR_L, CAR_W, carConfig } from './constants.js';
import { Track } from './track.js';
import { Simulation } from './simulation.js';
import { trackPresets, loadTracksFile, presetToWaypoints, renderPresetButtons } from './presets.js';
import { generateScenery, drawScenery } from './scenery.js';
import { generatePaperTexture, initPanelDrag, togglePanel, loadConfig, applyConfig } from './ui.js';

// Main application controller: handles drawing, simulation, UI, and rendering
class App {
  constructor() {
    this.canvas = document.getElementById('main');
    this.ctx = this.canvas.getContext('2d');
    this.graph = document.getElementById('graph');
    this.gCtx = this.graph.getContext('2d');

    this.mode = 'draw';
    this.waypoints = [];
    this.hoverClose = false;
    this.track = null;
    this.sim = null;
    this.speed = 5;
    this.popSize = 50;
    this.mutRate = 0.15;
    this.scenery = [];

    this.dragIdx = -1;

    this.resize();
    this.grassPattern = this.createGrassPattern();
    window.addEventListener('resize', () => { this.resize(); this.grassPattern = this.createGrassPattern(); });
    this.canvas.addEventListener('mousedown', e => this.onMouseDown(e));
    this.canvas.addEventListener('mouseup', e => this.onMouseUp(e));
    this.canvas.addEventListener('mousemove', e => this.onMove(e));
    window.addEventListener('keydown', e => this.onKey(e));

    this.loop();
  }

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
  onMouseDown(e) {
    if (this.mode !== 'draw') return;
    const p = { x: e.clientX, y: e.clientY };

    // Ctrl+click near a waypoint starts dragging it
    if (e.ctrlKey || e.metaKey) {
      for (let i = 0; i < this.waypoints.length; i++) {
        if (dist(p, this.waypoints[i]) < 20) {
          this.dragIdx = i;
          this.canvas.style.cursor = 'grabbing';
          e.preventDefault();
          return;
        }
      }
      return;
    }
  }

  onMouseUp(e) {
    if (this.dragIdx >= 0) {
      this.dragIdx = -1;
      this.canvas.style.cursor = '';
      return;
    }

    // Normal click: place waypoint or close loop
    if (this.mode !== 'draw') return;
    const p = { x: e.clientX, y: e.clientY };
    if (this.waypoints.length >= 3 && dist(p, this.waypoints[0]) < 30) {
      this.finishTrack();
      return;
    }
    this.waypoints.push(p);
  }

  onMove(e) {
    if (this.mode !== 'draw') return;
    const p = { x: e.clientX, y: e.clientY };

    // Dragging a waypoint
    if (this.dragIdx >= 0) {
      this.waypoints[this.dragIdx] = p;
      return;
    }

    this.hoverClose = this.waypoints.length >= 3 && dist(p, this.waypoints[0]) < 30;
    this.mousePos = p;

    // Show grab cursor when Ctrl-hovering near a waypoint
    if (e.ctrlKey || e.metaKey) {
      let nearWP = false;
      for (const wp of this.waypoints) {
        if (dist(p, wp) < 20) { nearWP = true; break; }
      }
      this.canvas.style.cursor = nearWP ? 'grab' : '';
    } else {
      this.canvas.style.cursor = '';
    }
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

  loadPreset(index) {
    const preset = trackPresets[index];
    if (!preset) return;
    this.waypoints = presetToWaypoints(preset, this.canvas.width, this.canvas.height);
    this.finishTrack();
  }

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
  // Deferred to next frame so the browser has reflowed the now-visible container.
  syncSliders() {
    requestAnimationFrame(() => {
      for (const el of document.querySelectorAll('#sim-ui input[type=range]')) {
        const v = el.value;
        el.value = el.min;
        el.value = v;
      }
    });
  }

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
  setPopulation(v) { this.popSize = v; }
  setMaxSpeed(v) { carConfig.maxSpeed = v; }
  setMinSpeed(v) { carConfig.minSpeed = v; }
  setTurnRate(v) { carConfig.turnRate = v; }
  setMaxTicks(v) { if (this.sim) this.sim.maxTicks = v; }

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
  loop() {
    if (this.mode === 'sim' && !this.paused && this.sim) {
      const genBefore = this.sim.generation;
      for (let i = 0; i < this.speed; i++) {
        this.sim.step();
        // Cap at 3 evolutions per frame to prevent freezes on degenerate tracks
        if (this.sim.generation - genBefore >= 3) break;
      }
      this.updateUI();
    }
    this.render();
    requestAnimationFrame(() => this.loop());
  }

  updateUI() {
    document.getElementById('gen').textContent = this.sim.generation;
    document.getElementById('alive').textContent = this.sim.aliveCount();
    document.getElementById('bestGen').textContent = this.sim.currentBestFitness().toFixed(1);
    document.getElementById('bestAll').textContent = this.sim.bestFitnessAll.toFixed(1);
    this.drawGraph();
    this.updateGenLog();
  }

  drawGraph() {
    const c = this.gCtx;
    const w = this.graph.clientWidth, h = this.graph.clientHeight;
    c.clearRect(0, 0, w, h);
    const hist = this.sim.fitnessHistory;
    if (hist.length < 2) return;
    const maxVal = Math.max(...hist) || 1;
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

    const grad = c.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(166,124,82,0.2)');
    grad.addColorStop(1, 'rgba(166,124,82,0)');
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.closePath();
    c.fillStyle = grad;
    c.fill();
  }

  updateGenLog() {
    const body = document.getElementById('gen-log-body');
    if (!body) return;
    const log = this.sim.genLog;
    if (body.childElementCount === Math.min(log.length, 50)) return;
    body.innerHTML = '';
    const start = Math.max(0, log.length - 50);
    for (let i = log.length - 1; i >= start; i--) {
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

    ctx.fillStyle = this.grassPattern || '#4a8c3f';
    ctx.fillRect(0, 0, W, H);

    if (this.mode === 'draw') {
      this.renderDrawMode(ctx);
    } else {
      this.renderSimMode(ctx);
    }
  }

  renderDrawMode(ctx) {
    const wps = this.waypoints;
    if (wps.length === 0) return;

    let badWPs = new Set();
    if (wps.length >= 3) {
      try {
        const preview = new Track(wps);
        this.renderRoad(ctx, preview, 0.4);
        if (!preview.valid) {
          badWPs = preview.badWaypoints;
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

    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    wps.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    if (this.mousePos && !this.hoverClose && this.dragIdx < 0) ctx.lineTo(this.mousePos.x, this.mousePos.y);
    ctx.stroke();
    ctx.setLineDash([]);

    wps.forEach((p, i) => {
      const isBad = badWPs.has(i);
      const isFirst = i === 0;
      const r = isFirst ? 10 : (isBad ? 8 : 6);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      if (isBad) {
        ctx.fillStyle = '#e74c3c';
      } else if (isFirst) {
        ctx.fillStyle = this.hoverClose ? '#4ade80' : '#fff';
      } else {
        ctx.fillStyle = '#fff';
      }
      ctx.fill();
      ctx.strokeStyle = isBad ? '#c0392b' : '#2e7d32';
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    if (this.hoverClose) {
      ctx.beginPath();
      ctx.arc(wps[0].x, wps[0].y, 20, 0, Math.PI * 2);
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  renderRoad(ctx, track, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;

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

    const best = this.sim.bestCar();
    for (const car of this.sim.cars) {
      if (car === best) continue;
      this.renderCar(ctx, car, false);
    }
    if (best) this.renderCar(ctx, best, true);
  }

  renderCar(ctx, car, isBest) {
    const corners = car.getCorners();

    if (!car.alive && !isBest) {
      ctx.globalAlpha = 0.5;
    }

    if (car.alive && isBest) {
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < SENSOR_COUNT; i++) {
        const hit = car.sensorPts[i];
        if (!hit) continue;
        ctx.strokeStyle = car.sensors[i] < 0.2 ? '#e74c3c' : '#fff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(car.x, car.y);
        ctx.lineTo(hit.x, hit.y);
        ctx.stroke();
        ctx.fillStyle = car.sensors[i] < 0.2 ? '#e74c3c' : '#fff';
        ctx.beginPath();
        ctx.arc(hit.x, hit.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();

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

    if (car.alive) {
      ctx.strokeStyle = isBest ? '#f39c12' : '#c0392b';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (car.alive && isBest) {
      const cos = Math.cos(car.angle), sin = Math.sin(car.angle);
      ctx.fillStyle = '#81d4fa';
      const wy = CAR_W * 0.35;
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

// ─── Init ───────────────────────────────────────────────────────
loadTracksFile().then(() => renderPresetButtons());
renderPresetButtons();
generatePaperTexture();
initPanelDrag();
loadConfig().then(applyConfig);

const app = new App();

// Expose globals needed by inline HTML event handlers
window.app = app;
window.togglePanel = togglePanel;
