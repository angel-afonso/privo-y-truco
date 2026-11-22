import { Graphics } from "pixi.js";

/**
 * Conjunto unificado de íconos vectoriales PixiJS (trazo limpio de 1.75px).
 * Reemplaza todos los emojis de sistema para una estética coherente y profesional.
 */

export function drawIconHelp(g: Graphics, size: number, color: number): void {
  const r = size * 0.44;
  g.circle(0, 0, r).stroke({ width: 1.6, color, alpha: 0.9 });
  // Arco del signo de interrogación
  g.moveTo(-r * 0.34, -r * 0.22)
    .bezierCurveTo(-r * 0.34, -r * 0.62, r * 0.36, -r * 0.62, r * 0.34, -r * 0.16)
    .bezierCurveTo(r * 0.32, r * 0.06, 0, r * 0.08, 0, r * 0.26)
    .stroke({ width: 1.75, color, cap: "round" });
  g.circle(0, r * 0.52, 1.3).fill(color);
}

export function drawIconSound(
  g: Graphics,
  size: number,
  color: number,
  muted: boolean,
): void {
  const s = size * 0.42;
  // Cuerpo del altavoz
  g.poly([
    -s * 0.92,
    -s * 0.34,
    -s * 0.42,
    -s * 0.34,
    s * 0.12,
    -s * 0.78,
    s * 0.12,
    s * 0.78,
    -s * 0.42,
    s * 0.34,
    -s * 0.92,
    s * 0.34,
  ]).fill(color);

  if (muted) {
    // Aspa limpia de silencio
    g.moveTo(s * 0.42, -s * 0.38)
      .lineTo(s * 1.0, s * 0.38)
      .moveTo(s * 1.0, -s * 0.38)
      .lineTo(s * 0.42, s * 0.38)
      .stroke({ width: 1.8, color, cap: "round" });
  } else {
    // Ondas sonoras suaves
    g.arc(s * 0.24, 0, s * 0.46, -0.75, 0.75).stroke({
      width: 1.65,
      color,
      cap: "round",
    });
    g.arc(s * 0.24, 0, s * 0.82, -0.75, 0.75).stroke({
      width: 1.5,
      color,
      alpha: 0.72,
      cap: "round",
    });
  }
}

export function drawIconMenu(g: Graphics, size: number, color: number): void {
  const w = size * 0.44;
  const dy = size * 0.26;
  g.moveTo(-w, -dy)
    .lineTo(w, -dy)
    .moveTo(-w, 0)
    .lineTo(w, 0)
    .moveTo(-w, dy)
    .lineTo(w, dy)
    .stroke({ width: 1.9, color, cap: "round" });
}

export function drawIconClose(g: Graphics, size: number, color: number): void {
  const d = size * 0.34;
  g.moveTo(-d, -d)
    .lineTo(d, d)
    .moveTo(d, -d)
    .lineTo(-d, d)
    .stroke({ width: 1.9, color, cap: "round" });
}

export function drawIconPartner(g: Graphics, size: number, color: number): void {
  const s = size * 0.46;
  // Burbuja de diálogo limpia con puntito de señal
  g.roundRect(-s, -s * 0.76, s * 2, s * 1.38, 4.5).stroke({
    width: 1.75,
    color,
  });
  g.poly([
    -s * 0.38,
    s * 0.62,
    -s * 0.62,
    s * 1.0,
    s * 0.04,
    s * 0.62,
  ]).fill(color);
  // Tres puntos internos
  g.circle(-s * 0.42, -s * 0.08, 1.35)
    .circle(0, -s * 0.08, 1.35)
    .circle(s * 0.42, -s * 0.08, 1.35)
    .fill(color);
}

export function drawIconDiamondCrown(g: Graphics, size: number, color: number): void {
  const r = size * 0.45;
  // Estrella/rombo de 4 puntas estilo Fournier (Mano / Pieza)
  g.poly([
    0,
    -r,
    r * 0.36,
    -r * 0.36,
    r,
    0,
    r * 0.36,
    r * 0.36,
    0,
    r,
    -r * 0.36,
    r * 0.36,
    -r,
    0,
    -r * 0.36,
    -r * 0.36,
  ]).fill(color);
}

export function drawIconFlor(g: Graphics, size: number, color: number): void {
  const r = size * 0.24;
  const d = size * 0.23;
  g.circle(0, -d, r)
    .circle(d, 0, r)
    .circle(0, d, r)
    .circle(-d, 0, r)
    .fill({ color, alpha: 0.92 });
  g.circle(0, 0, r * 0.55).fill(0x1b120a);
}
