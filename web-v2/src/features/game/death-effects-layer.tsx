import { useEffect, useRef } from 'react';
import { DEATH_ART_REGIONS, DEATH_ART_SHEET, DEATH_EFFECT_MS, makeParticles, particleCount } from '../../presentation/death-effects.ts';
import type { DeathBurst, DeathParticle } from '../../presentation/death-effects.ts';

/** Reuse the unchanged reference atlas, just as the default avatar does. No role information.
   暗色主题换用亮度键控派生图（death-mark-dark.png，普通混合）——白底原图的 multiply 在暗底上隐形。 */
export function DeathMark() {
  return <span className="seat-death-mark" aria-hidden="true">
    <svg viewBox="48 110 490 675" focusable="false"><image href="/assets/avatar-sheet.png" width="1774" height="887" /></svg>
    <img className="seat-death-mark__dark" src="/assets/death-mark-dark.png" alt="" />
  </span>;
}

type Region = readonly [number, number, number, number];

function drawRegion(ctx: CanvasRenderingContext2D, sheet: HTMLImageElement, region: Region, x: number, y: number, width: number, rotate: number, alpha: number) {
  if (alpha <= 0 || width <= 0) return;
  const height = width * region[3] / region[2];
  ctx.save();
  // Each baked-white layer must blend with earlier art before the whole canvas blends with the stage.
  // Keep this inside save/restore so the procedural fallback retains its source-over rendering.
  ctx.globalCompositeOperation = 'multiply';
  ctx.translate(x, y);
  if (rotate) ctx.rotate(rotate);
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(sheet, region[0], region[1], region[2], region[3], -width / 2, -height / 2, width, height);
  ctx.restore();
}

/** 四相位绘制合图分层：主星芒闪现 → 碎片四散 → 黑雾漂移上升 → 座位下方消散拖尾。
   画布整体走 mix-blend-mode: multiply（见 .death-particles[data-art]），白底烘焙近似不可见。 */
function drawArtBurst(ctx: CanvasRenderingContext2D, sheet: HTMLImageElement, x: number, y: number, radius: number, age: number, variant: boolean) {
  const diameter = radius * 2, dir = variant ? 1 : -1;
  if (age < .9) { // 相位1：主星芒从座位中心放大闪现
    const p = age / .9;
    drawRegion(ctx, sheet, DEATH_ART_REGIONS.main, x, y, diameter * (1.05 + .55 * Math.min(1, age / .3)), 0,
      Math.min(1, age * 9) * (p < .55 ? 1 : 1 - (p - .55) / .45) * .96);
  }
  if (age >= .15 && age < 2.2) { // 相位2：碎片环双份旋转外扩
    const p = (age - .15) / 2.05;
    const alpha = Math.min(1, p * 7) * Math.pow(1 - p, 1.1);
    for (let i = 0; i < 2; i++) {
      drawRegion(ctx, sheet, DEATH_ART_REGIONS.shards, x, y, diameter * (.55 + p * 1.5) * (1 - i * .24),
        dir * (p * (.9 + i * .35) + i * 1.9), alpha * (i ? .55 : .95));
    }
  }
  if (age >= .4 && age < 2.6) { // 相位3：黑雾双份漂移上升
    const p = (age - .4) / 2.2;
    const alpha = Math.min(1, p * 5) * Math.pow(1 - p, .95) * .8;
    for (let i = 0; i < 2; i++) {
      drawRegion(ctx, sheet, DEATH_ART_REGIONS.particles, x + dir * i * radius * .3, y - radius * (.15 + p * 1.35 + i * .3),
        diameter * (1.15 + p * .5) * (1 - i * .18), 0, alpha * (i ? .5 : 1));
    }
  }
  if (age >= 1) { // 相位4：消散拖尾在座位下方淡出
    const p = (age - 1) / (DEATH_EFFECT_MS / 1000 - 1);
    drawRegion(ctx, sheet, DEATH_ART_REGIONS.fade, x, y + radius * 1.05, diameter * 1.35 * (1 + p * .3), 0,
      Math.min(1, p * 4) * (1 - p) * .85);
  }
}

/** 程序绘制兜底：合图加载失败（或尚未加载完成）时保持原有红黑烟雾 + 碎片多边形。 */
function drawProceduralBurst(ctx: CanvasRenderingContext2D, particles: readonly DeathParticle[], x: number, y: number, radius: number, age: number) {
  // Smoke expands once, then dissipates. No full-screen flash or perpetual emitter.
  for (const particle of particles.slice(0, 8)) {
    const a = age - particle.delay;
    if (a < 0 || a > 2.6) continue;
    const travel = radius * (.3 + a * 1.35);
    const px = x + Math.cos(particle.angle) * travel, py = y + Math.sin(particle.angle) * travel * .6 - a * 16;
    const size = radius * (.65 + a * .35);
    const alpha = Math.min(1, a * 8) * Math.max(0, 1 - a / 2.6) * .23;
    const mist = ctx.createRadialGradient(px, py, 0, px, py, size);
    mist.addColorStop(0, `rgba(55,25,36,${alpha})`);
    mist.addColorStop(.5, `rgba(110,35,47,${alpha * .5})`);
    mist.addColorStop(1, 'rgba(55,25,36,0)');
    ctx.fillStyle = mist; ctx.fillRect(px - size, py - size, size * 2, size * 2);
  }
  for (const particle of particles) {
    const a = age - particle.delay;
    if (a < 0 || a >= particle.life) continue;
    const distance = (1 - Math.exp(-a * 1.3)) * particle.speed;
    ctx.save();
    ctx.translate(x + Math.cos(particle.angle) * (radius * .3 + distance), y + Math.sin(particle.angle) * distance * .8 - a * 16);
    ctx.rotate(particle.rotation + a * particle.spin);
    ctx.globalAlpha = Math.min(1, a * 12) * Math.pow(1 - a / particle.life, .65);
    ctx.fillStyle = particle.red ? '#8b2733' : '#382a36';
    const s = particle.size;
    ctx.beginPath(); ctx.moveTo(-s * .7, 0); ctx.lineTo(0, -s * 1.9); ctx.lineTo(s * .75, s * .3); ctx.lineTo(-s * .25, s * 1.45); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

export function DeathEffectsLayer({ stage, bursts }: { stage: HTMLElement; bursts: readonly DeathBurst[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // 合图单次加载；onload 后才绘制分层素材，加载失败静默留在程序绘制兜底。
  const sheetRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const image = new Image();
    image.onload = () => { sheetRef.current = image; };
    image.src = DEATH_ART_SHEET;
    return () => { image.onload = null; };
  }, []);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let frame = 0, stopped = false, artMode = false;
    let width = 0, height = 0, count = -1;
    let particles = bursts.map(() => makeParticles(0, 0));
    const anchors = new Map<number, HTMLElement>();
    for (const element of stage.querySelectorAll<HTMLElement>('[data-death-seat]')) anchors.set(Number(element.dataset.deathSeat), element);
    const draw = () => {
      if (stopped || document.hidden) return;
      const now = performance.now();
      const live = bursts.filter(burst => now - burst.startedAt < DEATH_EFFECT_MS);
      if (!live.length) { ctx.clearRect(0, 0, width, height); return; }
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width && bounds.height) {
        // Local CSS coordinates account for zoom and dynamic ring/grid layout.
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (w !== width || h !== height) {
          width = w; height = h;
          const dpr = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(w, h));
          canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
          ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
        }
        const budget = particleCount(width, bursts.length);
        if (budget !== count) {
          count = budget;
          particles = bursts.map(burst => makeParticles(burst.cursor * 67 + burst.seat * 197, count));
          canvas.dataset.particleCount = String(count * bursts.length);
        }
        const sheet = sheetRef.current;
        if (!!sheet !== artMode) {
          artMode = !!sheet;
          if (artMode) canvas.dataset.art = 'true'; else delete canvas.dataset.art;
        }
        ctx.clearRect(0, 0, width, height);
        for (const [index, burst] of bursts.entries()) {
          const anchor = anchors.get(burst.seat);
          if (!anchor?.isConnected || anchor.dataset.deathAlive !== 'false') continue;
          const box = anchor.getBoundingClientRect();
          if (!box.width || box.bottom < 0 || box.top > window.innerHeight) continue;
          const x = (box.left + box.width / 2 - bounds.left) * width / bounds.width;
          const y = (box.top + box.height / 2 - bounds.top) * height / bounds.height;
          const radius = Math.max(24, box.width * width / bounds.width / 2);
          const age = (now - burst.startedAt) / 1000;
          if (age < 0 || age >= DEATH_EFFECT_MS / 1000) continue;
          if (sheet) drawArtBurst(ctx, sheet, x, y, radius, age, (burst.cursor * 67 + burst.seat * 197) % 2 === 0);
          else drawProceduralBurst(ctx, particles[index], x, y, radius, age);
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { stopped = true; cancelAnimationFrame(frame); ctx.clearRect(0, 0, width, height); };
  }, [stage, bursts]);
  return <canvas ref={ref} className="death-particles" aria-hidden="true" />;
}
