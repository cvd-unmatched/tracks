import { dist } from './utils.js';

const HOUSE_COLORS = ['#e74c3c','#3498db','#f1c40f','#e67e22','#9b59b6','#1abc9c','#fff'];
const ROOF_COLORS  = ['#c0392b','#8d4925','#6b4226','#b53d1e','#7b3f6e'];

export function generateScenery(track, W, H) {
  const items = [];
  const rng = (lo, hi) => lo + Math.random() * (hi - lo);
  const attempts = 120;

  for (let a = 0; a < attempts; a++) {
    const x = rng(30, W - 30);
    const y = rng(30, H - 30);
    let tooClose = false;
    for (let i = 0; i < track.center.length; i += 4) {
      if (dist({x, y}, track.center[i]) < track.halfWidth + 36) { tooClose = true; break; }
    }
    if (tooClose) continue;

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

export function drawScenery(ctx, items) {
  for (const it of items) {
    switch (it.type) {
      case 'tree': {
        ctx.fillStyle = '#5d4037';
        ctx.fillRect(it.x - 2, it.y + 2, 4, it.size);
        ctx.fillStyle = '#2e7d32';
        ctx.beginPath();
        ctx.arc(it.x, it.y - 1, it.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1b5e20';
        ctx.beginPath();
        ctx.arc(it.x - 2, it.y + 1, it.size * 0.55, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'house': {
        ctx.fillStyle = it.color;
        ctx.fillRect(it.x - it.w/2, it.y - it.h/2, it.w, it.h);
        ctx.strokeStyle = '#5d4037';
        ctx.lineWidth = 1;
        ctx.strokeRect(it.x - it.w/2, it.y - it.h/2, it.w, it.h);
        ctx.fillStyle = it.roof;
        ctx.beginPath();
        ctx.moveTo(it.x - it.w/2 - 4, it.y - it.h/2);
        ctx.lineTo(it.x, it.y - it.h/2 - 14);
        ctx.lineTo(it.x + it.w/2 + 4, it.y - it.h/2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#5d4037';
        ctx.fillRect(it.x - 3, it.y - it.h/2 + it.h * 0.35, 6, it.h * 0.65);
        ctx.fillStyle = '#bbdefb';
        ctx.fillRect(it.x + it.w * 0.15, it.y - it.h/2 + 4, 6, 5);
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
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.ellipse(it.x - it.rx * 0.2, it.y - it.ry * 0.2, it.rx * 0.4, it.ry * 0.3, -0.3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'fence': {
        const cos = Math.cos(it.angle), sin = Math.sin(it.angle);
        ctx.strokeStyle = '#8d6e63';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(it.x - cos * it.len/2, it.y - sin * it.len/2);
        ctx.lineTo(it.x + cos * it.len/2, it.y + sin * it.len/2);
        ctx.stroke();
        const posts = 4;
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
