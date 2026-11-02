// Painted demo icons (one per entry, drawn with canvas paths): stand-ins for a game's real icon art.
import type { Rect } from "../src/index.ts";

type Painter = (g: CanvasRenderingContext2D, s: number) => void;

const INK = "#0b0806";

function grad(g: CanvasRenderingContext2D, s: number, a: string, b: string): CanvasGradient {
  const gr = g.createLinearGradient(0, -s, 0, s);
  gr.addColorStop(0, a);
  gr.addColorStop(1, b);
  return gr;
}

function shape(g: CanvasRenderingContext2D, path: () => void, fill: string | CanvasGradient, lw: number): void {
  g.beginPath();
  path();
  g.lineJoin = "round";
  g.lineWidth = lw;
  g.strokeStyle = INK;
  g.stroke();
  g.fillStyle = fill;
  g.fill();
}

const ICONS: Record<string, Painter> = {
  sword: (g, s) => {
    g.rotate(-Math.PI / 4);
    shape(g, () => g.rect(-s * 0.12, -s * 0.95, s * 0.24, s * 1.25), grad(g, s, "#f4f6ff", "#8a90a8"), s * 0.12);
    shape(g, () => g.rect(-s * 0.45, s * 0.28, s * 0.9, s * 0.16), grad(g, s, "#ffe28a", "#a87018"), s * 0.1);
    shape(g, () => g.rect(-s * 0.09, s * 0.44, s * 0.18, s * 0.4), "#6a3a1a", s * 0.1);
    shape(g, () => g.arc(0, s * 0.92, s * 0.12, 0, Math.PI * 2), "#e8b84a", s * 0.08);
  },
  shield: (g, s) => {
    const p = () => {
      g.moveTo(0, -s * 0.85);
      g.quadraticCurveTo(s * 0.5, -s * 0.6, s * 0.75, -s * 0.7);
      g.quadraticCurveTo(s * 0.8, s * 0.4, 0, s * 0.9);
      g.quadraticCurveTo(-s * 0.8, s * 0.4, -s * 0.75, -s * 0.7);
      g.quadraticCurveTo(-s * 0.5, -s * 0.6, 0, -s * 0.85);
    };
    shape(g, p, grad(g, s, "#4a7ad8", "#1a2a6a"), s * 0.14);
    g.save();
    g.beginPath();
    p();
    g.clip();
    g.fillStyle = "#e8d8a0";
    g.fillRect(-s * 0.12, -s, s * 0.24, s * 2);
    g.fillRect(-s, -s * 0.2, s * 2, s * 0.24);
    g.restore();
  },
  flask: (g, s) => {
    shape(
      g,
      () => {
        g.moveTo(-s * 0.18, -s * 0.8);
        g.lineTo(s * 0.18, -s * 0.8);
        g.lineTo(s * 0.18, -s * 0.3);
        g.quadraticCurveTo(s * 0.75, s * 0.0, s * 0.6, s * 0.55);
        g.quadraticCurveTo(0, s * 1.05, -s * 0.6, s * 0.55);
        g.quadraticCurveTo(-s * 0.75, 0, -s * 0.18, -s * 0.3);
        g.closePath();
      },
      grad(g, s, "#ff8ab0", "#a01848"),
      s * 0.13,
    );
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.beginPath();
    g.ellipse(-s * 0.28, s * 0.2, s * 0.08, s * 0.2, 0.3, 0, Math.PI * 2);
    g.fill();
    shape(g, () => g.rect(-s * 0.24, -s * 0.98, s * 0.48, s * 0.22), "#8a5a2a", s * 0.1);
  },
  gem: (g, s) => {
    shape(
      g,
      () => {
        g.moveTo(-s * 0.7, -s * 0.25);
        g.lineTo(-s * 0.35, -s * 0.7);
        g.lineTo(s * 0.35, -s * 0.7);
        g.lineTo(s * 0.7, -s * 0.25);
        g.lineTo(0, s * 0.85);
        g.closePath();
      },
      grad(g, s, "#9af8d8", "#0a8a6a"),
      s * 0.13,
    );
    g.strokeStyle = "rgba(0,60,40,0.6)";
    g.lineWidth = s * 0.06;
    g.beginPath();
    g.moveTo(-s * 0.7, -s * 0.25);
    g.lineTo(s * 0.7, -s * 0.25);
    g.moveTo(-s * 0.2, -s * 0.25);
    g.lineTo(0, s * 0.85);
    g.lineTo(s * 0.2, -s * 0.25);
    g.stroke();
  },
  crown: (g, s) => {
    shape(
      g,
      () => {
        g.moveTo(-s * 0.8, s * 0.5);
        g.lineTo(-s * 0.8, -s * 0.45);
        g.lineTo(-s * 0.4, 0);
        g.lineTo(0, -s * 0.7);
        g.lineTo(s * 0.4, 0);
        g.lineTo(s * 0.8, -s * 0.45);
        g.lineTo(s * 0.8, s * 0.5);
        g.closePath();
      },
      grad(g, s, "#fff0a0", "#b07818"),
      s * 0.13,
    );
    for (const x of [-0.45, 0, 0.45])
      shape(g, () => g.arc(x * s, s * 0.22, s * 0.11, 0, Math.PI * 2), "#d02838", s * 0.06);
  },
  gear: (g, s) => {
    const teeth = 8;
    shape(
      g,
      () => {
        for (let i = 0; i < teeth * 2; i++) {
          const a = (i / (teeth * 2)) * Math.PI * 2;
          const r = i % 2 ? s * 0.62 : s * 0.85;
          const a0 = a - Math.PI / (teeth * 2.4);
          const a1 = a + Math.PI / (teeth * 2.4);
          g.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
          g.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
        }
        g.closePath();
      },
      grad(g, s, "#d8dce8", "#606478"),
      s * 0.12,
    );
    shape(g, () => g.arc(0, 0, s * 0.25, 0, Math.PI * 2), "#3a3a48", s * 0.08);
  },
  flag: (g, s) => {
    shape(g, () => g.rect(-s * 0.62, -s * 0.85, s * 0.12, s * 1.75), "#6a4a2a", s * 0.1);
    shape(
      g,
      () => {
        g.moveTo(-s * 0.5, -s * 0.8);
        g.quadraticCurveTo(0, -s * 1.0, s * 0.75, -s * 0.7);
        g.lineTo(s * 0.5, -s * 0.35);
        g.lineTo(s * 0.75, 0);
        g.quadraticCurveTo(0, -s * 0.2, -s * 0.5, 0);
        g.closePath();
      },
      grad(g, s, "#ff6a50", "#a01810"),
      s * 0.12,
    );
  },
  scroll: (g, s) => {
    shape(g, () => g.rect(-s * 0.55, -s * 0.65, s * 1.1, s * 1.3), grad(g, s, "#fff4d0", "#d8b878"), s * 0.12);
    for (const y of [-0.65, 0.65])
      shape(g, () => g.ellipse(0, y * s, s * 0.7, s * 0.14, 0, 0, Math.PI * 2), "#c89858", s * 0.1);
    g.fillStyle = "rgba(90,50,20,0.6)";
    for (let i = 0; i < 4; i++) g.fillRect(-s * 0.35, -s * 0.35 + i * s * 0.2, s * (i === 3 ? 0.4 : 0.7), s * 0.06);
  },
};

export function icon(name: string): (g: CanvasRenderingContext2D, r: Rect) => void {
  return (g, r) => {
    const s = Math.min(r.w, r.h) * 0.42;
    g.save();
    g.translate(r.x + r.w / 2, r.y + r.h / 2);
    const bg = g.createRadialGradient(0, -s * 0.3, s * 0.1, 0, 0, s * 1.4);
    bg.addColorStop(0, "rgba(255,230,170,0.25)");
    bg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = bg;
    g.fillRect(-s * 1.2, -s * 1.2, s * 2.4, s * 2.4);
    (ICONS[name] ?? ICONS.gem)(g, s);
    g.restore();
  };
}
