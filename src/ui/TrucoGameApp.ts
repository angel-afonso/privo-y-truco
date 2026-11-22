import {
  Application,
  Container,
  FillGradient,
  Graphics,
  Text,
  TilingSprite,
} from "pixi.js";
import { decideBotAction } from "../engine/ai";
import {
  calculateEnvidoPoints,
  evaluateFlor,
  getCardName,
  getCardTrucoPower,
  getEnvidoCards,
  getPartnerSignal,
  getPericaSpec,
  getPericoSpec,
  getTrucoAcceptPoints,
} from "../engine/evaluator";
import { TrucoEngine } from "../engine/gameEngine";
import {
  answerPartnerQuery,
  buildAutoPartnerCallout,
  handlePartnerCommand,
  PartnerCommandType,
  PartnerMessage,
  PartnerQueryType,
  PartnerTacticalHint,
} from "../engine/partnerComms";
import {
  GameConfig,
  getPlayerLabel,
  getPlayerTeam,
  getTeamLabel,
  PlayerAction,
  PlayerId,
  SUIT_NAMES,
  TRUCO_LEVEL_NAMES,
  TrucoLevel,
} from "../engine/types";
import { CARD_WIDTH, CardView, createCardBackGraphics } from "./cardRenderer";
import {
  ButtonTheme,
  CenterBannerToast,
  PartnerCommDrawer,
  PartnerWhisperPill,
  PillButton,
  RulesModal,
  SegmentedToggle,
  SparkleSystem,
  SpeechBubble,
  StoneScoreboard,
  TurnSpotlightPill,
} from "./components";
import {
  drawIconDiamondCrown,
  drawIconFlor,
  drawIconHelp,
  drawIconMenu,
  drawIconPartner,
  drawIconSound,
} from "./icons";
import { soundFX } from "./sound";
import { FONT_DISPLAY, FONT_UI, getFeltGrainTexture, PALETTE } from "./theme";
import { Easing, TweenManager } from "./tween";
import { pendingActionLabel, previewPlayerAction } from "../multiplayer/optimisticAction";
import { isHiddenCardId } from "../multiplayer/perspective";
import {
  SafeViewerSyncPayload,
  TeamWhisperPayload,
  TrucoRoomClient,
} from "../multiplayer/roomClient";
import { PersistedHostSnapshot } from "../multiplayer/sessionStore";
import { MultiplayerLobby } from "./multiplayerLobby";

const BOT_REPLY_MS = 260;
const BOT_OPENING_MS = 380;

interface SeatBadge {
  container: Container;
  bg: Graphics;
  txt: Text;
}

export class TrucoGameApp {
  private app: Application;
  private engine: TrucoEngine;
  private tweens = new TweenManager();

  // Layers
  private tableLayer = new Container();
  private deckLayer = new Container();
  private arenaLayer = new Container();
  private cardsLayer = new Container();
  private hudLayer = new Container();
  private fxLayer = new Container();
  private bubbleLayer = new Container();
  private overlayLayer = new Container();

  // Table graphics
  private tableBg = new Graphics();
  private feltGrainSprite: TilingSprite;
  private arenaSlotsG = new Graphics();
  private trickDotsG = new Graphics();

  // Deck & Vira
  private deckGroup = new Container();
  private viraInfoBg = new Graphics();
  private viraInfoTxt: Text;

  // Unified top header bar, scoreboard & top controls
  private headerBarBg = new Graphics();
  private scoreboard = new StoneScoreboard();
  private stakePillTxt: Text;
  private topControls = new Container();
  private muteBtn!: PillButton;
  private lastCompactTopControls: boolean | null = null;

  // 2v2 seat badges (North=partner, East=cpu, West=cpu2) & Partner Comms
  private seatBadges: Record<"partner" | "cpu" | "cpu2", SeatBadge>;
  private partnerSignalText: string | null = null;
  private partnerWhisper = new PartnerWhisperPill();
  private partnerCommDrawer!: PartnerCommDrawer;
  private partnerCommBtn!: PillButton;
  private lastPartnerCommCompact: boolean | null = null;
  private lastPartnerMsg: PartnerMessage | null = null;
  private lastAutoCalloutKey: string | null = null;
  private partnerHint: PartnerTacticalHint = {};

  // Turn indicators, helper & action dock (sin barra negra redundante abajo)
  private turnPill = new TurnSpotlightPill();
  private centerToast = new CenterBannerToast();
  private sparkles = new SparkleSystem();
  private handHelperBg = new Graphics();
  private handHelperTxt: Text;
  private actionBar = new Container();

  // Speech bubbles per seat (cola orientada correctamente hacia cada jugador)
  private bubbles: Record<PlayerId, SpeechBubble> = {
    player: new SpeechBubble("down"),
    cpu: new SpeechBubble("down"),
    partner: new SpeechBubble("up"),
    cpu2: new SpeechBubble("down"),
  };

  // Active card views keyed by `${owner}_${cardId}`
  private cardViews = new Map<string, CardView>();
  private lastHandNumber = -1;
  private lastEventId = 0;

  // Modes & overlays
  private burnMode = false;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private isDealing = false;
  private dealTimers: Array<ReturnType<typeof setTimeout>> = [];
  private dealFxContainer = new Container();
  private inMenu = true;
  private menuConfig: GameConfig = {
    mode: "1v1",
    targetScore: 24,
    withFlor: true,
  };
  private menuOverlay = new Container();
  private summaryOverlay = new Container();
  private rulesModal!: RulesModal;

  // Multijugador Online (Supabase: Server Postgres/Edge o Realtime endurecido)
  private roomClient!: TrucoRoomClient;
  private mpLobby!: MultiplayerLobby;
  private hostEngine: TrucoEngine | null = null;
  private isOnlineMatch = false;
  private confirmedView: SafeViewerSyncPayload | null = null;
  private pendingAction: { id: string; label: string; timer: ReturnType<typeof setTimeout> } | null = null;
  private actionSequence = 0;
  private onlineHumanSeats = new Set<PlayerId>();
  private onlineOfflineSeats = new Set<PlayerId>();
  private onlineCanonicalHumanSeats = new Set<PlayerId>();
  private onlineSeatNames: Partial<Record<PlayerId, string>> = {};
  private onlineCanonicalSeatNames: Partial<Record<PlayerId, string>> = {};
  private onlineCanonicalSeatClientIds: Partial<Record<PlayerId, string>> = {};
  private onlineBotPartnerSignal: string | null = null;

  constructor(app: Application) {
    this.app = app;
    this.engine = new TrucoEngine(this.menuConfig);

    this.feltGrainSprite = new TilingSprite({
      texture: getFeltGrainTexture(),
      width: 100,
      height: 100,
    });
    this.feltGrainSprite.alpha = 0.055;

    this.viraInfoTxt = new Text({
      text: "",
      style: {
        fontFamily: FONT_UI,
        fontSize: 11,
        fontWeight: "600",
        align: "center",
        lineHeight: 15,
        fill: PALETTE.inkSecondary,
      },
    });
    this.viraInfoTxt.anchor.set(0.5);

    this.stakePillTxt = new Text({
      text: "",
      style: {
        fontFamily: FONT_UI,
        fontSize: 11.5,
        fontWeight: "700",
        letterSpacing: 0.3,
        fill: PALETTE.brassLight,
      },
    });
    this.stakePillTxt.anchor.set(0.5);

    this.handHelperTxt = new Text({
      text: "",
      style: {
        fontFamily: FONT_UI,
        fontSize: 12,
        fontWeight: "700",
        fill: PALETTE.inkLight,
      },
    });
    this.handHelperTxt.anchor.set(0.5);

    this.seatBadges = {
      partner: this.createSeatBadge(),
      cpu: this.createSeatBadge(),
      cpu2: this.createSeatBadge(),
    };
    this.seatBadges.partner.container.eventMode = "static";
    this.seatBadges.partner.container.cursor = "pointer";
    this.seatBadges.partner.container.on("pointertap", () => {
      if (this.canUsePartnerComms()) {
        this.togglePartnerCommDrawer();
      }
    });

    this.setupScene();
    this.buildTopControls(this.isCompactLayout());
    this.buildPartnerCommBtn(this.isCompactLayout());
    this.buildMenuOverlay();
    this.partnerCommDrawer = new PartnerCommDrawer({
      onQuery: (q) => this.handlePartnerQuery(q),
      onCommand: (cmd) => this.handlePartnerCommandAction(cmd),
      onClose: () => {
        this.partnerCommDrawer.visible = false;
      },
    });
    this.rulesModal = new RulesModal(() => {
      this.rulesModal.visible = false;
    });
    this.overlayLayer.addChild(
      this.menuOverlay,
      this.summaryOverlay,
      this.partnerCommDrawer,
      this.rulesModal,
    );

    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this.app.ticker.add((ticker) => {
      this.tweens.update(ticker.deltaMS);
      for (const b of Object.values(this.bubbles)) {
        b.tick(ticker.deltaMS);
      }
      this.partnerWhisper.tick(ticker.deltaMS);
      this.turnPill.tick(ticker.deltaMS);
      this.centerToast.tick(ticker.deltaMS);
      this.sparkles.tick(ticker.deltaMS);
    });

    this.app.renderer.on("resize", () => this.layout());
    this.setupMultiplayer();
    this.layout();
    this.showMenu();

    // 1) Si el enlace incluye ?sala=CODIGO, abrir el lobby con el código listo
    // 2) Si existe una sesión activa reciente en esta pestaña, reconectar automáticamente
    const savedSession = this.roomClient.getSavedSession();
    if (this.mpLobby.hasPendingUrlCode() && !savedSession) {
      this.mpLobby.open(this.menuConfig);
    } else if (savedSession) {
      if (!savedSession.inMatch) {
        this.mpLobby.open(savedSession.config);
      }
      void this.roomClient.tryAutoReconnect();
    }
  }

  private createSeatBadge(): SeatBadge {
    const container = new Container();
    container.eventMode = "none";
    container.interactiveChildren = false;
    container.visible = false;
    const bg = new Graphics();
    const txt = new Text({
      text: "",
      style: {
        fontFamily: FONT_UI,
        fontSize: 10,
        fontWeight: "800",
        letterSpacing: 0.7,
        fill: PALETTE.inkLight,
      },
    });
    txt.anchor.set(0.5);
    container.addChild(bg, txt);
    return { container, bg, txt };
  }

  private isCompactLayout(): boolean {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    return w < 780 || h > w * 1.05;
  }

  private is2v2(): boolean {
    return this.engine.getState().config.mode === "2v2";
  }

  private setupScene(): void {
    this.app.stage.addChild(
      this.tableLayer,
      this.deckLayer,
      this.arenaLayer,
      this.cardsLayer,
      this.hudLayer,
      this.fxLayer,
      this.bubbleLayer,
      this.overlayLayer,
    );

    this.tableLayer.addChild(this.tableBg, this.feltGrainSprite);
    this.arenaLayer.addChild(this.arenaSlotsG);
    this.arenaLayer.eventMode = "none";
    this.arenaLayer.interactiveChildren = false;
    this.cardsLayer.sortableChildren = true;

    this.deckLayer.addChild(this.deckGroup, this.viraInfoBg, this.viraInfoTxt);
    this.deckLayer.eventMode = "none";
    this.deckLayer.interactiveChildren = false;

    this.hudLayer.addChild(
      this.headerBarBg,
      this.scoreboard,
      this.stakePillTxt,
      this.trickDotsG,
      this.topControls,
      this.seatBadges.partner.container,
      this.seatBadges.cpu.container,
      this.seatBadges.cpu2.container,
      this.turnPill,
      this.handHelperBg,
      this.handHelperTxt,
      this.actionBar,
    );

    this.turnPill.eventMode = "none";
    this.turnPill.interactiveChildren = false;
    this.fxLayer.eventMode = "none";
    this.fxLayer.interactiveChildren = false;
    this.bubbleLayer.eventMode = "none";
    this.bubbleLayer.interactiveChildren = false;

    this.fxLayer.addChild(this.dealFxContainer, this.sparkles, this.centerToast);
    this.bubbleLayer.addChild(
      this.bubbles.player,
      this.bubbles.cpu,
      this.bubbles.partner,
      this.bubbles.cpu2,
      this.partnerWhisper,
    );
  }

  private buildPartnerCommBtn(compact: boolean): void {
    if (this.lastPartnerCommCompact === compact && this.partnerCommBtn) return;
    this.lastPartnerCommCompact = compact;
    if (this.partnerCommBtn) {
      this.hudLayer.removeChild(this.partnerCommBtn);
      this.partnerCommBtn.destroy({ children: true });
    }
    this.partnerCommBtn = new PillButton({
      label: compact ? "Comp." : "Compañero",
      width: compact ? 92 : 136,
      height: compact ? 40 : 38,
      fontSize: compact ? 12 : 12.5,
      radius: 10,
      theme: "secondary",
      drawIcon: (g, col) => drawIconPartner(g, 14, col),
      onClick: () => this.togglePartnerCommDrawer(),
    });
    this.partnerCommBtn.visible = this.canUsePartnerComms();
    this.hudLayer.addChild(this.partnerCommBtn);
  }

  private canUsePartnerComms(): boolean {
    if (this.inMenu || this.isDealing || !this.is2v2()) return false;
    const phase = this.engine.getState().phase;
    return (
      phase === "PLAYING" ||
      phase === "AWAITING_ENVIDO" ||
      phase === "AWAITING_TRUCO" ||
      phase === "AWAITING_FLOR"
    );
  }

  private togglePartnerCommDrawer(): void {
    if (!this.canUsePartnerComms()) {
      this.partnerCommDrawer.visible = false;
      return;
    }
    if (this.partnerCommDrawer.visible) {
      this.partnerCommDrawer.visible = false;
      return;
    }
    const s = this.engine.getState();
    const pPts = calculateEnvidoPoints(s.initialHands.player ?? [], s.vira);
    const canSendEnvidoClaim = !s.envido.resolved && s.trickIndex === 0;
    this.partnerCommDrawer.updateContext(pPts, this.lastPartnerMsg, canSendEnvidoClaim);
    this.partnerCommDrawer.visible = true;
  }

  private handlePartnerQuery(query: PartnerQueryType): void {
    if (!this.canUsePartnerComms()) return;
    const s = this.engine.getState();

    // En 2v2 online con compañero humano, enviarle la pregunta real por Supabase
    if (this.isOnlineMatch && this.onlineHumanSeats.has("partner")) {
      const promptMap: Record<PartnerQueryType, string> = {
        envido: "¿Tienes envido?",
        senas: "Pásame señas",
        truco: "¿Vamos al Truco?",
      };
      const outMsg: PartnerMessage = {
        headline: promptMap[query],
        detail: `Mensaje enviado a tu compañero.`,
        tone: "info",
      };
      void this.roomClient.sendTeamWhisper(outMsg);
      this.lastPartnerMsg = {
        headline: `Enviado: "${promptMap[query]}"`,
        detail: "Esperando respuesta de tu compañero.",
        tone: "info",
      };
      this.partnerWhisper.show(this.lastPartnerMsg, 3200);
      soundFX.playPartnerWhisper();
      this.partnerCommDrawer.visible = false;
      return;
    }

    // En 2v2 online con compañero bot, sus cartas llegan enmascaradas por anti-trampa
    if (
      this.isOnlineMatch &&
      (s.initialHands.partner ?? []).some((c) => isHiddenCardId(c.id))
    ) {
      const sig = this.onlineBotPartnerSignal;
      const msg: PartnerMessage = {
        headline: sig ? `Seña del bot: ${sig}` : "Sin señas fuertes esta mano",
        detail: "En partidas online las cartas del compañero bot se mantienen ocultas en el servidor.",
        tone: sig ? "medium" : "info",
      };
      this.lastPartnerMsg = msg;
      this.partnerWhisper.show(msg, 4200);
      soundFX.playPartnerWhisper();
      this.partnerCommDrawer.visible = false;
      return;
    }

    const msg = answerPartnerQuery(s, query);
    this.lastPartnerMsg = msg;
    const keepSticky =
      s.phase === "AWAITING_ENVIDO" ||
      s.phase === "AWAITING_TRUCO" ||
      s.phase === "AWAITING_FLOR";
    this.partnerWhisper.show(msg, keepSticky ? 0 : 4800);
    soundFX.playPartnerWhisper();
    this.partnerCommDrawer.visible = false;
  }

  private handlePartnerCommandAction(cmd: PartnerCommandType): void {
    if (!this.canUsePartnerComms()) return;
    const s = this.engine.getState();

    // En 2v2 online con compañero humano, enviar la señal táctica real por Supabase
    if (this.isOnlineMatch && this.onlineHumanSeats.has("partner")) {
      const pPts = calculateEnvidoPoints(s.initialHands.player ?? [], s.vira);
      const textMap: Record<PartnerCommandType, { headline: string; tone: PartnerMessage["tone"] }> = {
        tengo_envido:
          pPts >= 28
            ? { headline: `Tengo ${pPts} de envido`, tone: "strong" }
            : { headline: `No ligo envido (${pPts})`, tone: "weak" },
        mata_tu: { headline: "Mata tú esta baza", tone: "medium" },
        tira_baja: { headline: "Tira baja en esta baza", tone: "info" },
      };
      const spec = textMap[cmd];
      void this.roomClient.sendTeamWhisper({
        headline: spec.headline,
        detail: spec.headline,
        tone: spec.tone,
      });
      this.lastPartnerMsg = {
        headline: `Enviado: "${spec.headline}"`,
        detail: "Señal enviada a tu compañero.",
        tone: spec.tone,
      };
      this.partnerWhisper.show(this.lastPartnerMsg, 3200);
      soundFX.playPartnerWhisper();
      this.partnerCommDrawer.visible = false;
      return;
    }

    const { message, hintUpdate } = handlePartnerCommand(s, cmd);
    this.partnerHint = { ...this.partnerHint, ...hintUpdate };
    this.lastPartnerMsg = message;
    this.partnerWhisper.show(message, 4200);
    soundFX.playPartnerWhisper();
    this.partnerCommDrawer.visible = false;
  }

  private updatePartnerCommVisibility(): void {
    const canUse = this.canUsePartnerComms();
    if (this.partnerCommBtn) {
      this.partnerCommBtn.visible = canUse;
    }
    if (!canUse && this.partnerCommDrawer?.visible) {
      this.partnerCommDrawer.visible = false;
    }
  }

  private syncAutoPartnerCallout(): void {
    // En partidas online las cartas del compañero (humano o bot) están protegidas por anti-trampa
    if (this.isOnlineMatch) {
      return;
    }
    if (!this.canUsePartnerComms()) {
      this.lastAutoCalloutKey = null;
      if (this.partnerWhisper.isSticky()) this.partnerWhisper.hide();
      return;
    }
    const s = this.engine.getState();
    const autoMsg = buildAutoPartnerCallout(s);
    if (autoMsg) {
      const key = `${s.handNumber}_${s.phase}_${s.envido.chain.join(",")}_${s.truco.pendingLevel ?? 0}_${s.flor.stage}`;
      if (key !== this.lastAutoCalloutKey) {
        this.lastAutoCalloutKey = key;
        this.lastPartnerMsg = autoMsg;
        this.partnerWhisper.show(autoMsg, 0);
        this.positionPartnerComms();
        soundFX.playPartnerWhisper();
        if (this.partnerCommDrawer.visible) {
          const pPts = calculateEnvidoPoints(s.initialHands.player ?? [], s.vira);
          this.partnerCommDrawer.updateContext(
            pPts,
            this.lastPartnerMsg,
            !s.envido.resolved && s.trickIndex === 0,
          );
        }
      }
      return;
    }

    this.lastAutoCalloutKey = null;
    if (this.partnerWhisper.isSticky()) {
      this.partnerWhisper.hide();
    }
  }

  private positionPartnerComms(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const compact = this.isCompactLayout();
    const { cy, cardScale } = this.getArenaMetrics();

    if (compact) {
      const matRy = 124 * cardScale;
      const whisperY = Math.max(166, Math.min(184, cy - matRy - 40));
      this.partnerWhisper.setMaxWidth(w - 22);
      this.partnerWhisper.position.set(w / 2, whisperY);
      if (this.partnerCommBtn) {
        this.partnerCommBtn.position.set(w - 56, h - 294);
      }
    } else {
      this.partnerWhisper.setMaxWidth(Math.min(500, w - 180));
      this.partnerWhisper.position.set(w / 2, 218 * Math.max(0.86, cardScale));
      if (this.partnerCommBtn) {
        this.partnerCommBtn.position.set(Math.max(w - 102, w * 0.89), h - 46);
      }
    }
  }

  private buildTopControls(compact: boolean): void {
    if (this.lastCompactTopControls === compact) return;
    this.lastCompactTopControls = compact;
    this.topControls.removeChildren();

    const muted = soundFX.isMuted();

    if (compact) {
      const btnSize = 36;
      const rulesBtn = new PillButton({
        width: btnSize,
        height: btnSize,
        radius: 9,
        theme: "ghost",
        drawIcon: (g, col) => drawIconHelp(g, 17, col),
        onClick: () => {
          this.rulesModal.visible = !this.rulesModal.visible;
        },
      });

      this.muteBtn = new PillButton({
        width: btnSize,
        height: btnSize,
        radius: 9,
        theme: "ghost",
        drawIcon: (g, col) => drawIconSound(g, 17, col, muted),
        onClick: () => {
          const isMuted = soundFX.toggleMute();
          this.muteBtn.setIcon((g, col) => drawIconSound(g, 17, col, isMuted));
        },
      });

      const menuBtn = new PillButton({
        width: btnSize,
        height: btnSize,
        radius: 9,
        theme: "ghost",
        drawIcon: (g, col) => drawIconMenu(g, 17, col),
        onClick: () => this.showMenu(),
      });

      rulesBtn.position.set(-84, 0);
      this.muteBtn.position.set(-42, 0);
      menuBtn.position.set(0, 0);
      this.topControls.addChild(rulesBtn, this.muteBtn, menuBtn);
      return;
    }

    const rulesBtn = new PillButton({
      label: "Reglas",
      width: 90,
      height: 36,
      fontSize: 12,
      radius: 9,
      theme: "ghost",
      drawIcon: (g, col) => drawIconHelp(g, 14, col),
      onClick: () => {
        this.rulesModal.visible = !this.rulesModal.visible;
      },
    });

    this.muteBtn = new PillButton({
      width: 38,
      height: 36,
      radius: 9,
      theme: "ghost",
      drawIcon: (g, col) => drawIconSound(g, 17, col, muted),
      onClick: () => {
        const isMuted = soundFX.toggleMute();
        this.muteBtn.setIcon((g, col) => drawIconSound(g, 17, col, isMuted));
      },
    });

    const menuBtn = new PillButton({
      label: "Menú",
      width: 82,
      height: 36,
      fontSize: 12,
      radius: 9,
      theme: "ghost",
      drawIcon: (g, col) => drawIconMenu(g, 14, col),
      onClick: () => this.showMenu(),
    });

    rulesBtn.position.set(-144, 0);
    this.muteBtn.position.set(-72, 0);
    menuBtn.position.set(0, 0);
    this.topControls.addChild(rulesBtn, this.muteBtn, menuBtn);
  }

  private buildMenuOverlay(): void {
    this.menuOverlay.removeChildren();

    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const isNarrow = w < 540;

    const shade = new Graphics().rect(0, 0, w, h).fill({ color: 0x050e0a, alpha: 0.78 });
    shade.eventMode = "static";
    this.menuOverlay.addChild(shade);

    const cardW = isNarrow ? Math.min(358, w - 22) : 488;
    const cardH = isNarrow ? 500 : 446;
    const panel = new Container();
    panel.position.set(w / 2, h / 2);
    const scale = Math.min(1, (w - 20) / cardW, (h - 24) / cardH);
    panel.scale.set(scale);
    this.menuOverlay.addChild(panel);

    // Marco editorial caoba/bosque con filete de latón
    const bg = new Graphics()
      .roundRect(-cardW / 2 + 2, -cardH / 2 + 6, cardW, cardH, 18)
      .fill({ color: 0x000000, alpha: 0.45 })
      .roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 18)
      .fill(PALETTE.surfaceCard)
      .stroke({ width: 1.6, color: PALETTE.brass, alpha: 0.78 });
    // Filete interior fino
    bg.roundRect(-cardW / 2 + 7, -cardH / 2 + 7, cardW - 14, cardH - 14, 13).stroke({
      width: 0.8,
      color: PALETTE.brass,
      alpha: 0.22,
    });
    panel.addChild(bg);

    // Abanico de cartas españolas protagonistas
    const demoVira = { id: "5_oros", suit: "oros" as const, rank: 5 as const };
    const demoCards = [
      { id: "11_oros", suit: "oros" as const, rank: 11 as const },
      { id: "1_espadas", suit: "espadas" as const, rank: 1 as const },
      { id: "1_bastos", suit: "bastos" as const, rank: 1 as const },
    ];
    demoCards.forEach((c, idx) => {
      const cv = new CardView(c, demoVira, true);
      cv.scale.set(isNarrow ? 0.46 : 0.54);
      cv.position.set((idx - 1) * (isNarrow ? 36 : 44), -cardH / 2 + (isNarrow ? 46 : 52));
      cv.rotation = (idx - 1) * 0.15;
      panel.addChild(cv);
    });

    const title = new Text({
      text: "TRUCO VENEZOLANO",
      style: {
        fontFamily: FONT_DISPLAY,
        fontSize: isNarrow ? 23 : 29,
        fontWeight: "700",
        letterSpacing: 1.0,
        fill: PALETTE.ivory,
        padding: 4,
      },
    });
    title.anchor.set(0.5);
    title.position.set(0, -cardH / 2 + (isNarrow ? 108 : 120));
    panel.addChild(title);

    const subtitle = new Text({
      text: "Baraja Española · 40 cartas · Vira, Envido y Flor",
      style: {
        fontFamily: FONT_UI,
        fontSize: isNarrow ? 11.5 : 12.5,
        fontWeight: "500",
        fill: PALETTE.inkSecondary,
        align: "center",
        wordWrap: true,
        wordWrapWidth: cardW - 40,
      },
    });
    subtitle.anchor.set(0.5);
    subtitle.position.set(0, -cardH / 2 + (isNarrow ? 136 : 148));
    panel.addChild(subtitle);

    const addOptionRow = (
      y: number,
      label: string,
      leftLabel: string,
      rightLabel: string,
      leftActive: boolean,
      onLeft: () => void,
      onRight: () => void,
    ) => {
      if (isNarrow) {
        const lbl = new Text({
          text: label.toUpperCase(),
          style: {
            fontFamily: FONT_UI,
            fontSize: 10,
            fontWeight: "800",
            letterSpacing: 0.9,
            fill: PALETTE.inkMuted,
          },
        });
        lbl.anchor.set(0.5);
        lbl.position.set(0, y - 24);
        panel.addChild(lbl);

        const seg = new SegmentedToggle({
          width: cardW - 44,
          height: 40,
          leftLabel,
          rightLabel,
          leftActive,
          onLeft,
          onRight,
        });
        seg.position.set(0, y + 6);
        panel.addChild(seg);
      } else {
        const lbl = new Text({
          text: label,
          style: {
            fontFamily: FONT_UI,
            fontSize: 13,
            fontWeight: "600",
            fill: PALETTE.inkSecondary,
          },
        });
        lbl.anchor.set(0, 0.5);
        lbl.position.set(-cardW / 2 + 28, y);
        panel.addChild(lbl);

        const seg = new SegmentedToggle({
          width: 256,
          height: 38,
          leftLabel,
          rightLabel,
          leftActive,
          onLeft,
          onRight,
        });
        seg.position.set(cardW / 2 - 156, y);
        panel.addChild(seg);
      }
    };

    addOptionRow(
      isNarrow ? -44 : -22,
      "Mesa",
      "1 vs 1",
      "2 vs 2 (Parejas)",
      this.menuConfig.mode === "1v1",
      () => {
        this.menuConfig.mode = "1v1";
        this.buildMenuOverlay();
      },
      () => {
        this.menuConfig.mode = "2v2";
        this.buildMenuOverlay();
      },
    );

    addOptionRow(
      isNarrow ? 30 : 32,
      "Piedras",
      "12 piedras",
      "24 piedras",
      this.menuConfig.targetScore === 12,
      () => {
        this.menuConfig.targetScore = 12;
        this.buildMenuOverlay();
      },
      () => {
        this.menuConfig.targetScore = 24;
        this.buildMenuOverlay();
      },
    );

    addOptionRow(
      isNarrow ? 104 : 86,
      "Modalidad",
      "Con Flor",
      "Sin Flor",
      this.menuConfig.withFlor,
      () => {
        this.menuConfig.withFlor = true;
        this.buildMenuOverlay();
      },
      () => {
        this.menuConfig.withFlor = false;
        this.buildMenuOverlay();
      },
    );

    const btnGap = 8;
    const innerW = cardW - (isNarrow ? 44 : 56);
    const playW = isNarrow ? Math.round(innerW * 0.48) : 178;
    const onlineW = isNarrow ? Math.round(innerW * 0.28) : 114;
    const rulesW = innerW - playW - onlineW - btnGap * 2;
    const startX = -innerW / 2;

    const playBtn = new PillButton({
      label: isNarrow ? "Jugar" : "Jugar solo",
      width: playW,
      height: 46,
      fontSize: 14.5,
      radius: 11,
      theme: "primary",
      onClick: () => this.startMatch(),
    });
    playBtn.position.set(startX + playW / 2, cardH / 2 - 46);

    const onlineBtn = new PillButton({
      label: "Online",
      width: onlineW,
      height: 46,
      fontSize: 13.5,
      radius: 11,
      theme: "secondary",
      onClick: () => {
        this.mpLobby.open(this.menuConfig);
      },
    });
    onlineBtn.position.set(startX + playW + btnGap + onlineW / 2, cardH / 2 - 46);

    const rulesBtn = new PillButton({
      label: "Reglas",
      width: rulesW,
      height: 46,
      fontSize: 13,
      radius: 11,
      theme: "ghost",
      onClick: () => {
        this.rulesModal.visible = true;
      },
    });
    rulesBtn.position.set(
      startX + playW + btnGap + onlineW + btnGap + rulesW / 2,
      cardH / 2 - 46,
    );
    panel.addChild(playBtn, onlineBtn, rulesBtn);
  }

  private setupMultiplayer(): void {
    this.roomClient = new TrucoRoomClient({
      onStatusChange: (status, detail) => {
        if (status === "connecting" || status === "reconnecting") {
          this.mpLobby.setStatus(detail ?? "Conectando...", false, true);
        } else if (status === "error") {
          this.mpLobby.setStatus(detail ?? "Error de conexión", true, false);
        } else if (status === "connected") {
          this.mpLobby.setStatus(detail ?? "Conectado", false, false);
          this.syncLobbySnapshot();
        } else {
          this.mpLobby.setStatus("", false, false);
          this.syncLobbySnapshot();
        }
      },
      onMembersChange: () => {
        this.syncLobbySnapshot();
        if (this.isOnlineMatch && this.roomClient.backendMode === "realtime" && this.roomClient.isHost) {
          this.broadcastAndApplyHostState(false);
        }
      },
      onConfigChange: (cfg) => {
        this.menuConfig = { ...cfg };
        this.syncLobbySnapshot();
      },
      onSafeViewSync: (payload) => {
        this.applySafeViewSync(payload);
      },
      onRemoteAction: (seat, action) => this.handleRemotePlayerAction(seat, action),
      onActionRejected: (id) => this.recoverPendingAction(id),
      onTeamWhisper: (payload) => {
        this.handleIncomingTeamWhisper(payload);
      },
      onRequestSync: (targetClientId) => {
        if (this.isOnlineMatch && this.roomClient.isHost && this.hostEngine) {
          this.broadcastAndApplyHostState(false, targetClientId);
        }
      },
      onHostRecovered: (snapshot) => {
        this.recoverHostFromSnapshot(snapshot);
      },
    });

    this.mpLobby = new MultiplayerLobby({
      onCreateRoom: async (name, cfg) => {
        try {
          this.menuConfig = { ...cfg };
          await this.roomClient.createRoom(name, cfg);
          this.syncLobbySnapshot();
        } catch (err) {
          this.mpLobby.setStatus(
            err instanceof Error ? err.message : "No se pudo crear la sala.",
            true,
            false,
          );
        }
      },
      onJoinRoom: async (code, name) => {
        try {
          await this.roomClient.joinRoom(code, name);
          this.syncLobbySnapshot();
        } catch (err) {
          this.mpLobby.setStatus(
            err instanceof Error ? err.message : "No se pudo unir a la sala.",
            true,
            false,
          );
        }
      },
      onUpdateConfig: (cfg) => {
        this.menuConfig = { ...cfg };
        void this.roomClient.updateHostConfig(cfg);
      },
      onClaimSeat: (seat) => {
        void this.roomClient.claimSeat(seat).then(() => this.syncLobbySnapshot());
      },
      onStartOnlineMatch: () => {
        void this.startOnlineMatchAsHost();
      },
      onLeaveRoom: async () => {
        this.resetOnlineState();
        await this.roomClient.leaveRoom(true);
        this.syncLobbySnapshot();
      },
      onClose: () => {
        // Mantener en menú principal
      },
    });
  }

  private resetOnlineState(): void {
    this.clearPendingAction();
    this.confirmedView = null;
    this.isOnlineMatch = false;
    this.hostEngine = null;
    this.onlineHumanSeats.clear();
    this.onlineOfflineSeats.clear();
    this.onlineCanonicalHumanSeats.clear();
    this.onlineSeatNames = {};
    this.onlineCanonicalSeatNames = {};
    this.onlineCanonicalSeatClientIds = {};
    this.onlineBotPartnerSignal = null;
  }

  private syncLobbySnapshot(): void {
    this.mpLobby.setRoomState({
      roomCode: this.roomClient.roomCode,
      isHost: this.roomClient.isHost,
      myClientId: this.roomClient.clientId,
      mySeat: this.roomClient.mySeat,
      members: this.roomClient.members,
      config: this.roomClient.config,
    });
  }

  private recoverHostFromSnapshot(snapshot: PersistedHostSnapshot): void {
    this.hostEngine = new TrucoEngine(snapshot.state.config);
    this.hostEngine.loadExternalState(snapshot.state);
    this.onlineCanonicalSeatNames = { ...snapshot.seatNames };
    this.onlineCanonicalSeatClientIds = { ...snapshot.seatClientIds };
    this.onlineCanonicalHumanSeats = new Set(snapshot.humanSeats);
    this.isOnlineMatch = true;
    this.mpLobby.close();
    this.broadcastAndApplyHostState();
  }

  private async startOnlineMatchAsHost(): Promise<void> {
    if (!this.roomClient.isHost || !this.roomClient.isConnected()) return;

    if (this.roomClient.backendMode === "server") {
      this.mpLobby.close();
      await this.roomClient.startServerMatch();
      return;
    }

    const { seatNames, seatClientIds, humanSeats } = this.roomClient.getSeatAssignments();
    this.onlineCanonicalSeatNames = seatNames;
    this.onlineCanonicalSeatClientIds = seatClientIds;
    this.onlineCanonicalHumanSeats = new Set(humanSeats);
    this.hostEngine = new TrucoEngine(this.roomClient.config);
    this.hostEngine.startNewMatch(this.roomClient.config, "player");
    this.isOnlineMatch = true;
    this.mpLobby.close();

    this.broadcastAndApplyHostState();
  }

  private broadcastAndApplyHostState(stateChanged = true, targetClientId?: string): void {
    if (!this.roomClient.isHost || !this.hostEngine) return;
    const hostViewPayload = this.roomClient.broadcastSanitizedHostState({
      canonicalState: this.hostEngine.getState(),
      seatNames: this.onlineCanonicalSeatNames,
      seatClientIds: this.onlineCanonicalSeatClientIds,
      humanSeats: [...this.onlineCanonicalHumanSeats],
      targetClientId,
      stateChanged,
    });
    if (!targetClientId) {
      this.applySafeViewSync(hostViewPayload);
    }
  }

  private applySafeViewSync(payload: SafeViewerSyncPayload): void {
    const previous = this.confirmedView;
    if (previous && payload.version < previous.version) return;
    const sameVersion = previous?.version === payload.version;
    this.confirmedView = payload;
    if (sameVersion) {
      if (JSON.stringify(payload.offlineSeats) !== JSON.stringify(previous.offlineSeats) ||
          JSON.stringify(payload.seatNames) !== JSON.stringify(previous.seatNames) ||
          JSON.stringify(payload.humanSeats) !== JSON.stringify(previous.humanSeats)) {
        this.onlineOfflineSeats = new Set(payload.offlineSeats);
        this.onlineHumanSeats = new Set(payload.humanSeats);
        this.onlineSeatNames = { ...payload.seatNames };
        this.updateSeatBadges();
        if (!this.isDealing) this.updateTurnIndicator();
        this.scheduleBotIfNeeded();
      } else if (this.botTimer === null && this.roomClient.backendMode === "server") {
        // A heartbeat can recover a bot step whose request failed.
        this.scheduleBotIfNeeded();
      }
      return;
    }
    this.clearPendingAction();
    const isFreshMatch = !this.isOnlineMatch || this.inMenu;

    this.isOnlineMatch = true;
    this.inMenu = false;
    this.burnMode = false;
    this.menuOverlay.visible = false;
    this.summaryOverlay.visible = false;
    this.mpLobby.close();

    this.onlineSeatNames = { ...payload.seatNames };
    this.onlineHumanSeats = new Set(payload.humanSeats);
    this.onlineOfflineSeats = new Set(payload.offlineSeats);
    this.onlineBotPartnerSignal = payload.botPartnerSignal;

    // Si llega una jugada de la mano actual mientras aún termina la coreografía de reparto, cerrarla suavemente
    if (this.isDealing && payload.viewState.handNumber === this.lastHandNumber) {
      this.cancelDealChoreography(false);
      for (const cv of this.cardViews.values()) cv.visible = true;
    }

    this.engine.loadExternalState(payload.viewState);
    if (isFreshMatch) {
      this.lastHandNumber = -1;
      this.lastEventId = 0;
      this.layout();
      this.syncFromState(true);
    } else {
      this.syncFromState(false);
    }
  }

  private handleRemotePlayerAction(canonicalSeat: PlayerId, action: PlayerAction): boolean {
    if (!this.isOnlineMatch || !this.roomClient.isHost || !this.hostEngine) return false;
    const s = this.hostEngine.getState();

    const before = s.lastEvent?.id;
    // Permitir que cualquier jugador inicie la siguiente mano al cerrar la mano
    if (action.type === "NEXT_HAND" && s.phase === "HAND_OVER") {
      this.hostEngine.dispatch("player", action);
    } else {
      this.hostEngine.dispatch(canonicalSeat, action);
    }

    if (this.hostEngine.getState().lastEvent?.id === before) return false;
    this.broadcastAndApplyHostState();
    return true;
  }

  private handleIncomingTeamWhisper(payload: TeamWhisperPayload): void {
    if (!this.canUsePartnerComms()) return;
    const msg: PartnerMessage = {
      headline: payload.message.headline,
      detail: `${payload.fromName}: ${payload.message.detail}`,
      tone: payload.message.tone,
    };
    this.lastPartnerMsg = msg;
    const s = this.engine.getState();
    const keepSticky =
      s.phase === "AWAITING_ENVIDO" ||
      s.phase === "AWAITING_TRUCO" ||
      s.phase === "AWAITING_FLOR";
    this.partnerWhisper.show(msg, keepSticky ? 0 : 4800);
    soundFX.playPartnerWhisper();
  }

  private getDisplaySeatName(seat: PlayerId, compact = false): string {
    if (this.isOnlineMatch && this.onlineSeatNames[seat]) {
      const raw = this.onlineSeatNames[seat]!;
      const offlineTag = this.onlineOfflineSeats.has(seat)
        ? compact
          ? "·B"
          : " (BOT)"
        : "";
      return (compact ? raw.slice(0, 7).toUpperCase() : raw.toUpperCase()) + offlineTag;
    }
    const mode = this.engine.getState().config.mode;
    if (compact) {
      if (seat === "player") return "TÚ";
      if (seat === "partner") return "COMP.";
      if (mode === "1v1") return "CPU";
      return seat === "cpu" ? "DER" : "IZQ";
    }
    return getPlayerLabel(seat, mode).toUpperCase();
  }

  private showMenu(): void {
    this.clearBotTimer();
    this.cancelDealChoreography(false);
    if (this.isOnlineMatch) {
      this.resetOnlineState();
      void this.roomClient.leaveRoom(true);
    }
    this.inMenu = true;
    this.menuOverlay.visible = true;
    this.summaryOverlay.visible = false;
    this.partnerCommDrawer.visible = false;
    this.partnerWhisper.hide();
    this.lastPartnerMsg = null;
    this.lastAutoCalloutKey = null;
    this.partnerHint = {};
    this.updatePartnerCommVisibility();
    this.turnPill.setState(false, "");
    this.seatBadges.partner.container.visible = false;
    this.seatBadges.cpu.container.visible = false;
    this.seatBadges.cpu2.container.visible = false;
    this.buildMenuOverlay();
  }

  private startMatch(): void {
    this.clearBotTimer();
    this.cancelDealChoreography(false);
    if (this.isOnlineMatch) {
      this.resetOnlineState();
      void this.roomClient.leaveRoom(true);
    }
    this.inMenu = false;
    this.burnMode = false;
    this.menuOverlay.visible = false;
    this.summaryOverlay.visible = false;
    this.partnerCommDrawer.visible = false;
    this.partnerWhisper.hide();
    this.lastPartnerMsg = null;
    this.lastAutoCalloutKey = null;
    this.partnerHint = {};
    this.lastHandNumber = -1;
    this.lastEventId = 0;

    this.engine.startNewMatch(this.menuConfig, "player");
    // Recalcular layout inmediatamente para el modo elegido (1v1 vs 2v2) desde la 1.ª mano
    this.layout();
    this.syncFromState(true);
  }

  private clearBotTimer(): void {
    if (this.botTimer !== null) {
      clearTimeout(this.botTimer);
      this.botTimer = null;
    }
  }

  private scheduleDealStep(delayMs: number, fn: () => void): void {
    const id = setTimeout(() => {
      this.dealTimers = this.dealTimers.filter((t) => t !== id);
      if (this.inMenu) return;
      fn();
    }, delayMs);
    this.dealTimers.push(id);
  }

  private cancelDealChoreography(snapToReady: boolean): void {
    for (const id of this.dealTimers) {
      clearTimeout(id);
    }
    this.dealTimers = [];
    for (const child of this.dealFxContainer.removeChildren()) {
      child.destroy({ children: true });
    }
    this.isDealing = false;
    this.deckGroup.visible = true;
    this.viraInfoBg.visible = true;
    this.viraInfoTxt.visible = true;
    this.viraInfoBg.alpha = 1;
    this.viraInfoTxt.alpha = 1;

    if (snapToReady && !this.inMenu) {
      for (const cv of this.cardViews.values()) {
        cv.visible = true;
      }
      this.positionDeckAndVira(false);
      this.positionAllCards(false);
      this.updateSeatBadges();
      this.updateStakeAndStatus();
      this.updateTurnIndicator();
      this.updatePartnerCommVisibility();
      this.rebuildActionBar();
      this.scheduleBotIfNeeded();
    }
  }

  private clearPendingAction(): void {
    if (this.pendingAction) clearTimeout(this.pendingAction.timer);
    this.pendingAction = null;
  }

  private recoverPendingAction(id: string): void {
    if (this.pendingAction?.id !== id || !this.confirmedView) return;
    this.clearPendingAction();
    this.engine.loadExternalState(this.confirmedView.viewState);
    this.syncFromState(false);
    this.centerToast.show("Jugada sin confirmar", "Sincronizando la mesa…", PALETTE.brass, 2200);
    this.roomClient.requestCurrentView();
  }

  private submitOnlineAction(action: PlayerAction): void {
    const base = this.confirmedView;
    if (!base || this.pendingAction) return;
    const id = `${this.roomClient.clientId}-${Date.now()}-${++this.actionSequence}`;
    const label = pendingActionLabel(action, this.engine.getLegalActions("player").nextTrucoLevel);
    this.pendingAction = { id, label, timer: setTimeout(() => this.recoverPendingAction(id), 5000) };
    this.engine.loadExternalState(previewPlayerAction(base.viewState, action));
    const sent = this.roomClient.sendPlayerAction(action, id, base.version);
    this.positionAllCards(false);
    this.updateTurnIndicator();
    this.rebuildActionBar();
    if (action.type === "NEXT_HAND") this.updateSummaryOverlay();
    void sent.then((ok) => { if (!ok) this.recoverPendingAction(id); });
  }

  private dispatchPlayer(action: PlayerAction): void {
    if (this.inMenu || this.isDealing || this.pendingAction) return;
    this.burnMode = false;
    this.partnerCommDrawer.visible = false;

    if (this.isOnlineMatch) {
      if (this.roomClient.backendMode === "realtime" && this.roomClient.isHost && this.hostEngine) {
        this.handleRemotePlayerAction(this.roomClient.mySeat ?? "player", action);
      } else {
        this.submitOnlineAction(action);
      }
      return;
    }

    this.engine.dispatch("player", action);
    this.syncFromState(false);
  }

  private getActiveActorForEngine(eng: TrucoEngine): PlayerId | null {
    const s = eng.getState();
    if (s.phase === "PLAYING") return s.turn;
    if (s.phase === "AWAITING_ENVIDO") return s.envido.responder ?? null;
    if (s.phase === "AWAITING_FLOR") return s.flor.responder ?? null;
    if (s.phase === "AWAITING_TRUCO") return s.truco.responder ?? null;
    return null;
  }

  private getActiveActor(): PlayerId | null {
    return this.getActiveActorForEngine(this.engine);
  }

  private scheduleBotIfNeeded(): void {
    this.clearBotTimer();
    if (this.inMenu || this.isDealing || this.pendingAction) return;

    // En modo online:
    // - Modo servidor (Postgres + Edge Function): solicita el paso de bot al servidor (o bot suplente tras 14s si un humano se desconecta).
    // - Modo realtime (Host): el Anfitrión ejecuta bots y también cubre temporalmente a humanos desconectados tras 12s.
    if (this.isOnlineMatch) {
      if (this.roomClient.backendMode === "server") {
        const vs = this.engine.getState();
        if (vs.phase === "HAND_OVER" || vs.phase === "MATCH_OVER" || vs.phase === "MENU") {
          return;
        }
        const active = this.getActiveActor();
        if (!active || active === "player") return;
        const isPureBot = !this.onlineHumanSeats.has(active);
        const isOfflineHuman = this.onlineOfflineSeats.has(active);
        if (!isPureBot && !isOfflineHuman) return;

        const isFreshDealLead =
          vs.trickIndex === 0 && Object.keys(vs.tricks[0].played).length === 0;
        const delay = isOfflineHuman ? 14_000 : isFreshDealLead ? BOT_OPENING_MS : BOT_REPLY_MS;
        this.botTimer = setTimeout(() => {
          this.botTimer = null;
          if (!this.isOnlineMatch || this.roomClient.backendMode !== "server") return;
          void this.roomClient.triggerServerBotStep();
        }, delay);
        return;
      }

      if (!this.roomClient.isHost || !this.hostEngine) return;
      const hs = this.hostEngine.getState();
      if (hs.phase === "HAND_OVER" || hs.phase === "MATCH_OVER" || hs.phase === "MENU") {
        return;
      }
      const canonicalActive = this.getActiveActorForEngine(this.hostEngine);
      if (!canonicalActive) return;

      const isHumanSeat = this.onlineCanonicalHumanSeats.has(canonicalActive);
      const isOfflineHuman =
        isHumanSeat &&
        !this.roomClient.isSeatOnline(canonicalActive, this.onlineCanonicalSeatClientIds);
      if (isHumanSeat && !isOfflineHuman) {
        return;
      }

      const isFreshDealLead =
        hs.trickIndex === 0 && Object.keys(hs.tricks[0].played).length === 0;
      const delay = isOfflineHuman ? 12_000 : isFreshDealLead ? BOT_OPENING_MS : BOT_REPLY_MS;

      this.botTimer = setTimeout(() => {
        this.botTimer = null;
        if (!this.isOnlineMatch || !this.hostEngine) return;
        const freshActive = this.getActiveActorForEngine(this.hostEngine);
        if (!freshActive) return;
        const freshIsHuman = this.onlineCanonicalHumanSeats.has(freshActive);
        const freshIsOffline =
          freshIsHuman &&
          !this.roomClient.isSeatOnline(freshActive, this.onlineCanonicalSeatClientIds);
        if (freshIsHuman && !freshIsOffline) return;

        const freshAction = decideBotAction(
          this.hostEngine,
          freshActive,
          Math.random,
          this.partnerHint,
        );
        if (!freshAction) return;
        this.hostEngine.dispatch(freshActive, freshAction);
        this.broadcastAndApplyHostState();
      }, delay);
      return;
    }

    const s = this.engine.getState();
    if (s.phase === "HAND_OVER" || s.phase === "MATCH_OVER" || s.phase === "MENU") {
      return;
    }

    const active = this.getActiveActor();
    if (!active || active === "player") return;

    const isFreshDealLead =
      s.trickIndex === 0 && Object.keys(s.tricks[0].played).length === 0;
    const delay = isFreshDealLead ? BOT_OPENING_MS : BOT_REPLY_MS;

    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      const freshActive = this.getActiveActor();
      if (!freshActive || freshActive === "player") return;
      const freshAction = decideBotAction(this.engine, freshActive, Math.random, this.partnerHint);
      if (!freshAction) return;
      this.engine.dispatch(freshActive, freshAction);
      this.syncFromState(false);
    }, delay);
  }

  private syncFromState(forceRebuildCards: boolean): void {
    const s = this.engine.getState();
    const { cx, cy } = this.getArenaMetrics();

    // 1) Audio, globos de canto y destellos
    if (s.lastEvent && s.lastEvent.id !== this.lastEventId) {
      this.lastEventId = s.lastEvent.id;
      const ev = s.lastEvent;

      const awaitingResponse =
        s.phase === "AWAITING_TRUCO" ||
        s.phase === "AWAITING_ENVIDO" ||
        s.phase === "AWAITING_FLOR";

      // Si ya no estamos esperando respuesta (se respondió o se jugó carta), limpiar globos fijos anteriores
      if (!awaitingResponse || ev.type === "call" || ev.type === "response") {
        for (const [seatKey, b] of Object.entries(this.bubbles)) {
          if (b.isSticky() && seatKey !== ev.actor) {
            b.hide();
          }
        }
      }

      if (ev.bubble && ev.actor !== "system") {
        const accent =
          ev.type === "flor_result" || ev.bubble.includes("FLOR")
            ? PALETTE.brass
            : ev.bubble.includes("TRUCO") || ev.bubble.includes("VALE")
              ? PALETTE.crimson
              : PALETTE.brassSoft;
        const compact = this.isCompactLayout();
        const bubble = this.bubbles[ev.actor];
        // Los cantos que esperan respuesta (Truco, Envido, Flor/Contraflor) se mantienen fijos (sticky) hasta que se responda
        const shouldStick = awaitingResponse && ev.type === "call";
        const duration = shouldStick
          ? 0
          : ev.actor === "player"
            ? compact
              ? 1350
              : 1800
            : compact
              ? 1650
              : 2100;
        this.positionBubbleForSeat(ev.actor);
        bubble.show(ev.bubble, accent, duration);
        this.positionBubbleForSeat(ev.actor);
      }

      if (ev.type === "play_card" || ev.type === "burn_card") {
        for (const b of Object.values(this.bubbles)) {
          if (b.isSticky()) b.hide();
        }
        soundFX.playCardSlap();
      } else if (ev.type === "call") {
        soundFX.playCall(false);
      } else if (ev.type === "flor_result") {
        soundFX.playCall(true);
        this.sparkles.burst(cx, cy, PALETTE.brassLight, 14);
      } else if (ev.type === "envido_result") {
        soundFX.playStoneClink();
        this.sparkles.burst(cx, cy, PALETTE.acceptBorder, 10);
      } else if (ev.type === "trick_win") {
        const prevTrick = s.tricks[s.trickIndex - 1];
        if (prevTrick?.winnerTeam === "nosotros") {
          this.sparkles.burst(cx, cy, PALETTE.brassLight, 8);
          if (!this.isCompactLayout()) {
            this.centerToast.show(
              this.is2v2() ? "Baza de Nosotros" : "Baza tuya",
              `Sale ${getPlayerLabel(s.turn, s.config.mode)}`,
              PALETTE.acceptBorder,
              1050,
            );
          }
        } else if (prevTrick?.winnerTeam === "ellos" && !this.isCompactLayout()) {
          this.centerToast.show(
            this.is2v2() ? "Baza de Ellos" : "Baza de la CPU",
            `Sale ${getPlayerLabel(s.turn, s.config.mode)}`,
            PALETTE.crimsonBorder,
            1050,
          );
        } else if (prevTrick?.winnerTeam === "parda" && !this.isCompactLayout()) {
          this.centerToast.show(
            "Baza Parda",
            `Empate · vuelve a salir ${getPlayerLabel(s.turn, s.config.mode)}`,
            PALETTE.brass,
            1150,
          );
        }
      } else if (ev.type === "hand_end") {
        soundFX.playStoneClink();
        if (s.handSummary?.trickWinnerTeam === "nosotros") {
          this.sparkles.burst(cx, cy, PALETTE.brassLight, 12);
        }
      } else if (ev.type === "match_end") {
        soundFX.playFanfare(s.matchWinner === "nosotros");
        if (s.matchWinner === "nosotros") {
          this.sparkles.burst(cx, cy - 30, PALETTE.brassLight, 20);
          this.sparkles.burst(cx - 70, cy + 10, PALETTE.acceptBorder, 12);
          this.sparkles.burst(cx + 70, cy + 10, PALETTE.brass, 12);
        }
      }
    }

    // 2) Nueva mano -> animación completa de barajar, repartir y pasar la Vira
    const isNewHand = forceRebuildCards || s.handNumber !== this.lastHandNumber;
    if (isNewHand) {
      this.lastHandNumber = s.handNumber;
      this.burnMode = false;
      this.clearBotTimer();
      this.cancelDealChoreography(false);
      for (const b of Object.values(this.bubbles)) b.hide();
      this.partnerWhisper.hide();
      this.partnerCommDrawer.visible = false;
      this.lastPartnerMsg = null;
      this.lastAutoCalloutKey = null;
      this.partnerHint = {};

      if (this.is2v2()) {
        if (this.isOnlineMatch) {
          this.partnerSignalText = this.onlineBotPartnerSignal;
        } else {
          const pHand = s.initialHands.partner ?? [];
          this.partnerSignalText = getPartnerSignal(pHand, s.vira, s.config.withFlor);
        }
      } else {
        this.partnerSignalText = null;
      }

      this.rebuildHandCards();
      this.rebuildDeckAndVira();
      this.positionDeckAndVira(false);

      const activeActor = this.getActiveActor();
      const activeTeam = activeActor ? getPlayerTeam(activeActor) : null;
      const customSbLabels =
        this.isOnlineMatch && s.config.mode === "1v1" && this.onlineSeatNames.cpu
          ? { ellos: this.onlineSeatNames.cpu }
          : undefined;
      this.scoreboard.update(
        s.scores,
        s.config.targetScore,
        getPlayerTeam(s.mano),
        activeTeam,
        s.config.mode,
        customSbLabels,
      );
      this.updateStakeAndStatus();
      this.updateTrickDots();
      this.updateSummaryOverlay();
      this.updatePartnerCommVisibility();

      // Si reconectamos a mitad de una mano en curso, restaurar mesa al instante sin repetir reparto
      const hasMidHandProgress =
        s.trickIndex > 0 ||
        s.tricks.some((tr) => Object.keys(tr.played).length > 0) ||
        s.phase !== "PLAYING" ||
        s.envido.chain.length > 0 ||
        s.truco.level > 0 ||
        s.flor.stage !== "none";
      if (this.isOnlineMatch && hasMidHandProgress) {
        this.isDealing = false;
        this.deckGroup.visible = true;
        this.viraInfoBg.visible = true;
        this.viraInfoTxt.visible = true;
        this.viraInfoBg.alpha = 1;
        this.viraInfoTxt.alpha = 1;
        this.updateSeatBadges();
        this.updateTurnIndicator();
        this.positionPartnerComms();
        this.positionAllCards(false);
        this.rebuildActionBar();
        this.scheduleBotIfNeeded();
        return;
      }

      this.runDealChoreography();
      return;
    }

    // 3) Actualizar marcadores, indicadores, cartas, comunicación de pareja y acciones
    const activeActor = this.getActiveActor();
    const activeTeam = activeActor ? getPlayerTeam(activeActor) : null;
    const customSbLabels =
      this.isOnlineMatch && s.config.mode === "1v1" && this.onlineSeatNames.cpu
        ? { ellos: this.onlineSeatNames.cpu }
        : undefined;
    this.scoreboard.update(
      s.scores,
      s.config.targetScore,
      getPlayerTeam(s.mano),
      activeTeam,
      s.config.mode,
      customSbLabels,
    );
    this.updateSeatBadges();
    this.updateStakeAndStatus();
    this.updateTurnIndicator();
    this.updateTrickDots();
    this.updatePartnerCommVisibility();
    this.syncAutoPartnerCallout();
    this.positionAllCards(false);
    this.rebuildActionBar();
    this.updateSummaryOverlay();

    // 4) Turno de bot si corresponde
    this.scheduleBotIfNeeded();
  }

  private getSeatAnchorPos(seat: PlayerId): { x: number; y: number } {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const compact = this.isCompactLayout();
    const isFour = this.is2v2();
    const { cy, cardScale } = this.getArenaMetrics();

    if (seat === "player") {
      return { x: w / 2, y: compact ? h - 224 : h - 186 * Math.max(0.84, cardScale) };
    }
    if (seat === "partner" || (!isFour && seat === "cpu")) {
      return {
        x: compact ? w * 0.24 : w / 2,
        y: compact ? 116 : 122 * Math.max(0.85, cardScale),
      };
    }
    if (seat === "cpu2") {
      return { x: compact ? 52 : Math.max(106, w * 0.13), y: cy };
    }
    // cpu (Rival Der en 2v2)
    return { x: compact ? w - 52 : Math.min(w - 106, w * 0.87), y: cy };
  }

  private getSeatHandTarget(
    seat: PlayerId,
    idx: number,
    totalCount: number,
  ): { x: number; y: number; rot: number; scale: number } {
    const w = this.app.screen.width;
    const compact = this.isCompactLayout();
    const isFour = this.is2v2();
    const { cy, cardScale } = this.getArenaMetrics();

    if (seat === "player") {
      const s = this.engine.getState();
      const card = (s.hands.player ?? [])[idx];
      if (card) {
        const slot = this.getPlayerHandSlot(card.id);
        if (slot) return slot;
      }
      return { x: w / 2, y: this.app.screen.height - 200, rot: 0, scale: 0.8 };
    }

    if (seat === "partner" || (!isFour && seat === "cpu")) {
      const offset = idx - (totalCount - 1) / 2;
      const topScale = compact ? 0.43 : cardScale * 0.64;
      const centerX = compact ? w * 0.21 : w / 2;
      const spreadX = compact ? 26 : 74 * topScale;
      return {
        x: centerX + offset * spreadX,
        y: compact
          ? 98 + Math.abs(offset) * 3
          : 132 * Math.max(0.88, cardScale) + Math.abs(offset) * 3,
        rot: -offset * 0.07,
        scale: topScale,
      };
    }

    // Asientos laterales en 2v2 (cpu2 Izq, cpu Der)
    const isLeft = seat === "cpu2";
    const sideScale = compact ? 0.36 : cardScale * 0.56;
    const sideX = isLeft
      ? compact
        ? 30
        : Math.max(76, w * 0.095)
      : compact
        ? w - 30
        : Math.min(w - 76, w * 0.905);
    const spreadY = compact ? 24 : 44 * sideScale;
    const offset = idx - (totalCount - 1) / 2;
    return {
      x: sideX,
      y: cy + offset * spreadY,
      rot: isLeft ? Math.PI / 2 + offset * 0.05 : -Math.PI / 2 - offset * 0.05,
      scale: sideScale,
    };
  }

  /**
   * Coreografía auténtica del Truco Venezolano al iniciar cada mano:
   * 1) El repartidor baraja (corte y mezcla de dos mitades del mazo).
   * 2) En 2 vs 2, reparto tradicional venezolano:
   *    - El que baraja le da la carta al pie del equipo contrario (antepie), la ve y se la pasa al que es Mano.
   *    - Luego el que baraja saca otra carta, la ve y se la pasa a su compañero (trasmano).
   *    - Se reparten las cartas restantes hasta completar 3 por jugador.
   * 3) De último, el que baraja saca y voltea la Vira sobre la mesa bajo el mazo.
   */
  private runDealChoreography(): void {
    const s = this.engine.getState();
    const seats = s.seats;
    const manoIdx = seats.indexOf(s.mano);
    const dealerIdx = (manoIdx - 1 + seats.length) % seats.length;
    const dealer = seats[dealerIdx];
    const dealerLabel = getPlayerLabel(dealer, s.config.mode);

    const compact = this.isCompactLayout();
    const { cx, cy, cardScale } = this.getArenaMetrics();
    const dealerAnchor = this.getSeatAnchorPos(dealer);
    const shufflePos = {
      x: dealerAnchor.x + (cx - dealerAnchor.x) * 0.34,
      y: dealerAnchor.y + (cy - dealerAnchor.y) * 0.34,
    };
    const deckScale = compact ? 0.43 : Math.max(0.72, cardScale);

    this.isDealing = true;
    this.actionBar.removeChildren();
    this.deckGroup.visible = false;
    this.viraInfoBg.visible = false;
    this.viraInfoTxt.visible = false;
    this.updateSeatBadges();

    for (const cv of this.cardViews.values()) {
      cv.visible = false;
      cv.setFaceUp(false);
      cv.position.set(shufflePos.x, shufflePos.y);
      cv.scale.set(deckScale * 0.85);
      cv.rotation = 0;
      cv.alpha = 1;
    }

    const shuffleContainer = new Container();
    shuffleContainer.position.set(shufflePos.x, shufflePos.y);
    shuffleContainer.scale.set(deckScale);

    const leftHalf = createCardBackGraphics();
    const rightHalf = createCardBackGraphics();
    rightHalf.position.set(2, -2);
    shuffleContainer.addChild(leftHalf, rightHalf);
    this.dealFxContainer.addChild(shuffleContainer);

    const setDealBanner = (text: string) => {
      this.turnPill.setState(true, text, "urgent");
      this.positionTurnAndHelper();
    };

    const getInspectPoint = (seat: PlayerId, isDealerSelf: boolean): { x: number; y: number } => {
      const w = this.app.screen.width;
      // Si TÚ eres quien ve la carta (como pie o repartidor), traerla bien clara al centro-abajo frente a ti
      if (seat === "player") {
        return {
          x: w / 2,
          y: cy + (compact ? 42 : 52),
        };
      }
      const a = this.getSeatAnchorPos(seat);
      // Separar claramente del mazo hacia el tapete abierto para que siempre se aprecie la carta
      const pull = isDealerSelf ? 0.56 : 0.42;
      return {
        x: a.x + (cx - a.x) * pull,
        y: a.y + (cy - a.y) * pull + (isDealerSelf ? -18 : 0),
      };
    };

    // --- FASE 1: BARAJAR (0ms - 520ms) ---
    setDealBanner(`${dealerLabel} barajando...`);
    soundFX.playShuffleRiffle();
    this.tweens.to(leftHalf, { x: -34, rotation: -0.16 }, 135, Easing.easeOutCubic);
    this.tweens.to(rightHalf, { x: 34, rotation: 0.16 }, 135, Easing.easeOutCubic);

    this.scheduleDealStep(145, () => {
      this.tweens.to(leftHalf, { x: 0, rotation: 0 }, 115, Easing.easeInOutQuad);
      this.tweens.to(rightHalf, { x: 2, rotation: 0 }, 115, Easing.easeInOutQuad);
    });

    this.scheduleDealStep(270, () => {
      soundFX.playShuffleRiffle();
      this.tweens.to(leftHalf, { x: -28, rotation: -0.12 }, 120, Easing.easeOutCubic);
      this.tweens.to(rightHalf, { x: 28, rotation: 0.12 }, 120, Easing.easeOutCubic);
    });

    this.scheduleDealStep(400, () => {
      this.tweens.to(leftHalf, { x: 0, rotation: 0 }, 110, Easing.easeInOutQuad);
      this.tweens.to(rightHalf, { x: 2, rotation: 0 }, 110, Easing.easeInOutQuad);
    });

    // Helper para lanzar una carta directa del mazo a un asiento
    const launchDirectCard = (seat: PlayerId, round: number, atMs: number) => {
      const card = (s.hands[seat] ?? [])[round];
      if (!card) return;
      const cv = this.cardViews.get(`${seat}_${card.id}`);
      if (!cv) return;
      const target = this.getSeatHandTarget(seat, round, 3);

      this.scheduleDealStep(atMs, () => {
        cv.visible = true;
        cv.setFaceUp(false);
        cv.position.set(shufflePos.x, shufflePos.y);
        cv.zIndex = 70 + round;
        soundFX.playCardSlide();
        this.tweens.to(
          cv,
          {
            x: target.x,
            y: target.y,
            rotation: target.rot,
            scaleX: target.scale,
            scaleY: target.scale,
          },
          230,
          Easing.easeOutCubic,
        );
        if (seat === "player") {
          this.scheduleDealStep(120, () => cv.setFaceUp(true));
        }
      });
    };

    // --- FASE 2: REPARTICIÓN ---
    let cursorMs = 530;

    if (seats.length === 4) {
      const manoSeat = seats[manoIdx];
      const trasmanoSeat = seats[(manoIdx + 1) % 4]; // Compañero del que baraja
      const antepieSeat = seats[(manoIdx + 2) % 4]; // Pie del equipo contrario (compañero de Mano)
      const botPeekScale = compact ? 0.64 : Math.max(0.76, cardScale * 0.84);
      const humanPeekScale = compact ? 0.84 : Math.max(0.92, cardScale * 0.98);

      // 2A) El que baraja le da la 1.ª carta al pie (antepie), la ve y se la pasa al que es Mano
      const manoFirstCard = (s.hands[manoSeat] ?? [])[0];
      const manoFirstCv = manoFirstCard
        ? this.cardViews.get(`${manoSeat}_${manoFirstCard.id}`)
        : undefined;

      if (manoFirstCv && manoFirstCard) {
        const antepiePeek = getInspectPoint(antepieSeat, false);
        const manoTarget = this.getSeatHandTarget(manoSeat, 0, 3);
        const antepieLbl = getPlayerLabel(antepieSeat, s.config.mode);
        const manoLbl = getPlayerLabel(manoSeat, s.config.mode);
        const isHumanPeeking = antepieSeat === "player";
        const scale = isHumanPeeking ? humanPeekScale : botPeekScale;
        const holdMs = isHumanPeeking ? 760 : 480;

        this.scheduleDealStep(cursorMs, () => {
          setDealBanner(
            isHumanPeeking
              ? `Ves ${getCardName(manoFirstCard, s.vira)} → ${manoLbl}`
              : `${antepieLbl} la ve y pasa a ${manoLbl}`,
          );
          manoFirstCv.visible = true;
          manoFirstCv.setFaceUp(false);
          manoFirstCv.setHighlighted(true);
          manoFirstCv.position.set(shufflePos.x, shufflePos.y);
          manoFirstCv.zIndex = 96;
          soundFX.playCardSlide();
          this.tweens.to(
            manoFirstCv,
            {
              x: antepiePeek.x,
              y: antepiePeek.y,
              rotation: isHumanPeeking ? 0 : -0.1,
              scaleX: scale,
              scaleY: scale,
            },
            240,
            Easing.easeOutBack,
          );
          if (isHumanPeeking) {
            this.scheduleDealStep(120, () => {
              manoFirstCv.setFaceUp(true);
            });
          }
        });

        this.scheduleDealStep(cursorMs + 240 + holdMs, () => {
          manoFirstCv.setHighlighted(false);
          if (manoSeat !== "player") manoFirstCv.setFaceUp(false);
          soundFX.playCardSlide();
          this.tweens.to(
            manoFirstCv,
            {
              x: manoTarget.x,
              y: manoTarget.y,
              rotation: manoTarget.rot,
              scaleX: manoTarget.scale,
              scaleY: manoTarget.scale,
            },
            240,
            Easing.easeOutCubic,
          );
          if (manoSeat === "player") {
            this.scheduleDealStep(120, () => manoFirstCv.setFaceUp(true));
          }
        });

        cursorMs += 240 + holdMs + 280;
      }

      // 2B) El que baraja saca otra carta, la ve claramente fuera del mazo y se la pasa a su compañero (trasmano)
      const trasFirstCard = (s.hands[trasmanoSeat] ?? [])[0];
      const trasFirstCv = trasFirstCard
        ? this.cardViews.get(`${trasmanoSeat}_${trasFirstCard.id}`)
        : undefined;

      if (trasFirstCv && trasFirstCard) {
        const dealerPeek = getInspectPoint(dealer, true);
        const trasTarget = this.getSeatHandTarget(trasmanoSeat, 0, 3);
        const trasLbl = getPlayerLabel(trasmanoSeat, s.config.mode);
        const isHumanPeeking = dealer === "player";
        const scale = isHumanPeeking ? humanPeekScale : botPeekScale;
        const holdMs = isHumanPeeking ? 760 : 500;

        this.scheduleDealStep(cursorMs, () => {
          setDealBanner(
            isHumanPeeking
              ? `Ves ${getCardName(trasFirstCard, s.vira)} → ${trasLbl}`
              : `${dealerLabel} saca, la ve y pasa a ${trasLbl}`,
          );
          trasFirstCv.visible = true;
          trasFirstCv.setFaceUp(false);
          trasFirstCv.setHighlighted(true);
          trasFirstCv.position.set(shufflePos.x, shufflePos.y);
          trasFirstCv.zIndex = 96;
          soundFX.playCardSlide();
          this.tweens.to(
            trasFirstCv,
            {
              x: dealerPeek.x,
              y: dealerPeek.y,
              rotation: isHumanPeeking ? 0 : 0.1,
              scaleX: scale,
              scaleY: scale,
            },
            240,
            Easing.easeOutBack,
          );
          if (isHumanPeeking) {
            this.scheduleDealStep(120, () => {
              trasFirstCv.setFaceUp(true);
            });
          }
        });

        this.scheduleDealStep(cursorMs + 240 + holdMs, () => {
          trasFirstCv.setHighlighted(false);
          if (trasmanoSeat !== "player") trasFirstCv.setFaceUp(false);
          soundFX.playCardSlide();
          this.tweens.to(
            trasFirstCv,
            {
              x: trasTarget.x,
              y: trasTarget.y,
              rotation: trasTarget.rot,
              scaleX: trasTarget.scale,
              scaleY: trasTarget.scale,
            },
            240,
            Easing.easeOutCubic,
          );
          if (trasmanoSeat === "player") {
            this.scheduleDealStep(120, () => trasFirstCv.setFaceUp(true));
          }
        });

        cursorMs += 240 + holdMs + 280;
      }

      // 2C) Resto del reparto hasta completar 3 cartas por jugador
      this.scheduleDealStep(cursorMs, () => {
        setDealBanner(`${dealerLabel} repartiendo el resto...`);
      });

      const restStepMs = 68;
      // Completar 1.ª vuelta (antepie y dealer)
      launchDirectCard(antepieSeat, 0, cursorMs);
      cursorMs += restStepMs;
      launchDirectCard(dealer, 0, cursorMs);
      cursorMs += restStepMs;

      // Vueltas 2 y 3 en orden antihorario
      for (let round = 1; round < 3; round++) {
        for (let offset = 0; offset < seats.length; offset++) {
          const seat = seats[(manoIdx + offset) % seats.length];
          launchDirectCard(seat, round, cursorMs);
          cursorMs += restStepMs;
        }
      }
      cursorMs += 200;
    } else {
      // 1 vs 1: reparto 1 a 1 clásico
      this.scheduleDealStep(cursorMs, () => {
        setDealBanner(`${dealerLabel} repartiendo...`);
      });
      const stepMs = 95;
      for (let round = 0; round < 3; round++) {
        for (let offset = 0; offset < seats.length; offset++) {
          const seat = seats[(manoIdx + offset) % seats.length];
          launchDirectCard(seat, round, cursorMs);
          cursorMs += stepMs;
        }
      }
      cursorMs += 210;
    }

    // --- FASE 3: DE ÚLTIMO, VOLTEAR LA VIRA ---
    const viraStartMs = cursorMs;
    const viraScale = compact ? 0.62 : Math.max(0.76, cardScale * 0.88);
    let flyingVira: CardView | null = null;

    this.scheduleDealStep(viraStartMs, () => {
      setDealBanner(`La Vira: ${getCardName(s.vira)}`);
      flyingVira = new CardView(s.vira, s.vira, true);
      flyingVira.setHighlighted(true);
      flyingVira.position.set(shufflePos.x, shufflePos.y);
      flyingVira.scale.set(deckScale * 0.7);
      this.dealFxContainer.addChild(flyingVira);
      soundFX.playCardSlap();
      this.sparkles.burst(cx, cy, 0xffd75e, 14);
      this.tweens.to(
        flyingVira,
        {
          x: cx,
          y: cy,
          rotation: -0.05,
          scaleX: viraScale,
          scaleY: viraScale,
        },
        240,
        Easing.easeOutBack,
      );
    });

    // Asentar la Vira y el Mazo en la posición de la Mano
    const settleMs = viraStartMs + 480;
    this.scheduleDealStep(settleMs, () => {
      const finalDeckPos = this.getDeckScreenPos();
      soundFX.playCardSlide();
      this.tweens.to(
        shuffleContainer,
        { x: finalDeckPos.x, y: finalDeckPos.y },
        260,
        Easing.easeOutCubic,
      );
      if (flyingVira) {
        flyingVira.setHighlighted(false);
        this.tweens.to(
          flyingVira,
          {
            x: finalDeckPos.x - 16 * deckScale,
            y: finalDeckPos.y + 4,
            rotation: -0.14,
            scaleX: deckScale * 0.76,
            scaleY: deckScale * 0.76,
          },
          260,
          Easing.easeOutCubic,
        );
      }
    });

    // Finalizar coreografía y habilitar la mano
    this.scheduleDealStep(settleMs + 280, () => {
      for (const child of this.dealFxContainer.removeChildren()) {
        child.destroy({ children: true });
      }
      this.isDealing = false;
      this.deckGroup.visible = true;
      this.viraInfoBg.visible = true;
      this.viraInfoTxt.visible = true;
      this.viraInfoBg.alpha = 0;
      this.viraInfoTxt.alpha = 0;
      this.positionDeckAndVira(false);
      this.tweens.to(this.viraInfoBg, { alpha: 1 }, 200);
      this.tweens.to(this.viraInfoTxt, { alpha: 1 }, 200);

      if (!this.isCompactLayout()) {
        const manoLabel = getPlayerLabel(s.mano, s.config.mode);
        const isOurMano = getPlayerTeam(s.mano) === "nosotros";
        this.centerToast.show(
          `Mano #${s.handNumber} · Sale ${manoLabel}`,
          isOurMano ? "Tu equipo tiene la Mano" : "El equipo rival tiene la Mano",
          isOurMano ? 0x45e08a : 0xf5b842,
          1250,
        );
      }

      this.updateSeatBadges();
      this.updateStakeAndStatus();
      this.updateTurnIndicator();
      this.updatePartnerCommVisibility();
      this.positionPartnerComms();
      this.positionAllCards(false);
      this.rebuildActionBar();
      this.scheduleBotIfNeeded();
    });
  }

  private updateSeatBadges(): void {
    const show = !this.inMenu && this.is2v2();
    const s = this.engine.getState();
    const active = this.getActiveActor();
    const compact = this.isCompactLayout();

    const drawBadge = (
      badge: SeatBadge,
      label: string,
      isAlly: boolean,
      isActive: boolean,
    ) => {
      badge.container.visible = show;
      if (!show) return;
      badge.txt.text = label;
      badge.txt.style.fontSize = compact ? 9 : 10.5;
      badge.txt.style.fill = isActive
        ? PALETTE.brassLight
        : isAlly
          ? PALETTE.inkLight
          : PALETTE.inkSecondary;
      const bw = Math.max(compact ? 42 : 76, badge.txt.width + (compact ? 14 : 20));
      const bh = compact ? 20 : 24;
      const borderColor = isActive
        ? PALETTE.brass
        : isAlly
          ? PALETTE.borderMuted
          : PALETTE.borderSubtle;
      const fillColor = isActive
        ? isAlly
          ? 0x133827
          : 0x361417
        : PALETTE.surfaceDark;

      badge.bg.clear();
      badge.bg
        .roundRect(-bw / 2, -bh / 2, bw, bh, 7)
        .fill({ color: fillColor, alpha: 0.88 })
        .stroke({ width: isActive ? 1.5 : 1, color: borderColor, alpha: isActive ? 0.95 : 0.6 });
    };

    const partnerBase = this.getDisplaySeatName("partner", compact);
    const hidePartnerSignal = this.isOnlineMatch && this.onlineHumanSeats.has("partner");
    const partnerLabel =
      !this.isDealing &&
      !hidePartnerSignal &&
      this.partnerSignalText &&
      s.trickIndex === 0 &&
      s.phase !== "HAND_OVER"
        ? `${partnerBase} · ${this.partnerSignalText}`
        : partnerBase;

    drawBadge(this.seatBadges.partner, partnerLabel, true, active === "partner");
    drawBadge(
      this.seatBadges.cpu,
      this.getDisplaySeatName("cpu", compact),
      false,
      active === "cpu",
    );
    drawBadge(
      this.seatBadges.cpu2,
      this.getDisplaySeatName("cpu2", compact),
      false,
      active === "cpu2",
    );
  }

  private updateTurnIndicator(): void {
    if (this.inMenu) {
      this.turnPill.setState(false, "");
      return;
    }

    const s = this.engine.getState();
    const active = this.getActiveActor();
    const compact = this.isCompactLayout();

    if (this.pendingAction) {
      this.turnPill.setState(true, this.pendingAction.label, "player");
      this.positionTurnAndHelper();
      return;
    }
    if (!active) {
      this.turnPill.setState(false, "");
      return;
    }

    let compactSuffix = "";
    if (compact) {
      const pHand = s.initialHands.player ?? [];
      const pFlor = s.config.withFlor ? evaluateFlor(pHand, s.vira) : null;
      const pEnvido = calculateEnvidoPoints(pHand, s.vira);
      compactSuffix = pFlor?.hasFlor
        ? pFlor.isReservada
          ? " · Flor Res."
          : ` · Flor ${pFlor.points}`
        : ` · Envido ${pEnvido}`;
    }

    if (active === "player") {
      const legal = this.engine.getLegalActions("player");
      if (this.burnMode) {
        this.turnPill.setState(true, "Modo quemar · Toca una carta", "urgent");
      } else if (legal.mustCallFlorALey) {
        this.turnPill.setState(true, "Canta tu Flor a ley", "urgent");
      } else if (s.phase === "AWAITING_TRUCO") {
        const lvl = s.truco.pendingLevel ?? 1;
        this.turnPill.setState(true, `Responde ${TRUCO_LEVEL_NAMES[lvl]}`, "urgent");
      } else if (s.phase === "AWAITING_ENVIDO") {
        this.turnPill.setState(true, `Responde Envido${compactSuffix}`, "urgent");
      } else if (s.phase === "AWAITING_FLOR") {
        this.turnPill.setState(true, `Responde Flor${compactSuffix}`, "urgent");
      } else if (s.ley.declaredBy.includes("player") && s.trickIndex === 0) {
        this.turnPill.setState(true, `Tu turno · A Ley${compactSuffix}`, "player");
      } else {
        this.turnPill.setState(
          true,
          compact ? `Tu turno${compactSuffix}` : "Tu turno · Juega o canta",
          "player",
        );
      }
    } else {
      const who =
        this.isOnlineMatch && this.onlineSeatNames[active]
          ? this.onlineSeatNames[active]!
          : getPlayerLabel(active, s.config.mode);
      const isOffline = this.isOnlineMatch && this.onlineOfflineSeats.has(active);
      const modeStyle = getPlayerTeam(active) === "nosotros" ? "player" : "cpu";
      const label = compact
        ? `${who}${isOffline ? " (Bot)" : ""}${compactSuffix}`
        : isOffline
          ? `${who} desconectado · Bot suplente`
          : s.phase === "PLAYING"
            ? `Turno de ${who}`
            : `${who} respondiendo`;
      this.turnPill.setState(true, label, modeStyle);
    }

    this.positionTurnAndHelper();
  }

  private positionTurnAndHelper(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const compact = this.isCompactLayout();
    const { cardScale } = this.getArenaMetrics();

    if (compact) {
      if (this.canUsePartnerComms()) {
        // Dejar espacio limpio a la derecha para el botón "Comp."
        this.turnPill.setMaxWidth(Math.max(150, w - 128));
        this.turnPill.position.set((w - 108) / 2, h - 294);
      } else {
        this.turnPill.setMaxWidth(w - 28);
        this.turnPill.position.set(w / 2, h - 294);
      }
      this.handHelperBg.visible = false;
      this.handHelperTxt.visible = false;
      return;
    }

    // Escritorio: siempre bien despejado por encima de las cartas del jugador (sin solapar!)
    this.turnPill.setMaxWidth(w - 80);
    this.handHelperBg.visible = true;
    this.handHelperTxt.visible = true;
    this.turnPill.position.set(w / 2, h - 266 * Math.max(0.84, cardScale));

    const helperY = h - 98;
    const helperX = Math.max(122, Math.min(184, w * 0.14));
    this.handHelperBg.position.set(helperX, helperY);
    this.handHelperTxt.position.set(helperX, helperY);
  }

  private rebuildDeckAndVira(): void {
    const s = this.engine.getState();
    this.deckGroup.removeChildren();

    const viraView = new CardView(s.vira, s.vira, true);
    viraView.scale.set(0.76);
    viraView.position.set(-34, 8);
    viraView.rotation = -0.14;
    this.deckGroup.addChild(viraView);

    for (let i = 0; i < 3; i++) {
      const back = createCardBackGraphics();
      back.scale.set(0.76);
      back.position.set(16 + i * 2, -i * 2.5);
      this.deckGroup.addChild(back);
    }

    const manoShort = this.getDisplaySeatName(s.mano, true);
    const manoChipTxt = new Text({
      text: `MANO · ${manoShort}`,
      style: {
        fontFamily: FONT_UI,
        fontSize: 9,
        fontWeight: "800",
        letterSpacing: 0.5,
        fill: PALETTE.brassLight,
      },
    });
    const chipW = Math.max(92, manoChipTxt.width + 28);
    const chipLeft = 18 - chipW / 2;
    const manoChipBg = new Graphics()
      .roundRect(chipLeft, -70, chipW, 20, 8)
      .fill(PALETTE.surfaceCard)
      .stroke({ width: 1.2, color: PALETTE.brass, alpha: 0.9 });
    const manoCrown = new Graphics();
    drawIconDiamondCrown(manoCrown, 8, PALETTE.brass);
    manoCrown.position.set(chipLeft + 11, -60);

    manoChipTxt.anchor.set(0.5);
    manoChipTxt.position.set(chipLeft + 20 + (chipW - 24) / 2, -60);
    this.deckGroup.addChild(manoChipBg, manoCrown, manoChipTxt);

    const perico = getPericoSpec(s.vira);
    const perica = getPericaSpec(s.vira);
    const suitName = SUIT_NAMES[s.vira.suit];
    const pNote = s.vira.rank === 11 ? "Rey (12)" : "11";
    const paNote = s.vira.rank === 10 ? "Rey (12)" : "10";
    void perico;
    void perica;

    if (this.isCompactLayout()) {
      this.viraInfoTxt.style.fontSize = 9.5;
      this.viraInfoTxt.style.lineHeight = 13;
      this.viraInfoTxt.text = `Vira ${s.vira.rank} ${suitName}\nP: ${pNote} · Pa: ${paNote}`;
    } else {
      this.viraInfoTxt.style.fontSize = 11;
      this.viraInfoTxt.style.lineHeight = 15.5;
      this.viraInfoTxt.text = `Vira: ${getCardName(s.vira)}\nPerico ${pNote} ${suitName}  ·  Perica ${paNote} ${suitName}`;
    }

    this.redrawViraInfoPill();
  }

  private redrawViraInfoPill(): void {
    const compact = this.isCompactLayout();
    const padX = compact ? 9 : 14;
    const padY = compact ? 4 : 7;
    const w = Math.max(compact ? 104 : 185, this.viraInfoTxt.width + padX * 2);
    const h = this.viraInfoTxt.height + padY * 2;
    this.viraInfoBg.clear();
    this.viraInfoBg
      .roundRect(-w / 2, -h / 2, w, h, 8)
      .fill({ color: PALETTE.surfaceDark, alpha: 0.9 })
      .stroke({ width: 1, color: PALETTE.borderSubtle, alpha: 0.9 });
  }

  private rebuildHandCards(): void {
    this.tweens.clear();
    for (const cv of this.cardViews.values()) {
      cv.destroy({ children: true });
    }
    this.cardViews.clear();
    this.cardsLayer.removeChildren();

    const s = this.engine.getState();
    const deckPos = this.getDeckScreenPos();

    // Crear cartas para todos los asientos activos
    for (const seat of s.seats) {
      const cards = s.initialHands[seat] ?? [];
      for (const c of cards) {
        const isHuman = seat === "player";
        const cv = new CardView(c, s.vira, isHuman);
        cv.position.set(deckPos.x, deckPos.y);
        cv.scale.set(0.42);

        if (isHuman) {
          cv.eventMode = "static";
          cv.cursor = "pointer";

          cv.on("pointerover", () => {
            if (!this.isCardInteractive(c.id)) return;
            cv.setHighlighted(true);
            cv.zIndex = 90;
            const targetPos = this.getPlayerHandSlot(c.id);
            if (targetPos) {
              this.tweens.to(
                cv,
                {
                  y: targetPos.y - 18,
                  scaleX: targetPos.scale * 1.07,
                  scaleY: targetPos.scale * 1.07,
                },
                140,
                Easing.easeOutCubic,
              );
            }
          });

          cv.on("pointerout", () => {
            cv.setHighlighted(false);
            const sNow = this.engine.getState();
            const handIdx = (sNow.hands.player ?? []).findIndex((hc) => hc.id === c.id);
            if (handIdx !== -1) cv.zIndex = 60 + handIdx;
            const targetPos = this.getPlayerHandSlot(c.id);
            if (targetPos) {
              this.tweens.to(
                cv,
                { y: targetPos.y, scaleX: targetPos.scale, scaleY: targetPos.scale },
                160,
                Easing.easeOutCubic,
              );
            }
          });

          cv.on("pointertap", (e) => {
            if (!this.isCardInteractive(c.id)) return;
            const burned = this.burnMode || e.button === 2;
            cv.setHighlighted(false);
            this.dispatchPlayer({ type: "PLAY_CARD", cardId: c.id, burned });
          });
        }

        this.cardsLayer.addChild(cv);
        this.cardViews.set(`${seat}_${c.id}`, cv);
      }
    }
  }

  private isCardInteractive(cardId: string): boolean {
    if (
      this.inMenu ||
      this.isDealing ||
      this.pendingAction ||
      this.rulesModal.visible ||
      this.partnerCommDrawer.visible
    ) {
      return false;
    }
    const s = this.engine.getState();
    const legal = this.engine.getLegalActions("player");
    if (!legal.canPlayCard) return false;
    return (s.hands.player ?? []).some((c) => c.id === cardId);
  }

  private getArenaMetrics(): {
    cx: number;
    cy: number;
    cardScale: number;
  } {
    const w = this.app.screen.width;
    const h = this.app.screen.height;

    if (this.isCompactLayout()) {
      const slotSpacing = Math.min(116, Math.floor((w - 36) / 3));
      const cardScale = Math.max(0.56, Math.min(0.75, (slotSpacing - 12) / CARD_WIDTH));
      return {
        cx: w / 2,
        cy: Math.max(290, Math.min(h * 0.40, h - 460)),
        cardScale,
      };
    }

    const cardScale = Math.max(0.62, Math.min(0.94, Math.min(w / 1180, h / 820)));
    return {
      cx: w / 2,
      cy: h / 2 - 4,
      cardScale,
    };
  }

  private getDeckScreenPos(): { x: number; y: number } {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const mano = this.engine.getState().mano;
    const { cy } = this.getArenaMetrics();

    if (this.isCompactLayout()) {
      if (mano === "player") {
        return { x: w * 0.81, y: Math.min(h - 392, cy + 118) };
      }
      if (this.is2v2() && mano === "cpu2") {
        // Rival Izq (Oeste) es Mano -> esquina superior/media izquierda
        return { x: w * 0.21, y: Math.min(h - 392, cy + 118) };
      }
      // CPU (1v1), Compañero o Rival Der -> arriba-derecha
      return { x: w * 0.80, y: 102 };
    }

    // Desktop: 4 cuadrantes limpios fuera de las manos laterales y del botón Compañero
    if (this.is2v2()) {
      if (mano === "cpu2") return { x: Math.max(122, w * 0.13), y: Math.min(h - 246, h * 0.68) };
      if (mano === "partner") return { x: Math.min(w - 134, w * 0.87), y: Math.max(150, h * 0.22) };
      if (mano === "cpu") return { x: Math.min(w - 134, w * 0.87), y: Math.max(150, h * 0.22) };
      return { x: Math.min(w - 134, w * 0.87), y: Math.min(h - 246, h * 0.67) };
    }

    const x = Math.min(w - 138, w * 0.875);
    if (mano === "cpu") {
      return { x, y: Math.max(150, h * 0.25) };
    }
    return { x, y: Math.min(h - 210, h * 0.72) };
  }

  private positionDeckAndVira(animate: boolean): void {
    const compact = this.isCompactLayout();
    const { cardScale } = this.getArenaMetrics();
    const deckPos = this.getDeckScreenPos();
    const deckScale = compact ? 0.43 : Math.max(0.72, cardScale);
    const infoOffsetX = compact ? -4 : -6;
    const infoOffsetY = compact ? 44 : 88 * deckScale;

    this.deckGroup.scale.set(deckScale);

    if (animate) {
      this.tweens.to(this.deckGroup, { x: deckPos.x, y: deckPos.y }, 380, Easing.easeOutCubic);
      this.tweens.to(
        this.viraInfoBg,
        { x: deckPos.x + infoOffsetX, y: deckPos.y + infoOffsetY },
        380,
        Easing.easeOutCubic,
      );
      this.tweens.to(
        this.viraInfoTxt,
        { x: deckPos.x + infoOffsetX, y: deckPos.y + infoOffsetY },
        380,
        Easing.easeOutCubic,
      );
    } else {
      this.deckGroup.position.set(deckPos.x, deckPos.y);
      this.viraInfoBg.position.set(deckPos.x + infoOffsetX, deckPos.y + infoOffsetY);
      this.viraInfoTxt.position.set(deckPos.x + infoOffsetX, deckPos.y + infoOffsetY);
    }
  }

  private getPlayerHandSlot(cardId: string): {
    x: number;
    y: number;
    rot: number;
    scale: number;
  } | null {
    const s = this.engine.getState();
    const pHand = s.hands.player ?? [];
    const idx = pHand.findIndex((c) => c.id === cardId);
    if (idx === -1) return null;
    const count = pHand.length;
    const w = this.app.screen.width;
    const h = this.app.screen.height;

    if (this.isCompactLayout()) {
      const scale = Math.max(0.68, Math.min(0.86, (w - 36) / 335));
      const spread = Math.min(104 * scale, (w - 108) / Math.max(1, count - 0.1));
      const offset = idx - (count - 1) / 2;
      return {
        x: w / 2 + offset * spread,
        y: h - 196 - Math.abs(offset) * 4,
        rot: offset * 0.055,
        scale,
      };
    }

    const { cardScale } = this.getArenaMetrics();
    const scale = cardScale * 0.98;
    const spread = 112 * scale;
    const offset = idx - (count - 1) / 2;
    return {
      x: w / 2 + offset * spread,
      y: h - 154 * Math.max(0.84, cardScale) - Math.abs(offset) * 4,
      rot: offset * 0.055,
      scale,
    };
  }

  private getNaturalThrowJitter(cardId: string, trickIdx: number): {
    dx: number;
    dy: number;
    rot: number;
  } {
    let hash = trickIdx * 31;
    for (let i = 0; i < cardId.length; i++) {
      hash = (hash * 33 + cardId.charCodeAt(i)) & 0xffff;
    }
    const n1 = ((hash % 100) / 100) * 2 - 1;
    const n2 = (((hash >> 4) % 100) / 100) * 2 - 1;
    const n3 = (((hash >> 8) % 100) / 100) * 2 - 1;
    return {
      dx: n1 * 3.2,
      dy: n2 * 2.4,
      rot: n3 * 0.075,
    };
  }

  private shouldRevealSeatAtHandEnd(seat: PlayerId): boolean {
    const s = this.engine.getState();
    if (s.phase !== "HAND_OVER" && s.phase !== "MATCH_OVER") return false;
    if (s.envido.accepted) {
      if (s.config.mode === "1v1") return true;
      return (
        seat === s.envido.nosotrosBestPlayer ||
        seat === s.envido.ellosBestPlayer
      );
    }
    if (s.flor.stage !== "none" && s.flor.resolved) {
      return (
        seat === s.flor.caller ||
        seat === s.flor.winnerPlayer ||
        seat === s.flor.nosotrosBestPlayer ||
        seat === s.flor.ellosBestPlayer
      );
    }
    return false;
  }

  /**
   * Anti-trampa visual: en partidas online, las cartas ocultas de otros jugadores
   * llegan como `hidden_<seat>_<idx>`. Cuando se juega o se muestra una carta real
   * (boca arriba en baza o al cierre de mano por Envido/Flor), reemplaza limpiamente
   * una vista `hidden_*` obsoleta en su posición exacta para que la animación sea fluida.
   */
  private ensureCardViewsForState(): void {
    const s = this.engine.getState();

    for (const seat of s.seats) {
      if (seat === "player") continue;

      const activeCards = new Map<string, (typeof s.vira)>();
      for (const c of s.hands[seat] ?? []) {
        activeCards.set(`${seat}_${c.id}`, c);
      }
      for (const tr of s.tricks) {
        const entry = tr.played[seat];
        if (entry) {
          activeCards.set(`${seat}_${entry.card.id}`, entry.card);
        }
      }

      const prefix = `${seat}_`;
      const obsoleteKeys: string[] = [];
      for (const existingKey of this.cardViews.keys()) {
        if (existingKey.startsWith(prefix) && !activeCards.has(existingKey)) {
          obsoleteKeys.push(existingKey);
        }
      }

      for (const [key, card] of activeCards.entries()) {
        if (this.cardViews.has(key)) continue;

        let spawnX = this.getSeatAnchorPos(seat).x;
        let spawnY = this.getSeatAnchorPos(seat).y;
        let spawnRot = 0;
        let spawnScaleX = 0.52;
        let spawnScaleY = 0.52;

        const reuseKey = obsoleteKeys.shift();
        if (reuseKey) {
          const oldView = this.cardViews.get(reuseKey);
          if (oldView) {
            spawnX = oldView.x;
            spawnY = oldView.y;
            spawnRot = oldView.rotation;
            spawnScaleX = oldView.scale.x;
            spawnScaleY = oldView.scale.y;
            this.cardsLayer.removeChild(oldView);
            oldView.destroy({ children: true });
          }
          this.cardViews.delete(reuseKey);
        }

        const cv = new CardView(card, s.vira, false);
        cv.position.set(spawnX, spawnY);
        cv.rotation = spawnRot;
        cv.scale.set(spawnScaleX, spawnScaleY);
        this.cardsLayer.addChild(cv);
        this.cardViews.set(key, cv);
      }

      // Limpiar cualquier vista obsoleta sobrante del asiento
      for (const leftoverKey of obsoleteKeys) {
        const oldView = this.cardViews.get(leftoverKey);
        if (oldView) {
          this.cardsLayer.removeChild(oldView);
          oldView.destroy({ children: true });
        }
        this.cardViews.delete(leftoverKey);
      }
    }
  }

  private positionAllCards(isDealAnimation: boolean): void {
    this.ensureCardViewsForState();
    const s = this.engine.getState();
    const w = this.app.screen.width;
    const compact = this.isCompactLayout();
    const isFour = this.is2v2();
    const { cx, cy, cardScale } = this.getArenaMetrics();

    // 1) Manos restantes de todos los bots
    const topSeat: PlayerId = isFour ? "partner" : "cpu";
    const topHand = s.hands[topSeat] ?? [];
    const revealTop = this.shouldRevealSeatAtHandEnd(topSeat);

    topHand.forEach((c, idx) => {
      const cv = this.cardViews.get(`${topSeat}_${c.id}`);
      if (!cv) return;
      cv.setFaceUp(revealTop);
      cv.alpha = 1;
      cv.zIndex = 50 + idx;
      const offset = idx - (topHand.length - 1) / 2;
      const topScale = revealTop
        ? compact
          ? 0.48
          : cardScale * 0.72
        : compact
          ? 0.43
          : cardScale * 0.64;
      const centerX = compact ? w * 0.21 : w / 2;
      const spreadX = revealTop ? (compact ? 32 : 82 * topScale) : compact ? 26 : 74 * topScale;
      const targetX = centerX + offset * spreadX;
      const targetY = compact
        ? 98 + Math.abs(offset) * 3
        : 132 * Math.max(0.88, cardScale) + Math.abs(offset) * 3;
      const rot = -offset * 0.07;
      const dur = isDealAnimation ? 340 + idx * 85 : 240;
      this.tweens.to(
        cv,
        { x: targetX, y: targetY, rotation: rot, scaleX: topScale, scaleY: topScale },
        dur,
        Easing.easeOutCubic,
      );
    });

    // Asientos laterales en 2 vs 2 (West = cpu2 Rival Izq, East = cpu Rival Der)
    if (isFour) {
      const sideSeats: Array<{ seat: "cpu2" | "cpu"; isLeft: boolean }> = [
        { seat: "cpu2", isLeft: true },
        { seat: "cpu", isLeft: false },
      ];

      for (const { seat, isLeft } of sideSeats) {
        const hand = s.hands[seat] ?? [];
        const revealSide = this.shouldRevealSeatAtHandEnd(seat);
        const sideScale = revealSide
          ? compact
            ? 0.42
            : cardScale * 0.66
          : compact
            ? 0.36
            : cardScale * 0.56;
        const sideX = isLeft
          ? compact
            ? 30
            : Math.max(76, w * 0.095)
          : compact
            ? w - 30
            : Math.min(w - 76, w * 0.905);
        const sideY = cy;
        const spreadY = compact ? 24 : 44 * sideScale;

        hand.forEach((c, idx) => {
          const cv = this.cardViews.get(`${seat}_${c.id}`);
          if (!cv) return;
          cv.setFaceUp(revealSide);
          cv.alpha = 1;
          cv.zIndex = 50 + idx;
          const offset = idx - (hand.length - 1) / 2;
          const rot = revealSide ? 0 : isLeft ? Math.PI / 2 + offset * 0.05 : -Math.PI / 2 - offset * 0.05;
          const dur = isDealAnimation ? 360 + idx * 85 : 240;
          this.tweens.to(
            cv,
            {
              x: sideX + (revealSide ? (isLeft ? 10 : -10) : 0),
              y: sideY + offset * spreadY,
              rotation: rot,
              scaleX: sideScale,
              scaleY: sideScale,
            },
            dur,
            Easing.easeOutCubic,
          );
        });
      }
    }

    // 2) Mano del jugador humano (Sur)
    const canPlay = !this.pendingAction && this.engine.getLegalActions("player").canPlayCard;
    const pHand = s.hands.player ?? [];
    pHand.forEach((c, idx) => {
      const cv = this.cardViews.get(`player_${c.id}`);
      if (!cv) return;
      cv.setFaceUp(true);
      cv.cursor = canPlay ? "pointer" : "default";
      cv.zIndex = 60 + idx;
      const slot = this.getPlayerHandSlot(c.id);
      if (!slot) return;
      const dur = isDealAnimation ? 380 + idx * 90 : 220;
      const targetAlpha = canPlay ? 1 : 0.86;
      const liftY = canPlay ? -4 : 4;
      this.tweens.to(
        cv,
        {
          x: slot.x,
          y: slot.y + liftY,
          rotation: slot.rot,
          scaleX: slot.scale,
          scaleY: slot.scale,
          alpha: targetAlpha,
        },
        dur,
        Easing.easeOutCubic,
      );
    });

    // 3) Cartas jugadas en cascada natural sobre el tapete ovalado + halo en la carta ganadora actual
    for (const cv of this.cardViews.values()) {
      cv.setTrickLeader(false);
    }

    const activeTrickIdx = Math.min(s.trickIndex, s.tricks.length - 1);
    let leaderKey: string | null = null;
    const activeTrick = s.tricks[activeTrickIdx];
    if (activeTrick) {
      let bestPower = 0;
      let tieCount = 0;
      let bestSeat: PlayerId | null = null;
      let bestCardId: string | null = null;
      for (const seat of s.seats) {
        const entry = activeTrick.played[seat];
        if (!entry || entry.burned) continue;
        const pow = getCardTrucoPower(entry.card, s.vira);
        if (pow > bestPower) {
          bestPower = pow;
          tieCount = 1;
          bestSeat = seat;
          bestCardId = entry.card.id;
        } else if (pow === bestPower) {
          tieCount += 1;
        }
      }
      if (bestSeat && bestCardId && tieCount === 1) {
        leaderKey = `${bestSeat}_${bestCardId}`;
      }
    }

    const playedScale = isFour
      ? compact
        ? cardScale * 0.68
        : cardScale * 0.74
      : cardScale * 0.84;

    s.tricks.forEach((trick, tIdx) => {
      const isPreviousTrick = tIdx < s.trickIndex && s.phase === "PLAYING";

      for (const seat of s.seats) {
        const entry = trick.played[seat];
        if (!entry) continue;
        const cardKey = `${seat}_${entry.card.id}`;
        const cv = this.cardViews.get(cardKey);
        if (!cv) continue;

        const revealBurned = this.shouldRevealSeatAtHandEnd(seat);
        cv.setFaceUp(!entry.burned || revealBurned);
        cv.setTrickLeader(tIdx === activeTrickIdx && cardKey === leaderKey);
        if (seat === "player") {
          cv.cursor = "default";
          cv.setHighlighted(false);
        }

        cv.zIndex = 10 + tIdx * 10 + entry.order;
        const jitter = this.getNaturalThrowJitter(entry.card.id, tIdx);
        let tx = cx;
        let ty = cy;

        if (!isFour) {
          // 1 vs 1: 2 pilas (CPU arriba, Tú abajo)
          const cascadeX = 36 * playedScale;
          const cascadeY = 8 * playedScale;
          const baseStartX = cx - cascadeX;
          tx = baseStartX + tIdx * cascadeX + (seat === "player" ? 4 : 0) + jitter.dx;
          ty =
            (seat === "player"
              ? cy + (compact ? 64 : 68) * cardScale
              : cy - (compact ? 54 : 66) * cardScale) +
            tIdx * cascadeY +
            jitter.dy;
        } else {
          // 2 vs 2: 4 pilas en cruz (Norte=Compañero, Sur=Tú, Oeste=Rival Izq, Este=Rival Der)
          const cHoriz = 26 * playedScale;
          const cVert = 16 * playedScale;
          if (seat === "partner") {
            tx = cx - cHoriz * 0.9 + tIdx * cHoriz + jitter.dx;
            ty = cy - (compact ? 62 : 76) * cardScale + tIdx * 5 * playedScale + jitter.dy;
          } else if (seat === "player") {
            tx = cx - cHoriz * 0.9 + tIdx * cHoriz + jitter.dx;
            ty = cy + (compact ? 62 : 76) * cardScale + tIdx * 5 * playedScale + jitter.dy;
          } else if (seat === "cpu2") {
            tx = cx - (compact ? 74 : 112) * cardScale + tIdx * 14 * playedScale + jitter.dx;
            ty = cy - 10 * playedScale + tIdx * cVert + jitter.dy;
          } else {
            // cpu (Rival Der)
            tx = cx + (compact ? 56 : 92) * cardScale + tIdx * 14 * playedScale + jitter.dx;
            ty = cy - 10 * playedScale + tIdx * cVert + jitter.dy;
          }
        }

        this.tweens.to(
          cv,
          {
            x: tx,
            y: ty,
            rotation: jitter.rot + (tIdx - 1) * 0.025,
            scaleX: playedScale,
            scaleY: playedScale,
            alpha: isPreviousTrick ? 0.93 : 1,
          },
          270,
          Easing.easeOutBack,
        );
      }
    });
  }

  private updateStakeAndStatus(): void {
    const s = this.engine.getState();
    const compact = this.isCompactLayout();
    const trucoVal = getTrucoAcceptPoints(s.truco.level, s.scores, s.config.targetScore);

    if (compact) {
      const trucoShort =
        s.truco.level === 0
          ? "1 pt"
          : s.truco.level === 4
            ? "Vale Juego"
            : `${TRUCO_LEVEL_NAMES[s.truco.level]} ${trucoVal}`;
      const extraTag =
        s.envido.pendingSettlement && s.envido.accepted
          ? ` · Env ${s.envido.stakedPoints ?? 2}`
          : s.flor.pendingSettlement
            ? s.flor.stage === "flor"
              ? " · Flor"
              : ` · C.Flor`
            : s.ley.active
              ? " · A Ley"
              : "";
      this.stakePillTxt.style.fontSize = 10.5;
      this.stakePillTxt.text = `M${s.handNumber} · ${trucoShort}${extraTag}`;
      const maxW = Math.max(88, this.app.screen.width - 284);
      this.stakePillTxt.scale.set(
        this.stakePillTxt.width > maxW ? maxW / this.stakePillTxt.width : 1,
      );
    } else {
      const trucoDesc =
        s.truco.level === 0
          ? "Sin Truco (1)"
          : s.truco.level === 4
            ? "Vale Juego"
            : `${TRUCO_LEVEL_NAMES[s.truco.level]} (${trucoVal})`;
      const leyTag = s.ley.active ? " · A Ley" : "";
      const envTag =
        s.envido.pendingSettlement && s.envido.accepted
          ? ` · Envido (${s.envido.stakedPoints ?? 2})`
          : "";
      const florTag = s.flor.pendingSettlement
        ? s.flor.stage === "flor"
          ? " · Flor"
          : ` · Contraflor (${s.flor.stakedPoints ?? 6})`
        : "";
      this.stakePillTxt.style.fontSize = 12;
      this.stakePillTxt.text = `Mano ${s.handNumber} · ${trucoDesc}${envTag}${florTag}${leyTag}`;
      this.stakePillTxt.scale.set(1);
    }

    const pHand = s.initialHands.player ?? [];
    const pFlor = s.config.withFlor ? evaluateFlor(pHand, s.vira) : null;
    const pEnvido = calculateEnvidoPoints(pHand, s.vira);
    if (pFlor?.hasFlor) {
      this.handHelperTxt.text = pFlor.isReservada
        ? "Flor Reservada · se cobra al final"
        : `Flor · ${pFlor.points} pts`;
    } else {
      this.handHelperTxt.text = `Tu Envido: ${pEnvido} pts`;
    }

    const hhW = Math.max(138, this.handHelperTxt.width + 24);
    this.handHelperBg.clear();
    this.handHelperBg
      .roundRect(-hhW / 2, -15, hhW, 30, 9)
      .fill({ color: PALETTE.surfaceDark, alpha: 0.92 })
      .stroke({
        width: 1.2,
        color: pFlor?.hasFlor ? PALETTE.brass : PALETTE.borderSubtle,
      });
  }

  private updateTrickDots(): void {
    const s = this.engine.getState();
    const compact = this.isCompactLayout();
    const w = this.app.screen.width;
    // 3 rombos limpios integrados dentro de la barra superior unificada
    const dotCenterX = compact ? 158 + (w - 284) / 2 : w / 2;
    const dotY = compact ? 37 : 41;
    const spacing = compact ? 16 : 20;
    const r = compact ? 4.2 : 4.8;

    this.trickDotsG.clear();

    for (let i = 0; i < 3; i++) {
      const x = dotCenterX + (i - 1) * spacing;
      const trick = s.tricks[i];
      const winner = trick?.winnerTeam;

      const fill =
        winner === "nosotros"
          ? PALETTE.acceptBorder
          : winner === "ellos"
            ? PALETTE.crimsonBorder
            : winner === "parda"
              ? PALETTE.brass
              : PALETTE.inkMuted;
      const alpha = winner ? 0.96 : 0.25;

      this.trickDotsG
        .poly([x, dotY - r, x + r, dotY, x, dotY + r, x - r, dotY])
        .fill({ color: fill, alpha })
        .stroke({
          width: 1,
          color: winner ? PALETTE.inkDark : PALETTE.borderMuted,
          alpha: winner ? 0.7 : 0.4,
        });
    }
  }

  private rebuildActionBar(): void {
    this.actionBar.removeChildren();
    if (this.inMenu || this.isDealing || this.pendingAction) return;

    const s = this.engine.getState();
    const legal = this.engine.getLegalActions("player");
    const compact = this.isCompactLayout();

    interface BtnSpec {
      label: string;
      theme: ButtonTheme;
      width?: number;
      drawIcon?: (g: Graphics, color: number) => void;
      onClick: () => void;
    }

    const row1: BtnSpec[] = [];
    const row2: BtnSpec[] = [];

    if (legal.canCallFlor) {
      const aLeySuffix = legal.mustCallFlorALey ? " (A Ley)" : "";
      row1.push({
        label: `Flor${aLeySuffix}`,
        theme: "primary",
        width: legal.mustCallFlorALey ? 132 : 104,
        drawIcon: (g, col) => drawIconFlor(g, 13, col),
        onClick: () => this.dispatchPlayer({ type: "CALL_FLOR" }),
      });
    }

    if (legal.canCallALey) {
      row1.push({
        label: "A Ley",
        theme: "secondary",
        width: 88,
        onClick: () => this.dispatchPlayer({ type: "CALL_A_LEY" }),
      });
    }

    if (s.phase === "AWAITING_FLOR" && legal.florResponses.length > 0) {
      if (legal.florResponses.includes("quiero")) {
        row1.push({
          label: "Con Flor quiero",
          theme: "accept",
          width: 142,
          onClick: () => this.dispatchPlayer({ type: "RESPOND_FLOR", choice: "quiero" }),
        });
      }
      if (legal.florResponses.includes("no_quiero")) {
        row1.push({
          label: "No quiero",
          theme: "ghost",
          width: 108,
          onClick: () => this.dispatchPlayer({ type: "RESPOND_FLOR", choice: "no_quiero" }),
        });
      }
      if (legal.florResponses.includes("achico")) {
        row1.push({
          label: "Me achico",
          theme: "ghost",
          width: 112,
          onClick: () => this.dispatchPlayer({ type: "RESPOND_FLOR", choice: "achico" }),
        });
      }
      if (legal.florResponses.includes("contraflor")) {
        row2.push({
          label: "Contraflor (6)",
          theme: "primary",
          width: 132,
          onClick: () => this.dispatchPlayer({ type: "RESPOND_FLOR", choice: "contraflor" }),
        });
      }
      if (legal.florResponses.includes("contraflor_resto")) {
        row2.push({
          label: "Contraflor al Resto",
          theme: "danger",
          width: 158,
          onClick: () =>
            this.dispatchPlayer({ type: "RESPOND_FLOR", choice: "contraflor_resto" }),
        });
      }
    }

    if (s.phase === "AWAITING_ENVIDO" && legal.canRespondEnvido) {
      const stakes = this.engine.getEnvidoStakes(s.envido.chain);
      row1.push({
        label: `Quiero (${stakes.accept})`,
        theme: "accept",
        width: 136,
        onClick: () => this.dispatchPlayer({ type: "RESPOND_ENVIDO", accept: true }),
      });
      row1.push({
        label: `No quiero (${stakes.reject})`,
        theme: "ghost",
        width: 136,
        onClick: () => this.dispatchPlayer({ type: "RESPOND_ENVIDO", accept: false }),
      });
    }

    if (s.phase === "AWAITING_TRUCO" && legal.canRespondTruco) {
      row1.push({
        label: "Quiero",
        theme: "accept",
        width: 112,
        onClick: () => this.dispatchPlayer({ type: "RESPOND_TRUCO", accept: true }),
      });
      row1.push({
        label: "No quiero",
        theme: "ghost",
        width: 112,
        onClick: () => this.dispatchPlayer({ type: "RESPOND_TRUCO", accept: false }),
      });
    }

    if (legal.canCallTruco && legal.nextTrucoLevel) {
      const targetRow = s.phase === "AWAITING_TRUCO" ? row1 : row1;
      targetRow.push({
        label: this.getTrucoButtonLabel(legal.nextTrucoLevel),
        theme: "danger",
        width: legal.nextTrucoLevel >= 3 ? 132 : 114,
        onClick: () => this.dispatchPlayer({ type: "CALL_TRUCO" }),
      });
    }

    for (const call of legal.envidoCalls) {
      const isDouble = call === "envido" && s.envido.chain.includes("envido");
      const label =
        call === "envido"
          ? isDouble
            ? "Doble"
            : "Envido"
          : call === "real_envido"
            ? compact && s.phase === "AWAITING_ENVIDO"
              ? "Real"
              : "Real Envido"
            : compact && s.phase === "AWAITING_ENVIDO"
              ? "Falta"
              : "Falta Envido";
      const targetRow =
        s.phase === "AWAITING_ENVIDO" || s.phase === "AWAITING_TRUCO" ? row2 : row1;
      targetRow.push({
        label,
        theme: "secondary",
        width:
          compact && s.phase === "AWAITING_ENVIDO"
            ? 94
            : compact
              ? 100
              : isDouble
                ? 116
                : 110,
        onClick: () => this.dispatchPlayer({ type: "CALL_ENVIDO", call }),
      });
    }

    if (legal.canBurnCard) {
      row2.push({
        label: this.burnMode ? "Quemar: ON" : "Quemar",
        theme: this.burnMode ? "primary" : "ghost",
        width: compact ? 104 : 104,
        onClick: () => {
          this.burnMode = !this.burnMode;
          this.updateTurnIndicator();
          this.rebuildActionBar();
        },
      });
    }

    if (legal.canIrseAlMazo) {
      row2.push({
        label: "Al mazo",
        theme: "ghost",
        width: 96,
        onClick: () => this.dispatchPlayer({ type: "IRSE_AL_MAZO" }),
      });
    }

    const allSpecs = [...row1, ...row2];
    if (allSpecs.length === 0) return;

    const maxW = this.app.screen.width - 24;
    const gap = compact ? 8 : 10;
    const btnH = compact ? 44 : 40;

    // En móvil, separar limpiamente Fila 1 (decisión/cantos) y Fila 2 (escaladas/utilidad)
    const activeRows =
      compact && row1.length > 0 && row2.length > 0
        ? [row1, row2]
        : compact && allSpecs.length > 3
          ? [allSpecs.slice(0, Math.ceil(allSpecs.length / 2)), allSpecs.slice(Math.ceil(allSpecs.length / 2))]
          : [allSpecs];

    if (activeRows.length === 2) {
      const rowGap = 52;
      activeRows.forEach((row, rIdx) => {
        const rowW =
          row.reduce((acc, sp) => acc + (sp.width ?? 104), 0) +
          Math.max(0, row.length - 1) * gap;
        const rowScale = rowW > maxW ? maxW / rowW : 1;
        const rowContainer = new Container();
        rowContainer.y = (rIdx - 0.5) * rowGap;
        rowContainer.scale.set(rowScale);

        let cx = -rowW / 2;
        for (const sp of row) {
          const bw = sp.width ?? 104;
          const btn = new PillButton({
            label: sp.label,
            width: bw,
            height: btnH,
            fontSize: 13,
            radius: 11,
            theme: sp.theme,
            drawIcon: sp.drawIcon,
            onClick: sp.onClick,
          });
          btn.position.set(cx + bw / 2, 0);
          rowContainer.addChild(btn);
          cx += bw + gap;
        }
        this.actionBar.addChild(rowContainer);
      });

      this.actionBar.scale.set(1);
      return;
    }

    const row = activeRows[0];
    const totalW =
      row.reduce((acc, sp) => acc + (sp.width ?? 112), 0) +
      Math.max(0, row.length - 1) * gap;
    const barScale = totalW > maxW ? maxW / totalW : 1;

    let cursorX = -totalW / 2;
    for (const sp of row) {
      const bw = sp.width ?? 112;
      const btn = new PillButton({
        label: sp.label,
        width: bw,
        height: btnH,
        fontSize: 13,
        radius: 10,
        theme: sp.theme,
        drawIcon: sp.drawIcon,
        onClick: sp.onClick,
      });
      btn.position.set(cursorX + bw / 2, 0);
      this.actionBar.addChild(btn);
      cursorX += bw + gap;
    }

    this.actionBar.scale.set(barScale);
  }

  private getTrucoButtonLabel(level: TrucoLevel): string {
    switch (level) {
      case 1:
        return "Truco (3)";
      case 2:
        return "Retruco (6)";
      case 3:
        return "Vale Nueve (9)";
      case 4:
        return "Vale Juego";
      default:
        return "Truco";
    }
  }

  private updateSummaryOverlay(): void {
    this.summaryOverlay.removeChildren();
    const s = this.engine.getState();

    if (s.phase !== "HAND_OVER" && s.phase !== "MATCH_OVER") {
      this.summaryOverlay.visible = false;
      return;
    }

    this.summaryOverlay.visible = true;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const isNarrow = w < 480;

    const isMatchOver = s.phase === "MATCH_OVER";
    const showFlorCards = s.flor.stage !== "none" && s.flor.resolved;
    const showEnvidoCards =
      !showFlorCards &&
      Boolean(s.envido.accepted) &&
      s.envido.nosotrosPoints !== undefined &&
      s.envido.ellosPoints !== undefined;
    const hasShowcase = showFlorCards || showEnvidoCards;

    const cardW = isNarrow ? Math.min(362, w - 20) : hasShowcase ? 488 : 440;
    const cardH = hasShowcase
      ? isMatchOver
        ? 368
        : 298
      : isMatchOver
        ? 258
        : 190;

    const panel = new Container();
    const targetY = isMatchOver ? h / 2 : h - cardH / 2 - 30;
    panel.position.set(w / 2, targetY);
    const finalScale = Math.min(1, (w - 20) / cardW);
    this.summaryOverlay.addChild(panel);

    const ourWin = isMatchOver
      ? s.matchWinner === "nosotros"
      : s.handSummary?.trickWinnerTeam === "nosotros";

    const bg = new Graphics()
      .roundRect(-cardW / 2 + 2, -cardH / 2 + 5, cardW, cardH, 16)
      .fill({ color: 0x000000, alpha: 0.45 })
      .roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 16)
      .fill({ color: PALETTE.surfaceCard, alpha: 0.98 })
      .stroke({ width: 1.6, color: ourWin ? PALETTE.brass : PALETTE.crimsonBorder });
    panel.addChild(bg);

    const headingText = isMatchOver
      ? ourWin
        ? this.is2v2()
          ? "Ganamos la partida"
          : "Ganaste la partida"
        : this.is2v2()
          ? "Ellos ganaron la partida"
          : "CPU ganó la partida"
      : ourWin
        ? this.is2v2()
          ? "Ganamos la mano"
          : "Ganaste la mano"
        : this.is2v2()
          ? "Ellos ganaron la mano"
          : "CPU ganó la mano";

    const heading = new Text({
      text: headingText,
      style: {
        fontFamily: FONT_DISPLAY,
        fontSize: isNarrow ? 20 : 23,
        fontWeight: "700",
        fill: ourWin ? PALETTE.brassLight : PALETTE.crimsonBorder,
      },
    });
    heading.anchor.set(0.5);
    heading.position.set(0, -cardH / 2 + 26);
    panel.addChild(heading);

    if (hasShowcase) {
      const showcaseY = -cardH / 2 + 102;
      const miniScale = isNarrow ? 0.37 : 0.42;

      const renderMiniGroup = (
        centerX: number,
        title: string,
        cardsToShow: typeof s.vira[],
        isWinner: boolean,
      ) => {
        const boxW = Math.min(cardW / 2 - 14, cardsToShow.length === 3 ? 166 : 152);
        const boxH = 98;
        const box = new Graphics()
          .roundRect(centerX - boxW / 2, showcaseY - boxH / 2, boxW, boxH, 10)
          .fill({ color: isWinner ? 0x123324 : PALETTE.surfaceRecessed, alpha: 0.94 })
          .stroke({
            width: isWinner ? 1.4 : 1,
            color: isWinner ? PALETTE.brass : PALETTE.borderSubtle,
            alpha: isWinner ? 0.92 : 0.7,
          });
        panel.addChild(box);

        const lbl = new Text({
          text: title,
          style: {
            fontFamily: FONT_UI,
            fontSize: isNarrow ? 10 : 11,
            fontWeight: "700",
            fill: isWinner ? PALETTE.brassLight : PALETTE.inkSecondary,
          },
        });
        lbl.anchor.set(0.5);
        lbl.position.set(centerX, showcaseY - boxH / 2 + 13);
        panel.addChild(lbl);

        const spread = cardsToShow.length === 3 ? 34 * (miniScale / 0.38) : 42 * (miniScale / 0.38);
        cardsToShow.forEach((c, idx) => {
          const offset = idx - (cardsToShow.length - 1) / 2;
          const cv = new CardView(c, s.vira, true);
          cv.scale.set(miniScale);
          cv.position.set(centerX + offset * spread, showcaseY + 12);
          cv.rotation = offset * 0.06;
          panel.addChild(cv);
        });
      };

      if (showEnvidoCards) {
        const nSeat = s.envido.nosotrosBestPlayer ?? "player";
        const eSeat = s.envido.ellosBestPlayer ?? "cpu";
        const nCards = getEnvidoCards(s.initialHands[nSeat] ?? [], s.vira);
        const eCards = getEnvidoCards(s.initialHands[eSeat] ?? [], s.vira);
        const halfOffset = cardW * 0.245;
        renderMiniGroup(
          -halfOffset,
          `${getPlayerLabel(nSeat, s.config.mode)}: ${s.envido.nosotrosPoints}`,
          nCards,
          s.envido.winnerTeam === "nosotros",
        );
        renderMiniGroup(
          halfOffset,
          `${getPlayerLabel(eSeat, s.config.mode)}: ${s.envido.ellosPoints}`,
          eCards,
          s.envido.winnerTeam === "ellos",
        );
      } else if (showFlorCards) {
        const bothHadFlor =
          s.flor.nosotrosPoints !== undefined &&
          s.flor.ellosPoints !== undefined &&
          s.flor.nosotrosBestPlayer &&
          s.flor.ellosBestPlayer;
        if (bothHadFlor) {
          const halfOffset = cardW * 0.245;
          renderMiniGroup(
            -halfOffset,
            `${getPlayerLabel(s.flor.nosotrosBestPlayer!, s.config.mode)}: ${s.flor.nosotrosPoints}`,
            s.initialHands[s.flor.nosotrosBestPlayer!] ?? [],
            s.flor.winnerTeam === "nosotros",
          );
          renderMiniGroup(
            halfOffset,
            `${getPlayerLabel(s.flor.ellosBestPlayer!, s.config.mode)}: ${s.flor.ellosPoints}`,
            s.initialHands[s.flor.ellosBestPlayer!] ?? [],
            s.flor.winnerTeam === "ellos",
          );
        } else {
          const owner = s.flor.winnerPlayer ?? s.flor.caller ?? "player";
          const ownerHand = s.initialHands[owner] ?? [];
          const ownerEval = evaluateFlor(ownerHand, s.vira);
          const ownerLbl = getPlayerLabel(owner, s.config.mode);
          const ownerTitle = ownerEval.isReservada
            ? `Flor Reservada (${ownerLbl})`
            : `Flor ${ownerLbl} (${ownerEval.points} pts)`;
          renderMiniGroup(0, ownerTitle, ownerHand, true);
        }
      }
    }

    const lines: string[] = [];
    if (s.handSummary?.florText) lines.push(s.handSummary.florText);
    if (s.handSummary?.envidoText) lines.push(s.handSummary.envidoText);
    if (s.handSummary && s.handSummary.trucoPoints > 0) {
      lines.push(
        `${s.handSummary.reason} (+${s.handSummary.trucoPoints} piedra${s.handSummary.trucoPoints > 1 ? "s" : ""})`,
      );
    } else if (s.handSummary && !s.handSummary.florText && !s.handSummary.envidoText) {
      lines.push(s.handSummary.reason);
    }
    lines.push(
      `Marcador: ${getTeamLabel("nosotros", s.config.mode)} ${s.scores.nosotros}  —  ${getTeamLabel("ellos", s.config.mode)} ${s.scores.ellos}  (Meta ${s.config.targetScore})`,
    );

    const body = new Text({
      text: lines.join("\n"),
      style: {
        fontFamily: FONT_UI,
        fontSize: isNarrow ? 11.5 : 12.5,
        lineHeight: 18,
        align: "center",
        fill: PALETTE.inkLight,
        wordWrap: true,
        wordWrapWidth: cardW - 30,
      },
    });
    body.anchor.set(0.5);
    body.position.set(0, hasShowcase ? cardH / 2 - 96 : -4);
    panel.addChild(body);

    if (isMatchOver) {
      const bw = isNarrow ? (cardW - 44) / 2 : 156;
      const canRestart = !this.isOnlineMatch || this.roomClient.isHost;
      const againBtn = new PillButton({
        label: canRestart ? "Jugar de nuevo" : "Esperando host",
        width: bw,
        height: 44,
        theme: "primary",
        onClick: () => {
          if (this.isOnlineMatch && this.roomClient.isHost) {
            void this.startOnlineMatchAsHost();
          } else if (!this.isOnlineMatch) {
            this.startMatch();
          }
        },
      });
      againBtn.setEnabled(canRestart);
      againBtn.position.set(-bw / 2 - 6, cardH / 2 - 36);

      const menuBtn = new PillButton({
        label: "Menú",
        width: bw,
        height: 44,
        theme: "ghost",
        onClick: () => this.showMenu(),
      });
      menuBtn.position.set(bw / 2 + 6, cardH / 2 - 36);
      panel.addChild(againBtn, menuBtn);
    } else {
      const nextBtn = new PillButton({
        label: this.pendingAction?.label ?? "Siguiente mano",
        width: 196,
        height: 44,
        theme: "primary",
        onClick: () => {
          soundFX.playCardSlide();
          this.dispatchPlayer({ type: "NEXT_HAND" });
        },
      });
      nextBtn.setEnabled(!this.pendingAction);
      nextBtn.position.set(0, cardH / 2 - 32);
      panel.addChild(nextBtn);
    }

    panel.alpha = 0;
    panel.scale.set(0.92 * finalScale);
    this.tweens.to(
      panel,
      { alpha: 1, scaleX: finalScale, scaleY: finalScale },
      220,
      Easing.easeOutBack,
    );
  }

  private drawTableAndArena(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const compact = this.isCompactLayout();
    const { cx, cy, cardScale } = this.getArenaMetrics();
    const headerH = compact ? 54 : 60;

    this.tableBg.clear();
    const feltGrad = new FillGradient({
      type: "radial",
      center: { x: 0.5, y: 0.44 },
      innerRadius: 0.02,
      outerCenter: { x: 0.5, y: 0.48 },
      outerRadius: 0.82,
      colorStops: [
        { offset: 0, color: PALETTE.feltCenter },
        { offset: 0.52, color: PALETTE.feltMid },
        { offset: 1, color: PALETTE.feltEdge },
      ],
    });

    const pad = compact ? 6 : 12;
    const topY = headerH + (compact ? 4 : 8);
    const feltH = Math.max(40, h - topY - pad);
    const feltW = Math.max(40, w - pad * 2);
    const radius = compact ? 16 : 24;

    // Marco exterior en caoba oscura con bisel sutil
    this.tableBg.rect(0, 0, w, h).fill(PALETTE.woodOuter);
    this.tableBg
      .roundRect(pad - 2, topY - 2, feltW + 4, feltH + 4, radius + 2)
      .fill(PALETTE.woodRail)
      .stroke({ width: compact ? 2 : 3, color: PALETTE.woodBevel, alpha: 0.85 });

    // Paño verde botella
    this.tableBg
      .roundRect(pad, topY, feltW, feltH, radius)
      .fill(feltGrad)
      .stroke({ width: 1.5, color: 0x05150e, alpha: 0.85 });

    // Filete fino de latón incrustado en el paño
    this.tableBg
      .roundRect(pad + 6, topY + 6, Math.max(20, feltW - 12), Math.max(20, feltH - 12), Math.max(10, radius - 5))
      .stroke({ width: 1, color: PALETTE.brass, alpha: 0.18 });

    // Textura sutil de grano de fieltro sobre el paño
    this.feltGrainSprite.position.set(pad, topY);
    this.feltGrainSprite.width = feltW;
    this.feltGrainSprite.height = feltH;

    // Tapete ovalado central sobrio (doble filete en latón, sin líneas blancas)
    this.arenaSlotsG.clear();
    const matRx = (compact ? (this.is2v2() ? 136 : 152) : 234) * cardScale;
    const matRy = (compact ? 124 : 148) * cardScale;

    this.arenaSlotsG
      .ellipse(cx, cy, matRx, matRy)
      .fill({ color: 0x061c13, alpha: 0.22 })
      .stroke({ width: 1.4, color: PALETTE.brass, alpha: 0.24 });
    this.arenaSlotsG
      .ellipse(cx, cy, matRx - 7, matRy - 7)
      .stroke({ width: 0.8, color: PALETTE.brass, alpha: 0.12 });

    // 4 diminutos rombos cardinales en latón sobre el óvalo
    const diamondR = 3;
    const cardinals: Array<[number, number]> = [
      [cx, cy - matRy],
      [cx, cy + matRy],
      [cx - matRx, cy],
      [cx + matRx, cy],
    ];
    for (const [dx, dy] of cardinals) {
      this.arenaSlotsG
        .poly([dx, dy - diamondR, dx + diamondR, dy, dx, dy + diamondR, dx - diamondR, dy])
        .fill({ color: PALETTE.brass, alpha: 0.42 });
    }
  }

  private positionBubbleForSeat(seat: PlayerId): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const compact = this.isCompactLayout();
    const isFour = this.is2v2();
    const { cy, cardScale } = this.getArenaMetrics();
    const bubble = this.bubbles[seat];

    // Orientar la cola del globo directamente hacia quien cantó
    if (seat === "player") {
      bubble.setTailDirection("down");
    } else if (seat === "partner") {
      bubble.setTailDirection("up");
    } else if (seat === "cpu2") {
      bubble.setTailDirection("down");
    } else {
      bubble.setTailDirection(isFour ? "down" : "up");
    }

    let x = w / 2;
    let y = h / 2;

    if (compact) {
      if (seat === "player") {
        x = w / 2;
        y = h - 134;
      } else if (seat === "partner") {
        x = w * 0.24;
        y = 166;
      } else if (seat === "cpu2") {
        x = 84;
        y = cy - 94;
      } else {
        // cpu: arriba-izquierda en 1v1, lado derecho en 2v2
        x = isFour ? w - 84 : w * 0.24;
        y = isFour ? cy - 94 : 154;
      }
    } else {
      if (seat === "player") {
        x = w / 2;
        y = h - 260 * Math.max(0.84, cardScale);
      } else if (seat === "partner") {
        x = w / 2 + 122;
        y = 166 * Math.max(0.84, cardScale);
      } else if (seat === "cpu2") {
        x = Math.max(136, w * 0.17);
        y = cy - 64;
      } else {
        x = isFour ? Math.min(w - 136, w * 0.83) : w / 2;
        y = isFour ? cy - 64 : 174 * Math.max(0.84, cardScale);
      }
    }

    // Asegurar que la burbuja jamás se corte en los bordes laterales de la pantalla
    const halfW = bubble.bubbleWidth / 2;
    const clampedX = Math.max(halfW + 10, Math.min(w - halfW - 10, x));
    bubble.position.set(clampedX, y);
  }

  public layout(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const compact = this.isCompactLayout();
    const { cx, cy, cardScale } = this.getArenaMetrics();
    const headerH = compact ? 54 : 60;

    this.buildTopControls(compact);
    this.buildPartnerCommBtn(compact);
    this.scoreboard.setCompact(compact);
    this.drawTableAndArena();

    // Barra superior unificada (caoba/bosque mate con filete inferior de latón)
    this.headerBarBg.clear();
    this.headerBarBg.rect(0, 0, w, headerH).fill({ color: PALETTE.headerBg, alpha: 0.96 });
    this.headerBarBg
      .moveTo(0, headerH)
      .lineTo(w, headerH)
      .stroke({ width: 1, color: PALETTE.brass, alpha: 0.34 });

    if (compact) {
      this.scoreboard.scale.set(1);
      this.scoreboard.position.set(10, 8);

      // Centro entre scoreboard (158) y topControls (w - 126)
      const centerX = 158 + (w - 284) / 2;
      this.stakePillTxt.position.set(centerX, 18);

      this.topControls.position.set(w - 26, 27);

      this.positionDeckAndVira(false);

      // Etiquetas de asientos 2v2 en móvil
      this.seatBadges.partner.container.position.set(w * 0.21, 140);
      this.seatBadges.cpu2.container.position.set(32, cy - 66);
      this.seatBadges.cpu.container.position.set(w - 32, cy - 66);

      for (const seat of ["player", "cpu", "partner", "cpu2"] as PlayerId[]) {
        this.positionBubbleForSeat(seat);
      }

      // Dock inferior con 2 filas táctiles cómodas (sin barra negra abajo)
      this.actionBar.position.set(w / 2, h - 64);
      this.centerToast.position.set(w / 2, 82);
    } else {
      this.scoreboard.scale.set(1);
      this.scoreboard.position.set(20, 7);

      this.stakePillTxt.position.set(w / 2, 20);
      this.topControls.position.set(w - 58, 30);

      this.positionDeckAndVira(false);

      // Etiquetas de asientos 2v2 en desktop
      this.seatBadges.partner.container.position.set(w / 2, 188 * Math.max(0.86, cardScale));
      this.seatBadges.cpu2.container.position.set(Math.max(76, w * 0.095), cy - 96 * cardScale);
      this.seatBadges.cpu.container.position.set(
        Math.min(w - 76, w * 0.905),
        cy - 96 * cardScale,
      );

      for (const seat of ["player", "cpu", "partner", "cpu2"] as PlayerId[]) {
        this.positionBubbleForSeat(seat);
      }

      this.actionBar.position.set(w / 2, h - 42);
      this.centerToast.position.set(cx, Math.max(226, cy - 156 * cardScale));
    }

    this.positionPartnerComms();
    this.updatePartnerCommVisibility();
    this.partnerCommDrawer.layout(w, h);
    this.rulesModal.layout(w, h);
    if (this.inMenu) {
      this.buildMenuOverlay();
    } else if (this.isDealing) {
      this.cancelDealChoreography(true);
    } else {
      this.rebuildDeckAndVira();
      this.updateSeatBadges();
      this.updateStakeAndStatus();
      this.positionTurnAndHelper();
      this.positionAllCards(false);
      this.updateTrickDots();
      this.rebuildActionBar();
      this.updateSummaryOverlay();
    }
  }
}
