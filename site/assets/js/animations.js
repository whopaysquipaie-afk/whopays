// Premium animations: count-up numbers, reveal on scroll, confetti, reaction pop.
// Everything is disabled when the user prefers reduced motion.

import { reducedMotion, formatNumber } from './ui.js';

/** Animates a number from its current value to `target` (ease-out). */
export function countUp(el, target, { duration = 1200, format = formatNumber } = {}) {
  const end = Number(target) || 0;
  if (reducedMotion() || !('requestAnimationFrame' in window)) { el.textContent = format(end); return; }
  const start = Number(el.dataset.valeur || 0);
  el.dataset.valeur = String(end);
  if (start === end) { el.textContent = format(end); return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = format(Math.round(start + (end - start) * eased));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Count-up that waits until the element is visible. */
export function countUpWhenVisible(el, target, opts) {
  if (!('IntersectionObserver' in window) || reducedMotion()) { countUp(el, target, opts); return; }
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); countUp(el, target, opts); }
  }, { threshold: 0.3 });
  io.observe(el);
}

let revealObserver = null;
/** Soft appearance of `.revele` elements when they enter the viewport. */
export function initReveal(root = document) {
  const els = root.querySelectorAll('.revele:not(.visible)');
  if (reducedMotion() || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('visible')); return; }
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('visible'); revealObserver.unobserve(e.target); }
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
  }
  els.forEach((e) => revealObserver.observe(e));
}

/** Confetti burst (lemon for the Rich, lavender for the Poor). */
export function confetti({ camp = 'riche', count = 140 } = {}) {
  if (reducedMotion()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confettis';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const colors = camp === 'pauvre' ? ['#DCD3FF', '#B9A8FF', '#FFFFFF', '#3B2A8C'] : ['#C6F432', '#E4FF8A', '#FFFFFF', '#9BC21F'];
  const parts = Array.from({ length: count }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3,
    y: H * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 14 - 4,
    r: 4 + Math.random() * 6,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    c: colors[Math.floor(Math.random() * colors.length)],
    q: Math.random() < 0.18 // some particles are little "?"
  }));
  const t0 = performance.now();
  const frame = (now) => {
    const age = now - t0;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - age / 2600);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      if (p.q) {
        ctx.font = `900 italic ${p.r * 3}px Montserrat, "Arial Black", sans-serif`;
        ctx.fillText('?', 0, 0);
      } else {
        ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      }
      ctx.restore();
    }
    if (age < 2600) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/** Small bounce on a reaction button. */
export function pop(el) {
  if (reducedMotion()) return;
  el.classList.remove('pop');
  void el.offsetWidth; // restart animation
  el.classList.add('pop');
}
