import { Container, Graphics, Rectangle, Text } from "pixi.js";
import {
  calculateEnvidoPoints,
  evaluateFlor,
  getCardPointValue,
  getEnvidoCards,
  isPerica,
  isPerico,
  isPiece,
} from "../engine/evaluator.ts";
import type { Card, GameState, Suit } from "../engine/types.ts";
import { drawSuitEmblem } from "./cardRenderer.ts";
import { drawIconDiamondCrown } from "./icons.ts";
import { FONT_DISPLAY, FONT_UI, PALETTE } from "./theme.ts";

export type EnvidoAccent = "gold" | "brass" | "emerald" | "muted" | "low";

export interface EnvidoBreakdown {
  points: number;
  title: string;
  formula: string;
  compactFormula: string;
  statusLabel: string;
  statusUrgent: boolean;
  dimmed: boolean;
  accent: EnvidoAccent;
  strength: number;
  suitIcon?: Suit;
  useCrownIcon: boolean;
  highlightCardIds: string[];
}

/**
 * Calcula el desglose legible y visual del Envido / Flor de la mano del jugador
 * para mostrar exactamente cómo se forma el puntaje y en qué estado está el lance.
 */
export function describeEnvidoBreakdown(state: GameState): EnvidoBreakdown {
  const hand = state.initialHands.player ?? [];
  const vira = state.vira;
  const flor = state.config.withFlor ? evaluateFlor(hand, vira) : null;
  const envidoPts = calculateEnvidoPoints(hand, vira);

  const isAwaitingEnvido = state.phase === "AWAITING_ENVIDO";
  const isAwaitingFlor = state.phase === "AWAITING_FLOR";
  const isAwaitingPrive = state.phase === "AWAITING_PRIVE";
  const isHandOver = state.phase === "HAND_OVER" || state.phase === "MATCH_OVER";
  const hasFlor = Boolean(flor?.hasFlor);

  let statusLabel = "";
  let statusUrgent = false;
  let dimmed = false;

  if (isAwaitingPrive) {
    statusLabel = "PRIVE";
    statusUrgent = true;
  } else if (isAwaitingFlor && hasFlor) {
    statusLabel = "EN JUEGO";
    statusUrgent = true;
  } else if (isAwaitingEnvido && !hasFlor) {
    statusLabel = "EN JUEGO";
    statusUrgent = true;
  } else if (hasFlor && flor?.isReservada) {
    statusLabel = "5 PIEDRAS";
    statusUrgent = false;
  } else if (hasFlor) {
    statusLabel = state.flor.resolved ? "CANTADA" : "FLOR";
    dimmed = isHandOver;
  } else if (state.envido.accepted) {
    statusLabel = "AL CIERRE";
  } else if (state.envido.resolved || state.trickIndex > 0 || state.truco.level > 0 && state.phase === "PLAYING") {
    statusLabel = "CERRADO";
    dimmed = true;
  } else {
    statusLabel =
      envidoPts >= 31 ? "FUERTE" : envidoPts >= 27 ? "BUENO" : envidoPts >= 20 ? "BAJO" : "SIN LIGA";
  }

  if (flor?.hasFlor) {
    if (flor.isReservada) {
      const pieces = hand.filter((c) => isPiece(c, vira));
      const third = hand.find((c) => !isPiece(c, vira));
      const bonus = third ? getCardPointValue(third) : 0;
      return {
        points: flor.points,
        title: "FLOR RESERVADA",
        formula: bonus > 0 ? `Perico + Perica + ${bonus}` : "Perico + Perica · al final",
        compactFormula: "Reservada",
        statusLabel,
        statusUrgent: true,
        dimmed: false,
        accent: "gold",
        strength: 1,
        useCrownIcon: true,
        highlightCardIds: (pieces.length > 0 ? pieces : hand).map((c) => c.id),
      };
    }

    const perico = hand.find((c) => isPerico(c, vira));
    const perica = hand.find((c) => isPerica(c, vira));
    const regulars = hand
      .filter((c) => !isPiece(c, vira))
      .sort((a, b) => getCardPointValue(b) - getCardPointValue(a));
    const suitIcon = regulars[0]?.suit ?? hand[0]?.suit;
    const regVals = regulars.map(getCardPointValue);

    let formula: string;
    let compactFormula: string;
    if (perico) {
      formula = `Perico 30 + ${regVals.join(" + ")}`;
      compactFormula = `30+${regVals.join("+")}`;
    } else if (perica) {
      formula = `Perica 29 + ${regVals.join(" + ")}`;
      compactFormula = `29+${regVals.join("+")}`;
    } else {
      const vals = [...hand].map(getCardPointValue).sort((a, b) => b - a);
      formula = `20 + ${vals.join(" + ")}`;
      compactFormula = `20+${vals.join("+")}`;
    }

    return {
      points: flor.points,
      title: "FLOR",
      formula,
      compactFormula,
      statusLabel,
      statusUrgent,
      dimmed,
      accent: "gold",
      strength: 1,
      suitIcon,
      useCrownIcon: Boolean(perico || perica),
      highlightCardIds: hand.map((c) => c.id),
    };
  }

  // Envido normal o con pieza (Perico / Perica)
  const usedCards: Card[] = getEnvidoCards(hand, vira);
  const perico = usedCards.find((c) => isPerico(c, vira));
  const perica = usedCards.find((c) => isPerica(c, vira));

  if (perico || perica) {
    const piece = perico ?? perica!;
    const other = usedCards.find((c) => c.id !== piece.id);
    const otherVal = other ? getCardPointValue(other) : 0;
    const baseVal = perico ? 30 : 29;
    const pieceName = perico ? "Perico" : "Perica";
    return {
      points: envidoPts,
      title: "ENVIDO",
      formula: `${pieceName} ${baseVal} + ${otherVal}`,
      compactFormula: `${baseVal}+${otherVal}`,
      statusLabel,
      statusUrgent,
      dimmed,
      accent: "brass",
      strength: Math.min(1, 0.76 + ((envidoPts - 29) / 8) * 0.24),
      suitIcon: other?.suit,
      useCrownIcon: true,
      highlightCardIds: usedCards.map((c) => c.id),
    };
  }

  if (usedCards.length === 2 && usedCards[0].suit === usedCards[1].suit) {
    const vals = usedCards.map(getCardPointValue).sort((a, b) => b - a);
    const accent: EnvidoAccent =
      envidoPts >= 30 ? "brass" : envidoPts >= 27 ? "emerald" : "muted";
    return {
      points: envidoPts,
      title: "ENVIDO",
      formula: `20 + ${vals[0]} + ${vals[1]}`,
      compactFormula: `20+${vals[0]}+${vals[1]}`,
      statusLabel,
      statusUrgent,
      dimmed,
      accent,
      strength: 0.34 + ((envidoPts - 20) / 13) * 0.56,
      suitIcon: usedCards[0].suit,
      useCrownIcon: false,
      highlightCardIds: usedCards.map((c) => c.id),
    };
  }

  // Sin liga (3 palos distintos sin pieza)
  const highCard = usedCards[0] ?? hand[0];
  return {
    points: envidoPts,
    title: "ENVIDO",
    formula: highCard ? `Carta alta · ${envidoPts}` : "Sin cartas",
    compactFormula: "Sin liga",
    statusLabel,
    statusUrgent,
    dimmed,
    accent: "low",
    strength: 0.08 + (Math.min(7, envidoPts) / 7) * 0.14,
    suitIcon: highCard?.suit,
    useCrownIcon: false,
    highlightCardIds: highCard ? [highCard.id] : [],
  };
}

const ACCENT_PALETTE: Record<
  EnvidoAccent,
  { border: number; score: number; meter: number; pillBg: number; pillInk: number }
> = {
  gold: {
    border: PALETTE.brass,
    score: PALETTE.brassLight,
    meter: PALETTE.brassLight,
    pillBg: 0x3b2d12,
    pillInk: PALETTE.brassLight,
  },
  brass: {
    border: PALETTE.brass,
    score: PALETTE.brassLight,
    meter: PALETTE.brass,
    pillBg: 0x332710,
    pillInk: PALETTE.brassLight,
  },
  emerald: {
    border: PALETTE.acceptBorder,
    score: 0x9ce8bf,
    meter: PALETTE.acceptBorder,
    pillBg: 0x133827,
    pillInk: 0x9ce8bf,
  },
  muted: {
    border: PALETTE.borderMuted,
    score: PALETTE.ivory,
    meter: 0x6ea085,
    pillBg: 0x102a1f,
    pillInk: PALETTE.inkSecondary,
  },
  low: {
    border: PALETTE.borderSubtle,
    score: PALETTE.inkSecondary,
    meter: 0x527362,
    pillBg: 0x0d2219,
    pillInk: PALETTE.inkMuted,
  },
};

/**
 * Calculadora visual e interactiva de Envido y Flor integrada al sistema
 * «Club de Truco · Caoba, Fieltro y Bronce».
 * Al pasar el puntero (escritorio) o tocar (móvil), resalta las cartas de tu mano que suman el puntaje.
 */
export class EnvidoBoard extends Container {
  private bg = new Graphics();
  private iconG = new Graphics();
  private meterG = new Graphics();
  private scoreTxt: Text;
  private unitTxt: Text;
  private titleTxt: Text;
  private statusTxt: Text;
  private formulaTxt: Text;

  private currentBreakdown: EnvidoBreakdown | null = null;
  private hovered = false;
  private lastCompact = false;
  private lastWidth = 224;
  private tapTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private onHighlightCards?: (cardIds: string[] | null) => void) {
    super();

    this.scoreTxt = new Text({
      text: "0",
      style: {
        fontFamily: FONT_DISPLAY,
        fontSize: 30,
        fontWeight: "700",
        fill: PALETTE.ivory,
      },
    });
    this.scoreTxt.anchor.set(0.5);

    this.unitTxt = new Text({
      text: "TANTOS",
      style: {
        fontFamily: FONT_UI,
        fontSize: 8.5,
        fontWeight: "800",
        letterSpacing: 1.1,
        fill: PALETTE.inkMuted,
      },
    });
    this.unitTxt.anchor.set(0.5);

    this.titleTxt = new Text({
      text: "ENVIDO",
      style: {
        fontFamily: FONT_UI,
        fontSize: 10,
        fontWeight: "800",
        letterSpacing: 1.05,
        fill: PALETTE.inkSecondary,
      },
    });
    this.titleTxt.anchor.set(0, 0.5);

    this.statusTxt = new Text({
      text: "",
      style: {
        fontFamily: FONT_UI,
        fontSize: 8.5,
        fontWeight: "800",
        letterSpacing: 0.7,
        fill: PALETTE.brassLight,
      },
    });
    this.statusTxt.anchor.set(1, 0.5);

    this.formulaTxt = new Text({
      text: "",
      style: {
        fontFamily: FONT_UI,
        fontSize: 12.5,
        fontWeight: "700",
        fill: PALETTE.inkLight,
      },
    });
    this.formulaTxt.anchor.set(0, 0.5);

    this.addChild(
      this.bg,
      this.meterG,
      this.iconG,
      this.scoreTxt,
      this.unitTxt,
      this.titleTxt,
      this.statusTxt,
      this.formulaTxt,
    );

    this.eventMode = "static";
    this.cursor = "pointer";
    this.accessible = true;

    this.on("pointerover", () => {
      this.hovered = true;
      this.redraw();
      if (this.currentBreakdown) {
        this.onHighlightCards?.(this.currentBreakdown.highlightCardIds);
      }
    });

    this.on("pointerout", () => {
      this.hovered = false;
      this.redraw();
      this.onHighlightCards?.(null);
    });

    this.on("pointertap", () => {
      if (!this.currentBreakdown) return;
      if (this.tapTimer) clearTimeout(this.tapTimer);
      this.onHighlightCards?.(this.currentBreakdown.highlightCardIds);
      this.tapTimer = setTimeout(() => {
        this.tapTimer = null;
        if (!this.hovered) this.onHighlightCards?.(null);
      }, 1500);
    });
  }

  public update(state: GameState, compact: boolean, maxWidth?: number): void {
    this.currentBreakdown = describeEnvidoBreakdown(state);
    this.lastCompact = compact;
    this.lastWidth = maxWidth ?? (compact ? 156 : 228);
    this.accessibleTitle = `${this.currentBreakdown.title}: ${this.currentBreakdown.points} tantos (${this.currentBreakdown.formula})`;
    this.redraw();
  }

  private redraw(): void {
    const b = this.currentBreakdown;
    if (!b) return;

    const compact = this.lastCompact;
    const palette = ACCENT_PALETTE[b.accent];
    const borderCol = b.statusUrgent || this.hovered ? PALETTE.brass : palette.border;
    const borderAlpha = b.statusUrgent || this.hovered ? 0.95 : b.dimmed ? 0.45 : 0.72;

    this.alpha = b.dimmed && !this.hovered ? 0.76 : 1;
    this.bg.clear();
    this.iconG.clear();
    this.meterG.clear();

    if (compact) {
      const h = 28;
      const scoreW = 36;

      this.scoreTxt.text = String(b.points);
      this.scoreTxt.style.fontSize = 16.5;
      this.scoreTxt.style.fill = palette.score;
      this.scoreTxt.position.set(scoreW / 2 + 1, h / 2 - 0.5);

      this.unitTxt.visible = false;
      this.statusTxt.visible = false;

      const labelPrefix = b.title === "FLOR RESERVADA" ? "FLOR RES." : b.title;
      this.titleTxt.visible = true;
      this.titleTxt.text = labelPrefix;
      this.titleTxt.style.fontSize = 8.5;
      this.titleTxt.style.fill = b.accent === "gold" ? PALETTE.brassLight : PALETTE.inkMuted;
      this.titleTxt.position.set(scoreW + 8, 8.5);

      const hasIcon = Boolean(b.suitIcon || b.useCrownIcon);
      const formulaLeft = scoreW + 8 + (hasIcon ? 14 : 0);
      this.formulaTxt.text = b.compactFormula;
      this.formulaTxt.style.fontSize = 10.5;
      this.formulaTxt.style.fill = PALETTE.inkLight;
      this.formulaTxt.scale.set(1);

      const desiredW = Math.max(
        118,
        Math.min(
          this.lastWidth,
          Math.max(scoreW + 16 + this.titleTxt.width, formulaLeft + this.formulaTxt.width + 10),
        ),
      );
      const maxFormulaW = Math.max(40, desiredW - formulaLeft - 8);
      if (this.formulaTxt.width > maxFormulaW) {
        this.formulaTxt.scale.set(maxFormulaW / this.formulaTxt.width);
      }
      this.formulaTxt.position.set(formulaLeft, 19.5);

      if (b.useCrownIcon) {
        drawIconDiamondCrown(this.iconG, 7.5, PALETTE.brass);
        this.iconG.position.set(scoreW + 13, 19.5);
      } else if (b.suitIcon) {
        this.iconG.position.set(0, 0);
        drawSuitEmblem(this.iconG, b.suitIcon, scoreW + 13, 19.5, 9.5);
      } else {
        this.iconG.position.set(0, 0);
      }

      // Sombra + cuerpo compacto
      this.bg
        .roundRect(0, 2, desiredW, h, 8)
        .fill({ color: 0x030c08, alpha: 0.45 })
        .roundRect(0, 0, desiredW, h, 8)
        .fill({ color: this.hovered ? PALETTE.surfaceControl : PALETTE.surfaceDark, alpha: 0.94 })
        .roundRect(1, 1, scoreW, h - 2, 7)
        .fill({ color: PALETTE.surfaceRecessed, alpha: 0.85 })
        .moveTo(scoreW + 1, 5)
        .lineTo(scoreW + 1, h - 5)
        .stroke({ width: 1, color: borderCol, alpha: 0.35 })
        .roundRect(0, 0, desiredW, h, 8)
        .stroke({ width: b.statusUrgent ? 1.5 : 1.1, color: borderCol, alpha: borderAlpha });

      // Barra de fuerza ultra-fina en el borde inferior derecho
      const barX = scoreW + 8;
      const barW = Math.max(24, desiredW - barX - 8);
      const barY = h - 3.5;
      this.meterG
        .roundRect(barX, barY, barW, 2, 1)
        .fill({ color: 0x05120c, alpha: 0.9 })
        .roundRect(barX, barY, Math.max(4, barW * b.strength), 2, 1)
        .fill({ color: palette.meter, alpha: b.dimmed ? 0.5 : 0.92 });

      this.hitArea = new Rectangle(0, -6, desiredW, h + 12);
      return;
    }

    // ── Versión escritorio: placa táctil «Club de Truco» ─────────────────────
    const w = this.lastWidth;
    const h = 72;
    const scoreColW = 66;
    const rightX = scoreColW + 12;
    const rightPad = 12;

    this.bg
      .roundRect(0, 3, w, h, 10)
      .fill({ color: 0x030c08, alpha: 0.46 })
      .roundRect(0, 0, w, h, 10)
      .fill({ color: this.hovered ? 0x102c20 : PALETTE.surfaceDark, alpha: 0.95 })
      .roundRect(2, 2, scoreColW - 2, h - 4, 8)
      .fill({ color: PALETTE.surfaceRecessed, alpha: 0.9 })
      .moveTo(scoreColW, 10)
      .lineTo(scoreColW, h - 10)
      .stroke({ width: 1, color: borderCol, alpha: 0.36 })
      .roundRect(0, 0, w, h, 10)
      .stroke({ width: b.statusUrgent || this.hovered ? 1.6 : 1.2, color: borderCol, alpha: borderAlpha });

    // Columna izquierda: número grande en Fraunces + subtítulo
    this.scoreTxt.text = String(b.points);
    this.scoreTxt.style.fontSize = 31;
    this.scoreTxt.style.fill = palette.score;
    this.scoreTxt.position.set(scoreColW / 2, 27);

    this.unitTxt.visible = true;
    this.unitTxt.text = b.title === "FLOR RESERVADA" ? "RESERV." : "TANTOS";
    this.unitTxt.style.fontSize = 8.5;
    this.unitTxt.style.fill = b.accent === "gold" ? PALETTE.brass : PALETTE.inkMuted;
    this.unitTxt.position.set(scoreColW / 2, 54);

    // Columna derecha fila 1: categoría + insignia de estado
    this.titleTxt.visible = true;
    this.titleTxt.text = b.title === "FLOR RESERVADA" ? "FLOR RES." : b.title;
    this.titleTxt.style.fontSize = 10;
    this.titleTxt.style.fill = b.accent === "gold" ? PALETTE.brassLight : PALETTE.inkSecondary;
    this.titleTxt.position.set(rightX, 17);

    this.statusTxt.visible = Boolean(b.statusLabel);
    this.statusTxt.text = b.statusLabel;
    this.statusTxt.style.fontSize = 8.5;
    this.statusTxt.style.fill = b.statusUrgent ? PALETTE.inkDark : palette.pillInk;
    this.statusTxt.position.set(w - rightPad - 5, 17);

    if (b.statusLabel) {
      const pillW = this.statusTxt.width + 10;
      const pillH = 15;
      this.bg
        .roundRect(w - rightPad - pillW, 17 - pillH / 2, pillW, pillH, 4)
        .fill(b.statusUrgent ? PALETTE.brass : palette.pillBg)
        .stroke({
          width: 0.8,
          color: b.statusUrgent ? PALETTE.brassLight : borderCol,
          alpha: b.statusUrgent ? 0.9 : 0.45,
        });
    }

    // Columna derecha fila 2: icono del palo / corona + fórmula exacta del cálculo
    const hasIcon = Boolean(b.suitIcon || b.useCrownIcon);
    const formulaX = rightX + (hasIcon ? 17 : 0);
    if (b.useCrownIcon) {
      drawIconDiamondCrown(this.iconG, 9.5, PALETTE.brass);
      this.iconG.position.set(rightX + 6.5, 40);
    } else if (b.suitIcon) {
      this.iconG.position.set(0, 0);
      drawSuitEmblem(this.iconG, b.suitIcon, rightX + 6.5, 40, 12.5);
    } else {
      this.iconG.position.set(0, 0);
    }

    this.formulaTxt.text = b.formula;
    this.formulaTxt.style.fontSize = 12.5;
    this.formulaTxt.style.fill = PALETTE.inkLight;
    this.formulaTxt.scale.set(1);
    const maxFormulaW = w - formulaX - rightPad;
    if (this.formulaTxt.width > maxFormulaW) {
      this.formulaTxt.scale.set(maxFormulaW / this.formulaTxt.width);
    }
    this.formulaTxt.position.set(formulaX, 40);

    // Columna derecha fila 3: indicador fino de fuerza de la mano
    const barX = rightX;
    const barY = 57;
    const barW = w - rightX - rightPad;
    const barH = 4;
    this.meterG
      .roundRect(barX, barY, barW, barH, 2)
      .fill({ color: PALETTE.surfaceRecessed, alpha: 0.95 })
      .roundRect(barX, barY, Math.max(8, barW * b.strength), barH, 2)
      .fill({ color: palette.meter, alpha: b.dimmed ? 0.5 : 0.95 });

    this.hitArea = new Rectangle(0, 0, w, h);
  }
}
