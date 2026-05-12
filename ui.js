// Generates a canvas-based paper texture and applies it as the UI panel background
export function generatePaperTexture() {
  const w = 300, h = 800;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');

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

  // Visible fold line
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

  const panel = document.getElementById('panel');
  panel.style.backgroundImage = `url(${c.toDataURL()})`;
  panel.style.backgroundSize = `${w}px ${h}px`;
}

// Make the panel draggable by its header bar
export function initPanelDrag() {
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
}

// Toggle panel between full and minimized (stats only) view
let panelMinimized = false;
export function togglePanel() {
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

// Colors cycled per letter for the big splash title
const TITLE_COLORS = ['#e74c3c','#f39c12','#2ecc71','#3498db','#9b59b6','#e91e63','#00bcd4','#ff5722'];

// Load config.json (name, subtitle) with fallback defaults
export async function loadConfig() {
  const fallback = { name: 'Tracks', subtitle: 'AI learns to drive' };
  try {
    const resp = await fetch('config.json');
    if (!resp.ok) return fallback;
    const data = await resp.json();
    return { ...fallback, ...data };
  } catch (_) { return fallback; }
}

// Apply config to all UI elements: page title, splash title, panel header
export function applyConfig(cfg) {
  document.title = cfg.name;

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

  const authorEl = document.getElementById('author');
  if (authorEl && cfg.author) authorEl.textContent = cfg.author;
}
