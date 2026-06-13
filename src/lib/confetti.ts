/**
 * Tiny dependency-free confetti burst at a screen position, used when an opp
 * lands in Closed Won. Pieces are plain divs animated with the Web Animations
 * API and cleaned up when the last one finishes.
 */
const COLORS = ['#047857', '#10b981', '#34d399', '#a7f3d0', '#fbbf24', '#f59e0b', '#38bdf8'];

export function burstConfetti(x: number, y: number) {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden';
  document.body.appendChild(container);

  const pieces = 40;
  let finished = 0;
  for (let i = 0; i < pieces; i++) {
    const piece = document.createElement('div');
    const size = 5 + Math.random() * 6;
    const isStrip = Math.random() < 0.5;
    piece.style.cssText = [
      'position:absolute',
      `left:${x}px`,
      `top:${y}px`,
      `width:${size}px`,
      `height:${isStrip ? size * 0.4 : size}px`,
      `background:${COLORS[i % COLORS.length]}`,
      `border-radius:${isStrip ? '1px' : '50%'}`,
    ].join(';');
    container.appendChild(piece);

    const angle = Math.random() * Math.PI * 2;
    const speed = 90 + Math.random() * 160;
    const dx = Math.cos(angle) * speed;
    const dy = Math.sin(angle) * speed - 140; // initial upward kick
    const spin = (Math.random() - 0.5) * 900;
    const duration = 900 + Math.random() * 700;
    piece.animate(
      [
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy + 80}px) rotate(${spin * 0.5}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx * 1.4}px, ${dy + 380}px) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration, easing: 'cubic-bezier(.22,.61,.36,1)' },
    ).onfinish = () => {
      if (++finished === pieces) container.remove();
    };
  }
}
