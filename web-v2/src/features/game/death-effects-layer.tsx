import { useEffect, useRef } from 'react';
import { DEATH_EFFECT_MS, makeParticles, particleCount } from '../../presentation/death-effects.ts';
import type { DeathBurst } from '../../presentation/death-effects.ts';

/** Reuse the unchanged reference atlas, just as the default avatar does. No role information. */
export function DeathMark() {
  return <span className="seat-death-mark" aria-hidden="true">
    <svg viewBox="48 110 490 675" focusable="false"><image href="/assets/avatar-sheet.png" width="1774" height="887" /></svg>
  </span>;
}

export function DeathEffectsLayer({ stage, bursts }: { stage: HTMLElement; bursts: readonly DeathBurst[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let frame = 0, stopped = false;
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
          // Smoke expands once, then dissipates. No full-screen flash or perpetual emitter.
          for (const particle of particles[index].slice(0, 8)) {
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
          for (const particle of particles[index]) {
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
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { stopped = true; cancelAnimationFrame(frame); ctx.clearRect(0, 0, width, height); };
  }, [stage, bursts]);
  return <canvas ref={ref} className="death-particles" aria-hidden="true" />;
}
