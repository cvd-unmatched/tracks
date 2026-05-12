const BUILTIN_PRESETS = [
  { name:'Oval', color:'go', type:'circle', count:16, rx:0.34, ry:0.32 },
  { name:'Complex', color:'t-blue', offsets:[[-280,60],[-240,-80],[-120,-160],[40,-180],[180,-120],[280,-40],[300,80],[220,180],[80,160],[-60,200],[-180,180],[-300,140]] },
  { name:'Figure 8', color:'t-orange', offsets:[[-260,-20],[-120,-180],[100,-200],[260,-80],[60,60],[-60,-60],[-260,80],[-100,200],[120,180],[260,20]] },
];

export let trackPresets = [...BUILTIN_PRESETS];

// Try to load presets from tracks.json, fall back to built-ins
export async function loadTracksFile() {
  try {
    const resp = await fetch('tracks.json');
    if (!resp.ok) return;
    const data = await resp.json();
    if (Array.isArray(data) && data.length) trackPresets = data;
  } catch (_) {}
}

// Convert a preset definition into absolute waypoint coordinates.
// Auto-scales offsets to fit the current viewport with a 60px margin.
export function presetToWaypoints(preset, w, h) {
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

// Dynamically create preset buttons in the draw-mode panel.
// Uses late-bound window.app so it works even when called before app is created.
export function renderPresetButtons() {
  const container = document.getElementById('preset-btns');
  if (!container) return;
  const colors = ['go','t-blue','t-orange','go','t-blue','t-orange'];
  container.innerHTML = '';
  trackPresets.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.className = p.color || colors[i % colors.length];
    btn.textContent = p.name;
    btn.onclick = () => window.app.loadPreset(i);
    container.appendChild(btn);
  });
}
