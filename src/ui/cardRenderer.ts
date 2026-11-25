import { Container, Graphics, GraphicsContext, Rectangle, Text } from "pixi.js";
import { isPerica, isPerico } from "../engine/evaluator";
import { Card, Rank, Suit } from "../engine/types";
import { drawIconDiamondCrown } from "./icons";
import { FONT_DISPLAY, FONT_UI, PALETTE } from "./theme";

export const CARD_WIDTH = 104;
export const CARD_HEIGHT = 156;
const HALF_W = CARD_WIDTH / 2;
const HALF_H = CARD_HEIGHT / 2;

const SUIT_COLORS: Record<Suit, number> = {
  oros: 0xc48312,
  copas: 0xa8242b,
  espadas: 0x204d78,
  bastos: 0x23693b,
};

/**
 * Dibuja un emblema vectorial de los palos de la baraja española centrado en (cx, cy).
 */
export function drawSuitEmblem(
  g: Graphics,
  suit: Suit,
  cx: number,
  cy: number,
  size: number,
): void {
  if (suit === "oros") {
    // Moneda solar de oro
    const r = size * 0.52;
    g.circle(cx, cy, r)
      .fill(0xf3c23c)
      .stroke({ width: Math.max(1.2, size * 0.08), color: 0xa66b0c });
    g.circle(cx, cy, r * 0.65)
      .fill(0xffe17d)
      .stroke({ width: Math.max(1, size * 0.05), color: 0xc28114 });
    // Rayos sutiles internos
    g.star(cx, cy, 8, r * 0.5, r * 0.25).fill(0xd99416);
    g.circle(cx, cy, r * 0.16).fill(0xfff4c2);
    return;
  }

  if (suit === "copas") {
    // Cáliz clásico rojo y dorado
    const w = size * 0.44;
    const h = size * 0.54;
    // Copa superior
    g.poly([
      cx - w,
      cy - h * 0.85,
      cx + w,
      cy - h * 0.85,
      cx + w * 0.65,
      cy + h * 0.05,
      cx - w * 0.65,
      cy + h * 0.05,
    ])
      .fill(0xc42830)
      .stroke({ width: Math.max(1.1, size * 0.06), color: 0x7a1218 });
    // Borde dorado
    g.roundRect(cx - w * 1.05, cy - h * 0.96, w * 2.1, h * 0.22, 2).fill(0xe6b02e);
    // Tallo
    g.rect(cx - w * 0.18, cy + h * 0.05, w * 0.36, h * 0.6).fill(0xdca022);
    g.circle(cx, cy + h * 0.35, w * 0.28).fill(0xf2c84b);
    // Base
    g.poly([
      cx - w * 0.72,
      cy + h * 0.9,
      cx + w * 0.72,
      cy + h * 0.9,
      cx + w * 0.4,
      cy + h * 0.62,
      cx - w * 0.4,
      cy + h * 0.62,
    ])
      .fill(0xc42830)
      .stroke({ width: Math.max(1, size * 0.05), color: 0x7a1218 });
    return;
  }

  if (suit === "espadas") {
    // Espada toledana vertical
    const h = size * 0.62;
    const bw = size * 0.14;
    // Hoja de acero
    g.poly([
      cx,
      cy - h,
      cx + bw,
      cy - h * 0.65,
      cx + bw * 0.85,
      cy + h * 0.38,
      cx - bw * 0.85,
      cy + h * 0.38,
      cx - bw,
      cy - h * 0.65,
    ])
      .fill(0x3a73a8)
      .stroke({ width: Math.max(1, size * 0.05), color: 0x1a3857 });
    // Reflejo central de hoja
    g.moveTo(cx, cy - h * 0.82)
      .lineTo(cx, cy + h * 0.3)
      .stroke({ width: Math.max(1, size * 0.05), color: 0xbfe0ff });
    // Guarda cruzada dorada
    g.roundRect(cx - size * 0.34, cy + h * 0.32, size * 0.68, size * 0.12, 3)
      .fill(0xe6b02e)
      .stroke({ width: 1, color: 0x8f620a });
    // Empuñadura y pomo
    g.rect(cx - bw * 0.6, cy + h * 0.44, bw * 1.2, h * 0.42).fill(0x6e351e);
    g.circle(cx, cy + h * 0.92, bw * 0.95).fill(0xf0be3e);
    return;
  }

  // bastos: garrote rústico verde y madera con brotes
  const h = size * 0.62;
  const topW = size * 0.22;
  const botW = size * 0.11;
  g.poly([
    cx - topW,
    cy - h * 0.72,
    cx + topW,
    cy - h * 0.72,
    cx + botW,
    cy + h * 0.88,
    cx - botW,
    cy + h * 0.88,
  ])
    .fill(0x2e8248)
    .stroke({ width: Math.max(1.1, size * 0.06), color: 0x164a27 });
  // Cabeza redondeada del basto
  g.ellipse(cx, cy - h * 0.72, topW, topW * 0.55).fill(0x3b9c5a);
  // Nudos/bandas de madera
  g.roundRect(cx - topW * 0.85, cy - h * 0.2, topW * 1.7, size * 0.1, 2).fill(0x9e632b);
  g.roundRect(cx - botW * 1.25, cy + h * 0.35, botW * 2.5, size * 0.09, 2).fill(0x9e632b);
  // Hojitas laterales
  g.ellipse(cx - topW * 1.05, cy - h * 0.35, size * 0.1, size * 0.055).fill(0x52b86d);
  g.ellipse(cx + topW * 1.0, cy + h * 0.1, size * 0.1, size * 0.055).fill(0x52b86d);
}

/**
 * Dibuja el borde interno clásico con "la pinta" (cortes según palo de la baraja española):
 * Oros: 0 cortes (continuo), Copas: 1 corte, Espadas: 2 cortes, Bastos: 3 cortes.
 */
function drawSpanishPintaBorder(g: Graphics, suit: Suit, color: number): void {
  const x0 = -HALF_W + 7;
  const y0 = -HALF_H + 7;
  const w = CARD_WIDTH - 14;
  const h = CARD_HEIGHT - 14;

  // Laterales completos
  g.moveTo(x0, y0 + 6).lineTo(x0, y0 + h - 6);
  g.moveTo(x0 + w, y0 + 6).lineTo(x0 + w, y0 + h - 6);

  const breaks = suit === "oros" ? 0 : suit === "copas" ? 1 : suit === "espadas" ? 2 : 3;
  const drawSegmentedHorizontal = (y: number) => {
    const startX = x0 + 6;
    const endX = x0 + w - 6;
    const total = endX - startX;
    if (breaks === 0) {
      g.moveTo(startX, y).lineTo(endX, y);
      return;
    }
    const gap = 7;
    const segCount = breaks + 1;
    const segLen = (total - gap * breaks) / segCount;
    for (let i = 0; i < segCount; i++) {
      const sx = startX + i * (segLen + gap);
      g.moveTo(sx, y).lineTo(sx + segLen, y);
    }
  };

  drawSegmentedHorizontal(y0);
  drawSegmentedHorizontal(y0 + h);
  g.stroke({ width: 1.5, color, alpha: 0.72 });
}

function getPipLayout(rank: Rank): Array<[number, number]> {
  switch (rank) {
    case 1:
      return [[0, 0]];
    case 2:
      return [
        [0, -28],
        [0, 28],
      ];
    case 3:
      return [
        [0, -34],
        [0, 0],
        [0, 34],
      ];
    case 4:
      return [
        [-19, -28],
        [19, -28],
        [-19, 28],
        [19, 28],
      ];
    case 5:
      return [
        [-19, -30],
        [19, -30],
        [0, 0],
        [-19, 30],
        [19, 30],
      ];
    case 6:
      return [
        [-19, -34],
        [19, -34],
        [-19, 0],
        [19, 0],
        [-19, 34],
        [19, 34],
      ];
    case 7:
      return [
        [-19, -36],
        [19, -36],
        [0, -14],
        [-19, 8],
        [19, 8],
        [-19, 36],
        [19, 36],
      ];
    default:
      return [];
  }
}

function drawCourtArtwork(g: Graphics, rank: 10 | 11 | 12, suit: Suit): void {
  const color = SUIT_COLORS[suit];

  // Marco editorial interior estilo naipes Fournier
  g.roundRect(-29, -42, 58, 82, 8)
    .fill({ color: PALETTE.ivoryWarm, alpha: 0.72 })
    .stroke({ width: 1.3, color, alpha: 0.55 });
  g.roundRect(-25, -38, 50, 74, 5).stroke({ width: 0.8, color, alpha: 0.25 });

  if (rank === 12) {
    // REY (12): corona real de 3 puntas + manto carmesí/palo + emblema
    // Manto real
    g.poly([-19, 32, -16, -2, 16, -2, 19, 32])
      .fill({ color, alpha: 0.22 })
      .stroke({ width: 1.3, color, alpha: 0.7 });
    // Cuello de armiño
    g.roundRect(-14, -4, 28, 7, 3).fill(0xfdfaf2).stroke({ width: 1, color: 0xb59e78 });
    // Corona real
    g.poly([
      -18, -11,
      -20, -27,
      -9, -18,
      0, -32,
      9, -18,
      20, -27,
      18, -11,
    ])
      .fill(0xe4b030)
      .stroke({ width: 1.4, color: 0x7c5308 });
    g.roundRect(-18, -12, 36, 5.5, 2).fill(0xa8242b);
    g.circle(0, -32, 2.8).fill(0xfff1b0);
    g.circle(-20, -27, 2.2).fill(0xfff1b0);
    g.circle(20, -27, 2.2).fill(0xfff1b0);
    drawSuitEmblem(g, suit, 0, 15, 28);
  } else if (rank === 11) {
    // CABALLO (11): silueta ecuestre estilizada + escudo del palo
    // Perfil de cabeza y crin de caballo
    g.poly([
      -12, 6,
      -14, -14,
      -8, -28,
      -2, -24,
      3, -31,
      8, -22,
      17, -14,
      14, -7,
      5, -10,
      2, 6,
    ])
      .fill(0x523421)
      .stroke({ width: 1.2, color: 0x2a180d });
    // Brida dorada y ojo
    g.moveTo(14, -11).lineTo(2, -16).stroke({ width: 1.4, color: 0xe6b235 });
    g.circle(5, -19, 1.5).fill(0xfdf5df);
    // Escudo inferior del palo
    g.poly([-15, 4, 15, 4, 13, 21, 0, 31, -13, 21])
      .fill({ color, alpha: 0.2 })
      .stroke({ width: 1.4, color });
    drawSuitEmblem(g, suit, 0, 16, 22);
  } else {
    // SOTA (10): sombrero con pluma de paje + medallón romboidal + emblema
    // Pluma curva
    g.moveTo(4, -22)
      .bezierCurveTo(14, -33, 22, -26, 17, -16)
      .stroke({ width: 2.2, color: 0xd99e26, cap: "round" });
    // Boina / birrete de paje
    g.ellipse(-1, -21, 14, 6.5)
      .fill(color)
      .stroke({ width: 1.2, color: 0x2b1d12 });
    g.roundRect(-12, -17, 24, 4, 2).fill(0xe4b030);
    // Túnica/rombo heráldico
    g.poly([0, -10, 18, 10, 0, 31, -18, 10])
      .fill({ color, alpha: 0.18 })
      .stroke({ width: 1.4, color });
    drawSuitEmblem(g, suit, 0, 10, 26);
  }
}

let sharedCardBackContext: GraphicsContext | null = null;
let sharedCardBackFlatContext: GraphicsContext | null = null;
let sharedCardShadowContext: GraphicsContext | null = null;
let sharedCardEdgeContext: GraphicsContext | null = null;
let sharedDeckShadowContext: GraphicsContext | null = null;
let sharedDeckSliceContexts: GraphicsContext[] | null = null;
let sharedLeaderGlowContext: GraphicsContext | null = null;
let sharedHoverGlowContext: GraphicsContext | null = null;

function drawCardBackArt(g: GraphicsContext, withShadow: boolean): GraphicsContext {
  if (withShadow) {
    g.roundRect(-HALF_W + 2.5, -HALF_H + 4, CARD_WIDTH, CARD_HEIGHT, 10).fill({
      color: 0x000000,
      alpha: 0.36,
    });
  }

  // Base marfil envejecido
  g.roundRect(-HALF_W, -HALF_H, CARD_WIDTH, CARD_HEIGHT, 10)
    .fill(PALETTE.ivory)
    .stroke({ width: 1.3, color: 0x998360 });

  // Panel borgoña interior
  g.roundRect(-HALF_W + 6, -HALF_H + 6, CARD_WIDTH - 12, CARD_HEIGHT - 12, 6)
    .fill(0x6c161e)
    .stroke({ width: 1.4, color: PALETTE.brass });

  // Filigrana doble en latón
  g.roundRect(-HALF_W + 10.5, -HALF_H + 10.5, CARD_WIDTH - 21, CARD_HEIGHT - 21, 3.5).stroke({
    width: 0.9,
    color: PALETTE.brassLight,
    alpha: 0.65,
  });

  // Celosía geométrica fina
  for (let row = -2; row <= 2; row++) {
    for (let col = -1; col <= 1; col++) {
      const cx = col * 24;
      const cy = row * 24;
      g.poly([cx, cy - 8, cx + 8, cy, cx, cy + 8, cx - 8, cy]).stroke({
        width: 0.9,
        color: PALETTE.brassLight,
        alpha: 0.36,
      });
    }
  }

  // Rosa de los vientos central en latón
  g.circle(0, 0, 17)
    .fill(0x4f0e14)
    .stroke({ width: 1.6, color: PALETTE.brass });
  g.star(0, 0, 8, 11.5, 4.5).fill(PALETTE.brass);
  g.circle(0, 0, 3.6).fill(0x6c161e);

  return g;
}

function getCardBackContext(withShadow = true): GraphicsContext {
  if (withShadow) {
    if (!sharedCardBackContext) {
      sharedCardBackContext = drawCardBackArt(new GraphicsContext(), true);
    }
    return sharedCardBackContext;
  }
  if (!sharedCardBackFlatContext) {
    sharedCardBackFlatContext = drawCardBackArt(new GraphicsContext(), false);
  }
  return sharedCardBackFlatContext;
}

function getCardShadowContext(): GraphicsContext {
  if (!sharedCardShadowContext) {
    sharedCardShadowContext = new GraphicsContext()
      .roundRect(-HALF_W, -HALF_H, CARD_WIDTH, CARD_HEIGHT, 10)
      .fill({ color: 0x020b07, alpha: 1 });
  }
  return sharedCardShadowContext;
}

function getCardEdgeContext(): GraphicsContext {
  if (!sharedCardEdgeContext) {
    sharedCardEdgeContext = new GraphicsContext()
      .roundRect(-HALF_W - 2, -HALF_H + 1, CARD_WIDTH + 4, CARD_HEIGHT - 2, 10)
      .fill(0xeadfc6);
  }
  return sharedCardEdgeContext;
}

function getDeckShadowContext(): GraphicsContext {
  if (!sharedDeckShadowContext) {
    sharedDeckShadowContext = new GraphicsContext()
      .roundRect(-HALF_W - 2, -HALF_H - 1, CARD_WIDTH + 6, CARD_HEIGHT + 5, 12)
      .fill({ color: 0x020a06, alpha: 0.44 })
      .roundRect(-HALF_W + 3, -HALF_H + 4, CARD_WIDTH + 6, CARD_HEIGHT + 5, 13)
      .fill({ color: 0x020a06, alpha: 0.22 });
  }
  return sharedDeckShadowContext;
}

function getDeckSliceContexts(): GraphicsContext[] {
  if (sharedDeckSliceContexts) return sharedDeckSliceContexts;
  // Tres tonos sutiles de canto de cartulina de algodón para dar textura real al lomo de la baraja
  const tones = [
    { fill: 0xeae0ca, stroke: 0x9c8867 },
    { fill: 0xded1b4, stroke: 0x8f7b5b },
    { fill: 0xd3c4a4, stroke: 0x847152 },
  ];
  sharedDeckSliceContexts = tones.map(({ fill, stroke }) =>
    new GraphicsContext()
      .roundRect(-HALF_W, -HALF_H, CARD_WIDTH, CARD_HEIGHT, 10)
      .fill(fill)
      .stroke({ width: 1.05, color: stroke, alpha: 0.85 }),
  );
  return sharedDeckSliceContexts;
}

function getLeaderGlowContext(): GraphicsContext {
  if (!sharedLeaderGlowContext) {
    sharedLeaderGlowContext = new GraphicsContext()
      .roundRect(-HALF_W - 4, -HALF_H - 4, CARD_WIDTH + 8, CARD_HEIGHT + 8, 13)
      .fill({ color: PALETTE.brass, alpha: 0.22 })
      .stroke({ width: 2.2, color: PALETTE.brassLight, alpha: 0.92 });
  }
  return sharedLeaderGlowContext;
}

function getHoverGlowContext(): GraphicsContext {
  if (!sharedHoverGlowContext) {
    sharedHoverGlowContext = new GraphicsContext()
      .roundRect(-HALF_W - 4, -HALF_H - 4, CARD_WIDTH + 8, CARD_HEIGHT + 8, 13)
      .fill({ color: PALETTE.brassLight, alpha: 0.3 });
  }
  return sharedHoverGlowContext;
}

export function createCardBackGraphics(withShadow = true): Graphics {
  return new Graphics(getCardBackContext(withShadow));
}

const MAX_DECK_CARDS = 40;
const DECK_SLICE_LAYERS = 20;
const DECK_STEP_Y = 0.52;
const DECK_STEP_X = -0.14;

/**
 * Representación física de una baraja española completa (hasta 40 cartas).
 * Muestra el grosor real de los cantos de cartulina, micro-irregularidades de apilado
 * y se reduce visualmente conforme se reparten cartas desde arriba.
 */
export class DeckStackView extends Container {
  private shadow: Graphics;
  private slices: Graphics[] = [];
  private topCard: Graphics;
  private cardCount = 0;

  constructor(initialCards = MAX_DECK_CARDS) {
    super();

    this.shadow = new Graphics(getDeckShadowContext());
    this.addChild(this.shadow);

    const sliceContexts = getDeckSliceContexts();
    for (let i = 0; i < DECK_SLICE_LAYERS; i++) {
      const slice = new Graphics(sliceContexts[i % sliceContexts.length]);
      // Micro-desalineación determinística para sentir un mazo real recién cuadradito a mano
      const jitterX = Math.sin(i * 2.35) * 0.42;
      const jitterRot = Math.cos(i * 1.73) * 0.0045;
      slice.position.set(i * DECK_STEP_X * 2 + jitterX, -i * DECK_STEP_Y * 2);
      slice.rotation = jitterRot;
      this.slices.push(slice);
      this.addChild(slice);
    }

    this.topCard = createCardBackGraphics(false);
    this.addChild(this.topCard);

    this.setCardCount(initialCards);
  }

  public getCardCount(): number {
    return this.cardCount;
  }

  public getTopOffset(): { x: number; y: number } {
    const c = Math.max(0, this.cardCount);
    return {
      x: c * DECK_STEP_X,
      y: -c * DECK_STEP_Y,
    };
  }

  public setCardCount(count: number): void {
    const clamped = Math.max(0, Math.min(MAX_DECK_CARDS, Math.round(count)));
    this.cardCount = clamped;

    const hasCards = clamped > 0;
    this.shadow.visible = hasCards;
    this.topCard.visible = hasCards;

    if (!hasCards) {
      for (const s of this.slices) s.visible = false;
      return;
    }

    // Número de capas visibles proporcional al grosor real del mazo (1 capa cada 2 cartas)
    const visibleSlices = Math.min(DECK_SLICE_LAYERS, Math.max(1, Math.ceil((clamped - 1) / 2)));
    for (let i = 0; i < this.slices.length; i++) {
      this.slices[i].visible = i < visibleSlices;
    }

    const top = this.getTopOffset();
    this.topCard.position.set(top.x, top.y);

    // Sombra proyectada crece con la altura real del mazo
    const heightRatio = clamped / MAX_DECK_CARDS;
    this.shadow.position.set(3 + heightRatio * 5.5, 4 + heightRatio * 6.5);
    this.shadow.alpha = 0.55 + heightRatio * 0.35;
  }
}

export class CardView extends Container {
  public readonly card: Card;
  public readonly pieceType: "perico" | "perica" | null;
  private shadowLayer: Graphics;
  private flipPivot: Container;
  private edgeFlash: Graphics;
  private frontLayer: Container;
  private backLayer: Graphics;
  private hoverGlow: Graphics;
  private leaderGlow: Graphics;
  private _faceUp: boolean;
  private _elevation = 0;

  constructor(card: Card, vira?: Card, faceUp = true) {
    super();
    this.card = card;
    this._faceUp = faceUp;
    this.pieceType = vira
      ? isPerico(card, vira)
        ? "perico"
        : isPerica(card, vira)
          ? "perica"
          : null
      : null;

    this.shadowLayer = new Graphics(getCardShadowContext());
    this.addChild(this.shadowLayer);

    this.flipPivot = new Container();
    this.addChild(this.flipPivot);

    this.leaderGlow = new Graphics(getLeaderGlowContext());
    this.leaderGlow.visible = false;
    this.flipPivot.addChild(this.leaderGlow);

    this.hoverGlow = new Graphics(getHoverGlowContext());
    this.hoverGlow.visible = false;
    this.flipPivot.addChild(this.hoverGlow);

    this.edgeFlash = new Graphics(getCardEdgeContext());
    this.edgeFlash.visible = false;
    this.flipPivot.addChild(this.edgeFlash);

    this.frontLayer = this.buildFront();
    this.frontLayer.cacheAsTexture({ resolution: 2, antialias: true });
    this.backLayer = createCardBackGraphics(false);

    this.flipPivot.addChild(this.frontLayer);
    this.flipPivot.addChild(this.backLayer);

    this.hitArea = new Rectangle(-HALF_W, -HALF_H, CARD_WIDTH, CARD_HEIGHT);
    this.setElevation(0);
    this.setFaceUp(faceUp);
  }

  public get faceUp(): boolean {
    return this._faceUp;
  }

  public get elevation(): number {
    return this._elevation;
  }

  public setFaceUp(value: boolean): void {
    this._faceUp = value;
    this.frontLayer.visible = value;
    this.backLayer.visible = !value;
  }

  /**
   * Ajusta la altura visual de la carta sobre el fieltro (0 = apoyada, 1 = elevada en mano o vuelo).
   */
  public setElevation(z: number): void {
    const clamped = Math.max(0, Math.min(1.5, z));
    this._elevation = clamped;
    this.shadowLayer.position.set(2 + clamped * 6, 3.8 + clamped * 11.5);
    this.shadowLayer.scale.set(1 + clamped * 0.035);
    this.shadowLayer.alpha = Math.max(0.14, 0.34 - clamped * 0.11);
  }

  /**
   * Aplica un giro 3D suave (progress 0..1) sin interferir con el scale/rotation externos.
   */
  public applyFlip(progress: number, fromFaceUp: boolean, toFaceUp: boolean): void {
    const p = Math.max(0, Math.min(1, progress));
    const cos = Math.cos(p * Math.PI);
    const sin = Math.sin(p * Math.PI);
    const widthScale = Math.max(0.025, Math.abs(cos));

    this.flipPivot.scale.set(widthScale, 1);
    this.flipPivot.skew.set(0, sin * (toFaceUp ? -0.11 : 0.11));
    this.edgeFlash.visible = widthScale < 0.24;

    const showFront = p < 0.5 ? fromFaceUp : toFaceUp;
    if (this._faceUp !== showFront) {
      this.setFaceUp(showFront);
    }
    this.shadowLayer.scale.set(
      Math.max(0.18, widthScale) * (1 + this._elevation * 0.035),
      1 + this._elevation * 0.035,
    );
  }

  public resetFlip(): void {
    this.flipPivot.scale.set(1, 1);
    this.flipPivot.skew.set(0, 0);
    this.edgeFlash.visible = false;
    this.setElevation(this._elevation);
  }

  public setHighlighted(on: boolean): void {
    this.hoverGlow.visible = on;
  }

  /** Destaca la carta que actualmente va ganando la baza sobre el tapete */
  public setTrickLeader(on: boolean): void {
    this.leaderGlow.visible = on;
  }

  private buildFront(): Container {
    const c = new Container();
    const g = new Graphics();
    const color = SUIT_COLORS[this.card.suit];
    const isSpecialPiece = this.pieceType !== null;
    const isMata =
      (this.card.rank === 1 && this.card.suit === "espadas") ||
      (this.card.rank === 1 && this.card.suit === "bastos");

    // Cuerpo marfil cálido estilo naipes de algodón (la sombra vive en shadowLayer)
    g.roundRect(-HALF_W, -HALF_H, CARD_WIDTH, CARD_HEIGHT, 10)
      .fill(isSpecialPiece ? 0xfdf5dc : PALETTE.ivory)
      .stroke({
        width: isSpecialPiece ? 2.4 : 1.3,
        color: isSpecialPiece ? PALETTE.brass : 0xb5a282,
      });

    // Borde interno clásico con la pinta
    drawSpanishPintaBorder(g, this.card.suit, isSpecialPiece ? 0xc48b1b : color);

    // Pips o Arte de Figura
    if (this.card.rank >= 10) {
      drawCourtArtwork(g, this.card.rank as 10 | 11 | 12, this.card.suit);
    } else if (this.card.rank === 1) {
      if (isMata) {
        g.circle(0, 0, 31)
          .fill({ color, alpha: 0.1 })
          .stroke({ width: 1.3, color, alpha: 0.42 });
      }
      drawSuitEmblem(g, this.card.suit, 0, 0, isMata ? 55 : 45);
    } else {
      const pips = getPipLayout(this.card.rank);
      const pipSize = this.card.rank <= 3 ? 28 : this.card.rank <= 5 ? 23 : 20;
      for (const [px, py] of pips) {
        drawSuitEmblem(g, this.card.suit, px, py, pipSize);
      }
    }

    // Mini emblemas en esquinas
    drawSuitEmblem(g, this.card.suit, -HALF_W + 17, -HALF_H + 34, 13);
    drawSuitEmblem(g, this.card.suit, HALF_W - 17, HALF_H - 34, 13);

    c.addChild(g);

    // Índices en serif editorial
    const rankStr = String(this.card.rank);
    const tlText = new Text({
      text: rankStr,
      style: {
        fontFamily: FONT_DISPLAY,
        fontSize: 17,
        fontWeight: "700",
        fill: color,
      },
    });
    tlText.anchor.set(0.5);
    tlText.position.set(-HALF_W + 17, -HALF_H + 17);
    c.addChild(tlText);

    const brText = new Text({
      text: rankStr,
      style: {
        fontFamily: FONT_DISPLAY,
        fontSize: 17,
        fontWeight: "700",
        fill: color,
      },
    });
    brText.anchor.set(0.5);
    brText.rotation = Math.PI;
    brText.position.set(HALF_W - 17, HALF_H - 17);
    c.addChild(brText);

    // Etiqueta fina de figura
    if (this.card.rank >= 10) {
      const courtLabel =
        this.card.rank === 12 ? "REY" : this.card.rank === 11 ? "CABALLO" : "SOTA";
      const lbl = new Text({
        text: courtLabel,
        style: {
          fontFamily: FONT_UI,
          fontSize: 8,
          fontWeight: "800",
          letterSpacing: 1.1,
          fill: color,
        },
      });
      lbl.anchor.set(0.5);
      lbl.position.set(0, 48);
      c.addChild(lbl);
    }

    // Sello sobrio de latón para Perico / Perica (con rombo vectorial, sin emojis)
    if (this.pieceType) {
      const ribbon = new Graphics()
        .roundRect(-35, -HALF_H - 9, 70, 18, 9)
        .fill(this.pieceType === "perico" ? PALETTE.brass : 0xc57d2c)
        .stroke({ width: 1.2, color: PALETTE.brassLight });
      c.addChild(ribbon);

      const crownIcon = new Graphics();
      drawIconDiamondCrown(crownIcon, 8.5, PALETTE.inkDark);
      crownIcon.position.set(-24, -HALF_H);
      c.addChild(crownIcon);

      const badgeTxt = new Text({
        text: this.pieceType === "perico" ? "PERICO" : "PERICA",
        style: {
          fontFamily: FONT_UI,
          fontSize: 8.5,
          fontWeight: "800",
          letterSpacing: 0.7,
          fill: PALETTE.inkDark,
        },
      });
      badgeTxt.anchor.set(0.5);
      badgeTxt.position.set(5, -HALF_H);
      c.addChild(badgeTxt);
    }

    return c;
  }
}
