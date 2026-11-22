import { Texture } from "pixi.js";

/**
 * Sistema de diseño «Club de Truco · Caoba, Fieltro y Bronce»
 * Paleta disciplinada de 3 acentos (latón, esmeralda, lacre) sobre caoba y fieltro botella.
 */
export const FONT_DISPLAY = '"Fraunces", Georgia, "Times New Roman", serif';
export const FONT_UI = '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif';

export const PALETTE = {
  // Mesa y madera (Caoba + Fieltro)
  woodOuter: 0x160b07,
  woodRail: 0x2a150c,
  woodBevel: 0x4b2919,
  feltCenter: 0x174f38,
  feltMid: 0x0f3928,
  feltEdge: 0x071e15,

  // Superficies UI (mate, sin brillos plásticos)
  headerBg: 0x091c14,
  surfaceDark: 0x0a1e16,
  surfaceCard: 0x0d251b,
  surfaceRecessed: 0x06150f,
  surfaceControl: 0x133024,
  surfaceControlHover: 0x1b4031,

  // Bordes y filetes
  borderSubtle: 0x284d3c,
  borderMuted: 0x3b6954,
  brass: 0xd6a645,
  brassHover: 0xe3b85b,
  brassSoft: 0x9e7932,
  brassLight: 0xf4dca0,

  // Acentos funcionales (máx. 2 pesos activos a la vez)
  accept: 0x1d6f47,
  acceptHover: 0x248657,
  acceptBorder: 0x5cc48f,

  crimson: 0x9e2830,
  crimsonHover: 0xb5333c,
  crimsonBorder: 0xe38b90,
  crimsonSoft: 0x381316,

  // Papel y tintas
  ivory: 0xf8f1e1,
  ivoryWarm: 0xefe5ce,
  inkDark: 0x1b120a,
  inkLight: 0xf4efe4,
  inkSecondary: 0xbcd1c4,
  inkMuted: 0x7e9e8c,
} as const;

let cachedFeltTexture: Texture | null = null;

/**
 * Genera una textura procedural sutil de paño/fieltro (128×128 tileable) una sola vez.
 * Aporta profundidad táctil real con costo cero por fotograma.
 */
export function getFeltGrainTexture(): Texture {
  if (cachedFeltTexture) return cachedFeltTexture;

  if (typeof document === "undefined") {
    return Texture.WHITE;
  }

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Texture.WHITE;

  const img = ctx.createImageData(size, size);
  const data = img.data;
  let seed = 918273;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return ((seed >>> 0) % 1000) / 1000;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Trama cruzada muy tenue + grano orgánico de fieltro
      const weave = ((x + y) % 2 === 0 ? 10 : -8) + (x % 4 === 0 ? 5 : 0);
      const grain = (rand() - 0.5) * 64 + weave;
      const v = Math.max(0, Math.min(255, Math.round(128 + grain)));
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = Math.max(0, v - 8);
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  cachedFeltTexture = Texture.from(canvas);
  return cachedFeltTexture;
}
