import { Container, Graphics, Rectangle, Text } from "pixi.js";
import {
  PartnerAdviceTone,
  PartnerCommandType,
  PartnerMessage,
  PartnerQueryType,
} from "../engine/partnerComms";
import { GameMode, TeamId } from "../engine/types";
import {
  drawIconClose,
  drawIconDiamondCrown,
  drawIconPartner,
} from "./icons";
import { FONT_DISPLAY, FONT_UI, PALETTE } from "./theme";

export type ButtonTheme = "primary" | "accept" | "danger" | "secondary" | "ghost";

const THEME_COLORS: Record<
  ButtonTheme,
  { bg: number; bgHover: number; border: number; borderAlpha: number; text: number }
> = {
  primary: {
    bg: PALETTE.brass,
    bgHover: PALETTE.brassHover,
    border: PALETTE.brassLight,
    borderAlpha: 0.9,
    text: PALETTE.inkDark,
  },
  accept: {
    bg: PALETTE.accept,
    bgHover: PALETTE.acceptHover,
    border: PALETTE.acceptBorder,
    borderAlpha: 0.72,
    text: PALETTE.inkLight,
  },
  danger: {
    bg: PALETTE.crimson,
    bgHover: PALETTE.crimsonHover,
    border: PALETTE.crimsonBorder,
    borderAlpha: 0.7,
    text: PALETTE.inkLight,
  },
  secondary: {
    bg: PALETTE.surfaceControl,
    bgHover: PALETTE.surfaceControlHover,
    border: PALETTE.brassSoft,
    borderAlpha: 0.65,
    text: PALETTE.inkLight,
  },
  ghost: {
    bg: PALETTE.surfaceDark,
    bgHover: PALETTE.surfaceControl,
    border: PALETTE.borderSubtle,
    borderAlpha: 0.85,
    text: PALETTE.inkSecondary,
  },
};

export interface PillButtonOptions {
  label?: string;
  width?: number;
  height?: number;
  theme?: ButtonTheme;
  fontSize?: number;
  radius?: number;
  drawIcon?: (g: Graphics, color: number) => void;
  onClick: () => void;
}

/**
 * Botón táctil mate del sistema «Club de Truco» (sin brillo plástico glossy).
 * Respuesta física sobria al pasar el puntero y al presionar.
 */
export class PillButton extends Container {
  private bg: Graphics;
  private iconG: Graphics;
  private txt: Text;
  private btnW: number;
  private btnH: number;
  private radius: number;
  private theme: ButtonTheme;
  private hovered = false;
  private pressed = false;
  private enabled = true;
  private drawIconFn?: (g: Graphics, color: number) => void;
  private onClickCb: () => void;

  constructor(opts: PillButtonOptions) {
    super();
    this.btnW = opts.width ?? 124;
    this.btnH = opts.height ?? 42;
    this.radius = opts.radius ?? 10;
    this.theme = opts.theme ?? "secondary";
    this.drawIconFn = opts.drawIcon;
    this.onClickCb = opts.onClick;

    this.bg = new Graphics();
    this.iconG = new Graphics();
    this.txt = new Text({
      text: opts.label ?? "",
      style: {
        fontFamily: FONT_UI,
        fontSize: opts.fontSize ?? 13.5,
        fontWeight: "700",
        fill: THEME_COLORS[this.theme].text,
      },
    });
    this.txt.anchor.set(0.5);
    this.addChild(this.bg, this.iconG, this.txt);

    this.eventMode = "static";
    this.cursor = "pointer";
    this.hitArea = new Rectangle(-this.btnW / 2, -this.btnH / 2, this.btnW, this.btnH);

    this.on("pointerover", () => {
      if (!this.enabled) return;
      this.hovered = true;
      this.redraw();
    });
    this.on("pointerout", () => {
      this.hovered = false;
      this.pressed = false;
      this.redraw();
    });
    this.on("pointerdown", () => {
      if (!this.enabled) return;
      this.pressed = true;
      this.redraw();
    });
    this.on("pointerup", () => {
      this.pressed = false;
      this.redraw();
    });
    this.on("pointerupoutside", () => {
      this.pressed = false;
      this.redraw();
    });
    this.on("pointertap", (e) => {
      if (!this.enabled || e.button !== 0) return;
      this.onClickCb();
    });

    this.redraw();
  }

  public setLabel(label: string): void {
    this.txt.text = label;
    this.redraw();
  }

  public setIcon(drawIcon: (g: Graphics, color: number) => void): void {
    this.drawIconFn = drawIcon;
    this.redraw();
  }

  public setTheme(theme: ButtonTheme): void {
    this.theme = theme;
    this.txt.style.fill = THEME_COLORS[theme].text;
    this.redraw();
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.alpha = enabled ? 1 : 0.42;
    this.cursor = enabled ? "pointer" : "default";
    this.redraw();
  }

  private redraw(): void {
    const c = THEME_COLORS[this.theme];
    const hw = this.btnW / 2;
    const hh = this.btnH / 2;
    const pressY = this.pressed ? 1.5 : 0;

    this.bg.clear();

    // Sombra de apoyo corta y realista
    if (!this.pressed) {
      this.bg
        .roundRect(-hw, -hh + 2.5, this.btnW, this.btnH, this.radius)
        .fill({ color: 0x000000, alpha: 0.36 });
    }

    // Cuerpo mate con filete fino
    this.bg
      .roundRect(-hw, -hh + pressY, this.btnW, this.btnH, this.radius)
      .fill(this.hovered ? c.bgHover : c.bg)
      .stroke({
        width: 1.25,
        color: c.border,
        alpha: this.hovered ? Math.min(1, c.borderAlpha + 0.2) : c.borderAlpha,
      });

    // Bisel superior discreto (1px, nada de brillo plástico)
    this.bg
      .moveTo(-hw + this.radius, -hh + pressY + 1)
      .lineTo(hw - this.radius, -hh + pressY + 1)
      .stroke({ width: 1, color: 0xffffff, alpha: this.theme === "primary" ? 0.28 : 0.09 });

    this.txt.style.fill = c.text;
    const hasLabel = this.txt.text.length > 0;
    const hasIcon = Boolean(this.drawIconFn);

    this.iconG.clear();
    if (hasIcon && this.drawIconFn) {
      this.drawIconFn(this.iconG, c.text);
      if (hasLabel) {
        const totalContentW = 16 + 7 + this.txt.width;
        this.iconG.position.set(-totalContentW / 2 + 8, pressY);
        this.txt.position.set(-totalContentW / 2 + 16 + 7 + this.txt.width / 2, pressY);
      } else {
        this.iconG.position.set(0, pressY);
      }
    } else {
      this.txt.position.set(0, pressY);
    }
  }
}

/**
 * Control segmentado sobrio para el menú de configuración (sin botones chillones).
 */
export class SegmentedToggle extends Container {
  private bg: Graphics;
  private leftHit: Container;
  private rightHit: Container;
  private leftTxt: Text;
  private rightTxt: Text;

  constructor(opts: {
    width: number;
    height?: number;
    leftLabel: string;
    rightLabel: string;
    leftActive: boolean;
    onLeft: () => void;
    onRight: () => void;
  }) {
    super();
    const w = opts.width;
    const h = opts.height ?? 38;
    const hw = w / 2;
    const hh = h / 2;
    const pad = 3;
    const segW = (w - pad * 2) / 2;

    this.bg = new Graphics();
    // Pista hundida oscura
    this.bg
      .roundRect(-hw, -hh, w, h, 10)
      .fill(PALETTE.surfaceRecessed)
      .stroke({ width: 1, color: PALETTE.borderSubtle, alpha: 0.9 });

    // Indicador activo en latón sobrio
    const activeX = opts.leftActive ? -hw + pad : pad;
    this.bg
      .roundRect(activeX, -hh + pad, segW, h - pad * 2, 7.5)
      .fill(PALETTE.brass)
      .stroke({ width: 1, color: PALETTE.brassLight, alpha: 0.75 });
    this.addChild(this.bg);

    this.leftTxt = new Text({
      text: opts.leftLabel,
      style: {
        fontFamily: FONT_UI,
        fontSize: 12.5,
        fontWeight: "700",
        fill: opts.leftActive ? PALETTE.inkDark : PALETTE.inkSecondary,
      },
    });
    this.leftTxt.anchor.set(0.5);
    this.leftTxt.position.set(-hw / 2, 0);

    this.rightTxt = new Text({
      text: opts.rightLabel,
      style: {
        fontFamily: FONT_UI,
        fontSize: 12.5,
        fontWeight: "700",
        fill: !opts.leftActive ? PALETTE.inkDark : PALETTE.inkSecondary,
      },
    });
    this.rightTxt.anchor.set(0.5);
    this.rightTxt.position.set(hw / 2, 0);

    this.leftHit = new Container();
    this.leftHit.eventMode = "static";
    this.leftHit.cursor = "pointer";
    this.leftHit.hitArea = new Rectangle(-hw, -hh, hw, h);
    this.leftHit.on("pointertap", () => opts.onLeft());

    this.rightHit = new Container();
    this.rightHit.eventMode = "static";
    this.rightHit.cursor = "pointer";
    this.rightHit.hitArea = new Rectangle(0, -hh, hw, h);
    this.rightHit.on("pointertap", () => opts.onRight());

    this.addChild(this.leftTxt, this.rightTxt, this.leftHit, this.rightHit);
  }
}

export type BubbleTailDir = "up" | "down" | "left" | "right";

/**
 * Globo de canto editorial (papel marfil, tipografía display y borde según lance).
 */
export class SpeechBubble extends Container {
  private bg: Graphics;
  private txt: Text;
  private tailDir: BubbleTailDir;
  private hideTimerMs = 0;
  private sticky = false;
  public bubbleWidth = 96;

  constructor(tailDir: BubbleTailDir = "down") {
    super();
    this.tailDir = tailDir;
    this.bg = new Graphics();
    this.addChild(this.bg);

    this.txt = new Text({
      text: "",
      style: {
        fontFamily: FONT_DISPLAY,
        fontSize: 14,
        fontWeight: "700",
        letterSpacing: 0.4,
        fill: PALETTE.inkDark,
      },
    });
    this.txt.anchor.set(0.5);
    this.addChild(this.txt);
    this.visible = false;
  }

  public setTailDirection(dir: BubbleTailDir): void {
    this.tailDir = dir;
  }

  /**
   * Muestra el globo de canto. Si `durationMs <= 0`, permanece fijo (sticky)
   * hasta que se oculte manualmente al responder el canto.
   */
  public show(message: string, accentBorder: number = PALETTE.brass, durationMs = 2000): void {
    this.txt.text = message;
    const padX = 16;
    const padY = 8;
    const w = Math.max(92, this.txt.width + padX * 2);
    const h = Math.max(34, this.txt.height + padY * 2);
    this.bubbleWidth = w;
    const hw = w / 2;
    const hh = h / 2;

    this.bg.clear();
    this.bg
      .roundRect(-hw + 1.5, -hh + 3.5, w, h, 10)
      .fill({ color: 0x000000, alpha: 0.34 });

    this.bg
      .roundRect(-hw, -hh, w, h, 10)
      .fill(PALETTE.ivory)
      .stroke({ width: 1.8, color: accentBorder });

    if (this.tailDir === "up") {
      this.bg
        .poly([-6, -hh + 1, 0, -hh - 8, 6, -hh + 1])
        .fill(PALETTE.ivory)
        .stroke({ width: 1.4, color: accentBorder });
    } else if (this.tailDir === "down") {
      this.bg
        .poly([-6, hh - 1, 0, hh + 8, 6, hh - 1])
        .fill(PALETTE.ivory)
        .stroke({ width: 1.4, color: accentBorder });
    } else if (this.tailDir === "left") {
      this.bg
        .poly([-hw + 1, -5, -hw - 8, 0, -hw + 1, 5])
        .fill(PALETTE.ivory)
        .stroke({ width: 1.4, color: accentBorder });
    } else {
      this.bg
        .poly([hw - 1, -5, hw + 8, 0, hw - 1, 5])
        .fill(PALETTE.ivory)
        .stroke({ width: 1.4, color: accentBorder });
    }

    this.visible = true;
    this.alpha = 1;
    this.sticky = durationMs <= 0;
    this.hideTimerMs = this.sticky ? 0 : durationMs;
  }

  public isSticky(): boolean {
    return this.sticky && this.visible;
  }

  public hide(): void {
    this.visible = false;
    this.sticky = false;
    this.hideTimerMs = 0;
  }

  public tick(deltaMS: number): void {
    if (!this.visible || this.sticky || this.hideTimerMs <= 0) return;
    this.hideTimerMs -= deltaMS;
    if (this.hideTimerMs <= 350) {
      this.alpha = Math.max(0, this.hideTimerMs / 350);
    }
    if (this.hideTimerMs <= 0) {
      this.visible = false;
    }
  }
}

/**
 * Indicador sereno de estado/turno junto a la mano del jugador.
 * Sin saltos de escala ni colores estridentes; solo un punto vivo suave.
 */
export class TurnSpotlightPill extends Container {
  private bg: Graphics;
  private dot: Graphics;
  private txt: Text;
  private pulse = 0;
  private accentColor: number = PALETTE.acceptBorder;
  private pillW = 132;
  private maxW = 999;
  private baseScale = 1;

  constructor() {
    super();
    this.bg = new Graphics();
    this.dot = new Graphics();
    this.txt = new Text({
      text: "",
      style: {
        fontFamily: FONT_UI,
        fontSize: 12,
        fontWeight: "700",
        letterSpacing: 0.25,
        fill: PALETTE.inkLight,
      },
    });
    this.txt.anchor.set(0.5);
    this.addChild(this.bg, this.dot, this.txt);
    this.visible = false;
  }

  public setState(
    visible: boolean,
    label: string,
    mode: "player" | "urgent" | "cpu" = "player",
  ): void {
    this.visible = visible;
    if (!visible) return;

    this.txt.text = label;
    this.accentColor =
      mode === "urgent"
        ? PALETTE.brass
        : mode === "player"
          ? PALETTE.acceptBorder
          : PALETTE.inkMuted;
    const fillBg =
      mode === "urgent"
        ? 0x261a08
        : mode === "player"
          ? PALETTE.surfaceDark
          : 0x0b1a14;
    const borderColor =
      mode === "urgent"
        ? PALETTE.brass
        : mode === "player"
          ? PALETTE.borderMuted
          : PALETTE.borderSubtle;

    const w = Math.max(128, this.txt.width + 36);
    this.pillW = w;
    const h = 32;
    this.bg.clear();
    this.bg
      .roundRect(-w / 2, -h / 2, w, h, 10)
      .fill({ color: fillBg, alpha: 0.92 })
      .stroke({ width: 1.25, color: borderColor, alpha: 0.9 });

    this.txt.position.set(7, 0);
    this.dot.position.set(-w / 2 + 14, 0);
    this.redrawDot(1);
    this.updateBaseScale();
  }

  public setMaxWidth(maxW: number): void {
    this.maxW = Math.max(120, maxW);
    this.updateBaseScale();
  }

  private updateBaseScale(): void {
    this.baseScale = this.pillW > this.maxW ? this.maxW / this.pillW : 1;
    this.scale.set(this.baseScale);
  }

  private redrawDot(alpha: number): void {
    this.dot.clear();
    this.dot.circle(0, 0, 5.5).fill({ color: this.accentColor, alpha: alpha * 0.25 });
    this.dot.circle(0, 0, 3.2).fill({ color: this.accentColor, alpha: 0.95 });
  }

  public tick(deltaMS: number): void {
    if (!this.visible) return;
    this.pulse += deltaMS * 0.004;
    const wave = 0.55 + 0.45 * Math.sin(this.pulse);
    this.redrawDot(wave);
  }
}

/**
 * Cinta discreta de aviso en escritorio (ganador de baza / cambio de Mano).
 */
export class CenterBannerToast extends Container {
  private bg: Graphics;
  private titleTxt: Text;
  private subTxt: Text;
  private timerMs = 0;

  constructor() {
    super();
    this.bg = new Graphics();
    this.titleTxt = new Text({
      text: "",
      style: {
        fontFamily: FONT_DISPLAY,
        fontSize: 15,
        fontWeight: "700",
        fill: PALETTE.ivory,
      },
    });
    this.titleTxt.anchor.set(0.5);

    this.subTxt = new Text({
      text: "",
      style: {
        fontFamily: FONT_UI,
        fontSize: 11,
        fontWeight: "600",
        fill: PALETTE.inkSecondary,
      },
    });
    this.subTxt.anchor.set(0.5);

    this.addChild(this.bg, this.titleTxt, this.subTxt);
    this.visible = false;
  }

  public show(
    title: string,
    subtitle = "",
    accentColor: number = PALETTE.brass,
    durationMs = 1300,
  ): void {
    this.titleTxt.text = title;
    this.subTxt.text = subtitle;
    this.subTxt.visible = subtitle.length > 0;

    const w = Math.max(196, Math.max(this.titleTxt.width, this.subTxt.width) + 38);
    const h = subtitle ? 52 : 36;
    this.titleTxt.position.set(0, subtitle ? -8 : 0);
    this.subTxt.position.set(0, 11);

    this.bg.clear();
    this.bg
      .roundRect(-w / 2, -h / 2 + 2, w, h, 11)
      .fill({ color: 0x000000, alpha: 0.36 });
    this.bg
      .roundRect(-w / 2, -h / 2, w, h, 11)
      .fill({ color: PALETTE.surfaceCard, alpha: 0.96 })
      .stroke({ width: 1.4, color: accentColor, alpha: 0.88 });

    this.visible = true;
    this.alpha = 1;
    this.timerMs = durationMs;
  }

  public tick(deltaMS: number): void {
    if (!this.visible || this.timerMs <= 0) return;
    this.timerMs -= deltaMS;
    if (this.timerMs <= 300) {
      this.alpha = Math.max(0, this.timerMs / 300);
    }
    if (this.timerMs <= 0) {
      this.visible = false;
    }
  }
}

interface SparkleParticle {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

/**
 * Destellos geométricos sutiles en latón y marfil (sin confeti genérico).
 */
export class SparkleSystem extends Container {
  private particles: SparkleParticle[] = [];

  public burst(x: number, y: number, color: number = PALETTE.brassLight, count = 12): void {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const speed = 42 + Math.random() * 76;
      const size = 2.6 + Math.random() * 2.8;
      const g = new Graphics();
      g.poly([0, -size, size * 0.65, 0, 0, size, -size * 0.65, 0]).fill(color);
      g.position.set(x, y);
      this.addChild(g);

      const maxLife = 420 + Math.random() * 260;
      this.particles.push({
        g,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 18,
        life: maxLife,
        maxLife,
      });
    }
  }

  public tick(deltaMS: number): void {
    const dt = deltaMS / 1000;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= deltaMS;
      if (p.life <= 0) {
        this.removeChild(p.g);
        p.g.destroy();
        this.particles.splice(i, 1);
        continue;
      }
      p.g.x += p.vx * dt;
      p.g.y += p.vy * dt;
      p.vy += 95 * dt;
      const t = p.life / p.maxLife;
      p.g.alpha = t;
      p.g.scale.set(0.45 + 0.55 * t);
    }
  }
}

/**
 * Marcador de piedras integrado en la barra superior unificada.
 * - Compacto (móvil): bloque limpio inline "NOS 0  ·  0 ELLOS" con corona vectorial de Mano.
 * - Escritorio: marcador con piedras físicas agrupadas en filas de 6.
 */
export class StoneScoreboard extends Container {
  private bg: Graphics;
  private dotsG: Graphics;
  private crownG: Graphics;
  private playerLabel: Text;
  private cpuLabel: Text;
  private playerScoreTxt: Text;
  private cpuScoreTxt: Text;
  private metaTxt: Text;
  private compact = false;

  private lastScores: Record<TeamId, number> = { nosotros: 0, ellos: 0 };
  private lastTarget: 12 | 24 = 24;
  private lastManoTeam: TeamId = "nosotros";
  private lastActiveTeam: TeamId | null = null;
  private lastMode: GameMode = "1v1";
  private lastCustomLabels?: { nosotros?: string; ellos?: string };

  constructor() {
    super();
    this.bg = new Graphics();
    this.dotsG = new Graphics();
    this.crownG = new Graphics();

    this.playerLabel = new Text({
      text: "TÚ",
      style: {
        fontFamily: FONT_UI,
        fontSize: 10.5,
        fontWeight: "800",
        letterSpacing: 0.8,
        fill: PALETTE.inkSecondary,
      },
    });
    this.cpuLabel = new Text({
      text: "CPU",
      style: {
        fontFamily: FONT_UI,
        fontSize: 10.5,
        fontWeight: "800",
        letterSpacing: 0.8,
        fill: PALETTE.inkSecondary,
      },
    });

    this.playerScoreTxt = new Text({
      text: "0",
      style: {
        fontFamily: FONT_DISPLAY,
        fontSize: 19,
        fontWeight: "700",
        fill: PALETTE.ivory,
      },
    });
    this.cpuScoreTxt = new Text({
      text: "0",
      style: {
        fontFamily: FONT_DISPLAY,
        fontSize: 19,
        fontWeight: "700",
        fill: PALETTE.ivory,
      },
    });

    this.metaTxt = new Text({
      text: "/24",
      style: {
        fontFamily: FONT_UI,
        fontSize: 9.5,
        fontWeight: "700",
        fill: PALETTE.inkMuted,
      },
    });

    this.addChild(
      this.bg,
      this.dotsG,
      this.crownG,
      this.playerLabel,
      this.cpuLabel,
      this.playerScoreTxt,
      this.cpuScoreTxt,
      this.metaTxt,
    );
  }

  public setCompact(compact: boolean): void {
    if (this.compact === compact) return;
    this.compact = compact;
    this.redraw();
  }

  public update(
    scores: Record<TeamId, number>,
    targetScore: 12 | 24,
    manoTeam: TeamId,
    activeTeam: TeamId | null = null,
    mode: GameMode = "1v1",
    customLabels?: { nosotros?: string; ellos?: string },
  ): void {
    this.lastScores = { ...scores };
    this.lastTarget = targetScore;
    this.lastManoTeam = manoTeam;
    this.lastActiveTeam = activeTeam;
    this.lastMode = mode;
    this.lastCustomLabels = customLabels;
    this.redraw();
  }

  private redraw(): void {
    const scores = this.lastScores;
    const targetScore = this.lastTarget;
    const manoTeam = this.lastManoTeam;
    const activeTeam = this.lastActiveTeam;
    const is2v2 = this.lastMode === "2v2";

    this.bg.clear();
    this.dotsG.clear();
    this.crownG.clear();

    if (this.compact) {
      // Marcador compacto integrado en la barra superior (148 × 38)
      const w = 148;
      const h = 38;
      this.bg
        .roundRect(0, 0, w, h, 9)
        .fill({ color: PALETTE.surfaceRecessed, alpha: 0.92 })
        .stroke({ width: 1, color: PALETTE.borderSubtle, alpha: 0.9 });

      // Divisor vertical sutil
      this.bg
        .moveTo(w / 2, 6)
        .lineTo(w / 2, h - 6)
        .stroke({ width: 1, color: PALETTE.borderSubtle, alpha: 0.7 });

      // Indicador sutil del equipo activo
      if (activeTeam === "nosotros") {
        this.bg
          .roundRect(2, 2, w / 2 - 4, h - 4, 7)
          .fill({ color: PALETTE.accept, alpha: 0.22 });
      } else if (activeTeam === "ellos") {
        this.bg
          .roundRect(w / 2 + 2, 2, w / 2 - 4, h - 4, 7)
          .fill({ color: PALETTE.crimson, alpha: 0.24 });
      }

      const oppShort = this.lastCustomLabels?.ellos
        ? this.lastCustomLabels.ellos.slice(0, 6).toUpperCase()
        : is2v2
          ? "ELLOS"
          : "CPU";
      const ourShort = this.lastCustomLabels?.nosotros
        ? this.lastCustomLabels.nosotros.slice(0, 5).toUpperCase()
        : is2v2
          ? "NOS"
          : "TÚ";

      this.playerLabel.text = ourShort;
      this.playerLabel.style.fontSize = 9.5;
      this.playerLabel.style.fill =
        activeTeam === "nosotros" ? PALETTE.acceptBorder : PALETTE.inkMuted;
      this.playerLabel.position.set(10, 6);

      this.playerScoreTxt.text = `${scores.nosotros}`;
      this.playerScoreTxt.style.fontSize = 17;
      this.playerScoreTxt.style.fill = PALETTE.ivory;
      this.playerScoreTxt.position.set(10, 16);

      this.cpuLabel.text = oppShort;
      this.cpuLabel.style.fontSize = 9.5;
      this.cpuLabel.style.fill =
        activeTeam === "ellos" ? PALETTE.crimsonBorder : PALETTE.inkMuted;
      this.cpuLabel.position.set(w / 2 + 10, 6);

      this.cpuScoreTxt.text = `${scores.ellos}`;
      this.cpuScoreTxt.style.fontSize = 17;
      this.cpuScoreTxt.style.fill = PALETTE.ivory;
      this.cpuScoreTxt.position.set(w / 2 + 10, 16);

      // Corona vectorial discreta en el equipo Mano
      const crownX = manoTeam === "nosotros" ? w / 2 - 12 : w - 12;
      drawIconDiamondCrown(this.crownG, 8.5, PALETTE.brass);
      this.crownG.position.set(crownX, 11);

      this.metaTxt.text = `/${targetScore}`;
      this.metaTxt.style.fontSize = 8.5;
      this.metaTxt.position.set(w - 22, 23);
      return;
    }

    // Escritorio: marcador integrado con piedras físicas agrupadas en pares de 6
    const w = 276;
    const h = 46;
    this.bg
      .roundRect(0, 0, w, h, 10)
      .fill({ color: PALETTE.surfaceRecessed, alpha: 0.92 })
      .stroke({ width: 1, color: PALETTE.borderSubtle, alpha: 0.9 });

    if (activeTeam === "nosotros") {
      this.bg
        .roundRect(2, 2, w - 4, h / 2 - 2, 7)
        .fill({ color: PALETTE.accept, alpha: 0.16 });
    } else if (activeTeam === "ellos") {
      this.bg
        .roundRect(2, h / 2, w - 4, h / 2 - 2, 7)
        .fill({ color: PALETTE.crimson, alpha: 0.18 });
    }

    const ourLabel = this.lastCustomLabels?.nosotros
      ? this.lastCustomLabels.nosotros.slice(0, 6).toUpperCase()
      : is2v2
        ? "NOS"
        : "TÚ";
    const oppLabel = this.lastCustomLabels?.ellos
      ? this.lastCustomLabels.ellos.slice(0, 6).toUpperCase()
      : is2v2
        ? "ELLOS"
        : "CPU";

    this.playerLabel.text = ourLabel;
    this.playerLabel.style.fontSize = 10;
    this.playerLabel.style.fill =
      activeTeam === "nosotros" ? PALETTE.acceptBorder : PALETTE.inkSecondary;
    this.playerLabel.position.set(12, 6);

    this.playerScoreTxt.text = `${scores.nosotros}`;
    this.playerScoreTxt.style.fontSize = 14;
    this.playerScoreTxt.style.fill = PALETTE.ivory;
    this.playerScoreTxt.position.set(66, 3);

    this.cpuLabel.text = oppLabel;
    this.cpuLabel.style.fontSize = 10;
    this.cpuLabel.style.fill =
      activeTeam === "ellos" ? PALETTE.crimsonBorder : PALETTE.inkSecondary;
    this.cpuLabel.position.set(12, 27);

    this.cpuScoreTxt.text = `${scores.ellos}`;
    this.cpuScoreTxt.style.fontSize = 14;
    this.cpuScoreTxt.style.fill = PALETTE.ivory;
    this.cpuScoreTxt.position.set(66, 24);

    // Corona vectorial de Mano (bien separada de "ELLOS")
    drawIconDiamondCrown(this.crownG, 8.5, PALETTE.brass);
    this.crownG.position.set(55, manoTeam === "nosotros" ? 12 : 33);

    this.metaTxt.text = `/${targetScore}`;
    this.metaTxt.style.fontSize = 9;
    this.metaTxt.position.set(90, 17);

    // Piedras agrupadas (12 o 24 en 2 filas compactas de 12 con separación visual cada 6)
    const drawStones = (count: number, baseY: number, fillColor: number) => {
      const total = targetScore;
      const perRow = 12;
      const startX = 118;
      const rows = total === 24 ? 2 : 1;
      for (let i = 0; i < total; i++) {
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        const groupGap = col >= 6 ? 5 : 0;
        const x = startX + col * 11.5 + groupGap;
        const y = rows === 2 ? baseY + row * 7.5 : baseY + 3.5;
        const filled = i < count;
        this.dotsG.circle(x, y, filled ? 2.8 : 2.1).fill({
          color: filled ? fillColor : 0xffffff,
          alpha: filled ? 0.96 : 0.14,
        });
      }
    };

    drawStones(scores.nosotros, 8, PALETTE.brass);
    drawStones(scores.ellos, 29, PALETTE.crimsonBorder);
  }
}

/**
 * Modal de Reglas del Truco Venezolano — estética editorial sobria.
 */
export class RulesModal extends Container {
  private backdrop: Graphics;
  private card: Container;
  private bg: Graphics;
  private titleTxt: Text;
  private bodyTxt: Text;
  private closeBtn: PillButton;

  constructor(onClose: () => void) {
    super();
    this.visible = false;

    this.backdrop = new Graphics();
    this.backdrop.eventMode = "static";
    this.backdrop.on("pointertap", onClose);
    this.addChild(this.backdrop);

    this.card = new Container();
    this.card.eventMode = "static";
    this.addChild(this.card);

    this.bg = new Graphics();
    this.card.addChild(this.bg);

    this.titleTxt = new Text({
      text: "Reglas del Truco Venezolano",
      style: {
        fontFamily: FONT_DISPLAY,
        fontSize: 20,
        fontWeight: "700",
        fill: PALETTE.brassLight,
      },
    });
    this.titleTxt.anchor.set(0.5, 0);
    this.card.addChild(this.titleTxt);

    const bodyText = [
      "• LA VIRA Y PIEZAS: La carta bajo el mazo define el palo de triunfo. El 11 de ese palo es el PERICO (carta suprema) y el 10 es la PERICA. Si la Vira es 11 o 10, el Rey (12) toma su lugar.",
      "",
      "• JERARQUÍA DEL TRUCO: Perico > Perica > 1 Espadas (Espadilla) > 1 Bastos (Bastillo) > 7 Espadas > 7 Oros > 3 > 2 > 1 Copas/Oros > 12 > 11 > 10 > 7 Copas/Bastos > 6 > 5 > 4.",
      "",
      "• ESCALADA DEL TRUCO: Sin truco (1) · Truco (3) · Retruco (6) · Vale Nueve (9) · Vale Juego. No querer paga el nivel anterior.",
      "",
      "• ENVIDO (solo 1.ª baza, antes de aceptar Truco): 2 cartas del mismo palo suman 20 + sus valores (figuras valen 0). Perico = 30 y Perica = 29 como comodines. Se resuelve y presenta al final de la mano.",
      "",
      "• FLOR (anula Envido): 3 del mismo palo o 2 + Perico/Perica (3 piedras; Contraflor = 6). FLOR RESERVADA (Perico + Perica) = 5 piedras: nunca se canta «Flor Reservada» (se guarda callada hasta el final o se responde «¡Flor!» / «¡Contraflor!»).",
      "",
      "• CANTOS DE «A LEY» (quien no es Pie, 1.ª baza): Permite guardar Flor hasta antes de tu 2.ª carta o engañar sin tenerla.",
      "",
      "• BAZA PARDA: Empate da ventaja a quien ganó la 1.ª baza. Si la 1.ª es parda, decide la 2.ª. Triple parda gana la Mano.",
    ].join("\n");

    this.bodyTxt = new Text({
      text: bodyText,
      style: {
        fontFamily: FONT_UI,
        fontSize: 12,
        lineHeight: 17.5,
        fill: PALETTE.inkLight,
        wordWrap: true,
        wordWrapWidth: 520,
      },
    });
    this.card.addChild(this.bodyTxt);

    this.closeBtn = new PillButton({
      label: "Entendido",
      width: 154,
      height: 44,
      theme: "primary",
      onClick: onClose,
    });
    this.card.addChild(this.closeBtn);
  }

  public layout(width: number, height: number): void {
    this.backdrop.clear();
    this.backdrop.rect(0, 0, width, height).fill({ color: 0x040d09, alpha: 0.78 });

    const isNarrow = width < 620;
    const cardW = isNarrow ? Math.min(366, width - 24) : 574;
    this.titleTxt.style.fontSize = isNarrow ? 17 : 21;
    this.bodyTxt.style.fontSize = isNarrow ? 11.5 : 12.2;
    this.bodyTxt.style.lineHeight = isNarrow ? 16.5 : 18;
    this.bodyTxt.style.wordWrapWidth = cardW - 40;

    const cardH = Math.min(height - 32, Math.max(400, this.bodyTxt.height + 132));

    this.bg.clear();
    this.bg
      .roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 16)
      .fill(PALETTE.surfaceCard)
      .stroke({ width: 1.5, color: PALETTE.brass, alpha: 0.8 });

    this.titleTxt.position.set(0, -cardH / 2 + 20);
    this.bodyTxt.position.set(-cardW / 2 + 20, -cardH / 2 + 54);
    this.closeBtn.position.set(0, cardH / 2 - 36);

    this.card.position.set(width / 2, height / 2);
  }
}

const WHISPER_TONE_ACCENT: Record<PartnerAdviceTone, number> = {
  strong: PALETTE.acceptBorder,
  flor: PALETTE.brass,
  medium: PALETTE.brassLight,
  weak: PALETTE.crimsonBorder,
  info: PALETTE.inkSecondary,
};

/**
 * Nota discreta de comunicación de pareja (2 vs 2).
 * Filete lateral de color + ícono vectorial propio, cero emojis y cero borde neón.
 */
export class PartnerWhisperPill extends Container {
  private bg: Graphics;
  private iconG: Graphics;
  private tagTxt: Text;
  private txt: Text;
  private hideTimerMs = 0;
  private sticky = false;
  private maxW = 360;

  constructor() {
    super();
    this.eventMode = "none";
    this.interactiveChildren = false;
    this.bg = new Graphics();
    this.iconG = new Graphics();
    this.tagTxt = new Text({
      text: "COMP.",
      style: {
        fontFamily: FONT_UI,
        fontSize: 9.5,
        fontWeight: "800",
        letterSpacing: 0.7,
        fill: PALETTE.brassLight,
      },
    });
    this.tagTxt.anchor.set(0, 0.5);

    this.txt = new Text({
      text: "",
      style: {
        fontFamily: FONT_UI,
        fontSize: 12,
        fontWeight: "700",
        fill: PALETTE.inkLight,
      },
    });
    this.txt.anchor.set(0, 0.5);

    this.addChild(this.bg, this.iconG, this.tagTxt, this.txt);
    this.visible = false;
  }

  public setMaxWidth(maxW: number): void {
    this.maxW = Math.max(180, maxW);
    if (this.visible) {
      this.applyFitScale();
    }
  }

  public show(msg: PartnerMessage, durationMs = 0): void {
    const accent = WHISPER_TONE_ACCENT[msg.tone];
    this.tagTxt.style.fill = accent;
    this.txt.text = msg.headline;

    const iconSpace = 22;
    const contentW = iconSpace + this.tagTxt.width + 8 + this.txt.width;
    const w = Math.max(156, contentW + 28);
    const h = 32;
    const leftX = -w / 2;

    this.bg.clear();
    this.bg
      .roundRect(leftX, -h / 2 + 2, w, h, 10)
      .fill({ color: 0x000000, alpha: 0.34 });
    this.bg
      .roundRect(leftX, -h / 2, w, h, 10)
      .fill({ color: PALETTE.surfaceCard, alpha: 0.96 })
      .stroke({ width: 1.2, color: PALETTE.borderMuted, alpha: 0.9 });
    // Filete lateral izquierdo con color de tono
    this.bg
      .roundRect(leftX + 1.5, -h / 2 + 4, 3.5, h - 8, 2)
      .fill(accent);

    this.iconG.clear();
    drawIconPartner(this.iconG, 14, accent);
    this.iconG.position.set(leftX + 18, 0);

    this.tagTxt.position.set(leftX + 30, 0);
    this.txt.position.set(leftX + 30 + this.tagTxt.width + 8, 0);

    this.visible = true;
    this.alpha = 1;
    this.sticky = durationMs <= 0;
    this.hideTimerMs = this.sticky ? 0 : durationMs;
    this.applyFitScale();
  }

  public isSticky(): boolean {
    return this.sticky && this.visible;
  }

  public hide(): void {
    this.visible = false;
    this.sticky = false;
    this.hideTimerMs = 0;
  }

  public tick(deltaMS: number): void {
    if (!this.visible || this.sticky || this.hideTimerMs <= 0) return;
    this.hideTimerMs -= deltaMS;
    if (this.hideTimerMs <= 420) {
      this.alpha = Math.max(0, this.hideTimerMs / 420);
    }
    if (this.hideTimerMs <= 0) {
      this.visible = false;
    }
  }

  private applyFitScale(): void {
    const contentW = 22 + this.tagTxt.width + 8 + this.txt.width + 28;
    const rawW = Math.max(156, contentW);
    const s = rawW > this.maxW ? this.maxW / rawW : 1;
    this.scale.set(s);
  }
}

export interface PartnerCommDrawerCallbacks {
  onQuery: (query: PartnerQueryType) => void;
  onCommand: (command: PartnerCommandType) => void;
  onClose: () => void;
}

/**
 * Panel flotante de comunicación rápida con el Compañero (2 vs 2).
 * Estética sobria, targets táctiles >= 42px y cero emojis.
 */
export class PartnerCommDrawer extends Container {
  private scrim: Graphics;
  private card: Container;
  private bg: Graphics;
  private titleTxt: Text;
  private closeBtn: PillButton;
  private readoutBg: Graphics;
  private readoutTitle: Text;
  private readoutDetail: Text;
  private askLabel: Text;
  private tellLabel: Text;
  private askBtns: PillButton[] = [];
  private tellBtns: PillButton[] = [];
  private envidoClaimBtn!: PillButton;

  private lastW = 390;
  private lastAccent: number = PALETTE.borderMuted;

  constructor(callbacks: PartnerCommDrawerCallbacks) {
    super();
    this.visible = false;

    this.scrim = new Graphics();
    this.scrim.eventMode = "static";
    this.scrim.on("pointertap", () => callbacks.onClose());
    this.addChild(this.scrim);

    this.card = new Container();
    this.card.eventMode = "static";
    this.addChild(this.card);

    this.bg = new Graphics();
    this.card.addChild(this.bg);

    this.titleTxt = new Text({
      text: "Comunicación con Compañero",
      style: {
        fontFamily: FONT_DISPLAY,
        fontSize: 16,
        fontWeight: "700",
        fill: PALETTE.brassLight,
      },
    });
    this.titleTxt.anchor.set(0, 0.5);
    this.card.addChild(this.titleTxt);

    this.closeBtn = new PillButton({
      width: 36,
      height: 36,
      radius: 9,
      theme: "ghost",
      drawIcon: (g, col) => drawIconClose(g, 15, col),
      onClick: callbacks.onClose,
    });
    this.card.addChild(this.closeBtn);

    this.readoutBg = new Graphics();
    this.readoutTitle = new Text({
      text: "Consulta antes de cantar o responder",
      style: {
        fontFamily: FONT_UI,
        fontSize: 13,
        fontWeight: "700",
        fill: PALETTE.inkLight,
        align: "center",
        wordWrap: true,
        wordWrapWidth: 310,
      },
    });
    this.readoutTitle.anchor.set(0.5);

    this.readoutDetail = new Text({
      text: "Si cantan Envido, pregunta aquí para saber si querer o no.",
      style: {
        fontFamily: FONT_UI,
        fontSize: 11,
        fontWeight: "500",
        fill: PALETTE.inkSecondary,
        align: "center",
        wordWrap: true,
        wordWrapWidth: 310,
      },
    });
    this.readoutDetail.anchor.set(0.5);
    this.card.addChild(this.readoutBg, this.readoutTitle, this.readoutDetail);

    this.askLabel = new Text({
      text: "PREGUNTAR",
      style: {
        fontFamily: FONT_UI,
        fontSize: 9.5,
        fontWeight: "800",
        letterSpacing: 1.0,
        fill: PALETTE.inkMuted,
      },
    });
    this.askLabel.anchor.set(0.5);

    this.tellLabel = new Text({
      text: "SEÑAL TÁCTICA",
      style: {
        fontFamily: FONT_UI,
        fontSize: 9.5,
        fontWeight: "800",
        letterSpacing: 1.0,
        fill: PALETTE.inkMuted,
      },
    });
    this.tellLabel.anchor.set(0.5);
    this.card.addChild(this.askLabel, this.tellLabel);

    const askSpecs: Array<{ label: string; theme: ButtonTheme; q: PartnerQueryType }> = [
      { label: "¿Envido?", theme: "primary", q: "envido" },
      { label: "¿Señas?", theme: "secondary", q: "senas" },
      { label: "¿Truco?", theme: "secondary", q: "truco" },
    ];
    for (const sp of askSpecs) {
      const btn = new PillButton({
        label: sp.label,
        width: 104,
        height: 44,
        fontSize: 13,
        radius: 10,
        theme: sp.theme,
        onClick: () => callbacks.onQuery(sp.q),
      });
      this.askBtns.push(btn);
      this.card.addChild(btn);
    }

    this.envidoClaimBtn = new PillButton({
      label: "Avisar Envido",
      width: 108,
      height: 44,
      fontSize: 12,
      radius: 10,
      theme: "ghost",
      onClick: () => callbacks.onCommand("tengo_envido"),
    });
    const mataBtn = new PillButton({
      label: "Mata tú",
      width: 100,
      height: 44,
      fontSize: 12.5,
      radius: 10,
      theme: "ghost",
      onClick: () => callbacks.onCommand("mata_tu"),
    });
    const bajaBtn = new PillButton({
      label: "Tira baja",
      width: 100,
      height: 44,
      fontSize: 12.5,
      radius: 10,
      theme: "ghost",
      onClick: () => callbacks.onCommand("tira_baja"),
    });
    this.tellBtns = [this.envidoClaimBtn, mataBtn, bajaBtn];
    this.card.addChild(this.envidoClaimBtn, mataBtn, bajaBtn);
  }

  public updateContext(
    playerEnvidoPts: number,
    lastMsg: PartnerMessage | null,
    canSendEnvidoClaim: boolean,
  ): void {
    this.envidoClaimBtn.setLabel(
      playerEnvidoPts >= 28 ? `Tengo ${playerEnvidoPts}` : `Sin Env (${playerEnvidoPts})`,
    );
    this.envidoClaimBtn.setEnabled(canSendEnvidoClaim);

    if (lastMsg) {
      const accent = WHISPER_TONE_ACCENT[lastMsg.tone];
      this.readoutTitle.text = lastMsg.headline;
      this.readoutDetail.text = lastMsg.detail;
      this.redrawReadoutBox(accent);
    } else {
      this.readoutTitle.text = "Consulta antes de cantar o responder";
      this.readoutDetail.text = "Si cantan Envido, toca «¿Envido?» para saber si querer o no.";
      this.redrawReadoutBox(PALETTE.borderMuted);
    }
  }

  private redrawReadoutBox(accentColor: number): void {
    this.lastAccent = accentColor;
    const isNarrow = this.lastW < 520;
    const cardW = isNarrow ? Math.min(362, this.lastW - 22) : 416;
    const boxW = cardW - 28;
    const boxH = 64;
    const boxY = -54;
    this.readoutBg.clear();
    this.readoutBg
      .roundRect(-boxW / 2, boxY - boxH / 2, boxW, boxH, 10)
      .fill(PALETTE.surfaceRecessed)
      .stroke({ width: 1.2, color: PALETTE.borderSubtle, alpha: 0.9 });
    this.readoutBg
      .roundRect(-boxW / 2 + 2, boxY - boxH / 2 + 8, 3.5, boxH - 16, 2)
      .fill(accentColor);
  }

  public layout(width: number, height: number): void {
    this.lastW = width;

    this.scrim.clear();
    this.scrim.rect(0, 0, width, height).fill({ color: 0x040d09, alpha: 0.56 });

    const isNarrow = width < 520;
    const cardW = isNarrow ? Math.min(362, width - 22) : 416;
    const cardH = 290;
    const scale = Math.min(1, (width - 18) / cardW);

    this.bg.clear();
    this.bg
      .roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 16)
      .fill({ color: PALETTE.surfaceCard, alpha: 0.98 })
      .stroke({ width: 1.5, color: PALETTE.brass, alpha: 0.78 });

    this.titleTxt.style.fontSize = isNarrow ? 15 : 16.5;
    this.titleTxt.position.set(-cardW / 2 + 18, -cardH / 2 + 28);
    this.closeBtn.position.set(cardW / 2 - 28, -cardH / 2 + 28);

    const wrapW = cardW - 48;
    this.readoutTitle.style.wordWrapWidth = wrapW;
    this.readoutDetail.style.wordWrapWidth = wrapW;
    this.readoutTitle.position.set(0, -68);
    this.readoutDetail.position.set(0, -40);
    this.redrawReadoutBox(this.lastAccent);

    this.askLabel.position.set(0, -2);
    const spread = (cardW - 32) / 3;
    const btnScale = isNarrow ? Math.min(1, (spread - 6) / 108) : 1;
    this.askBtns.forEach((btn, idx) => {
      btn.scale.set(btnScale);
      btn.position.set((idx - 1) * spread, 30);
    });

    this.tellLabel.position.set(0, 74);
    this.tellBtns.forEach((btn, idx) => {
      btn.scale.set(btnScale);
      btn.position.set((idx - 1) * spread, 106);
    });

    const targetY = isNarrow ? Math.min(height - 236, height * 0.54) : height - 252;
    this.card.position.set(width / 2, Math.max(cardH / 2 + 20, targetY));
    this.card.scale.set(scale);
  }
}
