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
  Card,
  GameConfig,
  GameState,
  getActiveActor,
  getPlayerLabel,
  getPlayerTeam,
  getTeamLabel,
  PlayerId,
  TRUCO_LEVEL_NAMES,
} from "../engine/types";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  CardView,
  DeckStackView,
  createCardBackGraphics,
} from "./cardRenderer";
import {
  CenterBannerToast,
  PartnerCommDrawer,
  PartnerWhisperPill,
  PillButton,
  SegmentedToggle,
  SparkleSystem,
  SpeechBubble,
  StoneScoreboard,
} from "./components";
import {
  drawIconDiamondCrown,
  drawIconHelp,
  drawIconMenu,
  drawIconPartner,
  drawIconSound,
} from "./icons";
import { soundFX } from "./sound";
import { FONT_DISPLAY, FONT_UI, getFeltGrainTexture, PALETTE } from "./theme";
import { Easing, TweenManager } from "./tween";
import { optimisticFeedback, pendingActionLabel, previewPlayerAction } from "../multiplayer/optimisticAction";
import { formatOnlineSummaryText, isHiddenCardId, mapSeatToViewer } from "../multiplayer/perspective";
import {
  SafeViewerSyncPayload,
  TeamWhisperPayload,
  TrucoRoomClient,
} from "../multiplayer/roomClient";
import { PersistedHostSnapshot } from "../multiplayer/sessionStore";
import { EnvidoBoard } from "./envidoBoard";
import { StakeBoard } from "./stakeBoard";
import { tableChoices, tableStake } from "./tableBids";
import { createRulesDialog } from "./rulesDialog";
import { confirmRematch, startRoomMatch, type RoomAction } from "../multiplayer/rematch";
import { HandResult, type RevealedHand } from "./handResult";
import { RoomChat } from "./roomChat";
import { RoomDirectory } from "./roomDirectory";
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
  private tableCall = new Text({ style: {
    fontFamily: FONT_DISPLAY, fontSize: 37, fontStyle: "italic", fill: 0xdfd9b9,
  } });
  private tableCaller = new Text({ style: {
    fontFamily: FONT_UI, fontSize: 10, fontWeight: "700", letterSpacing: 1.8, fill: 0xc6cdb5,
  } });

  // Deck & Vira
  private deckGroup = new Container();

  // Unified top header bar, scoreboard & top controls
  private headerBarBg = new Graphics();
  private scoreboard = new StoneScoreboard();
  private stakeBoard = new StakeBoard();
  private tableTitle: Text;
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
  private turnStatus = new Text({ style: {
    fontFamily: FONT_UI, fontSize: 12, fontWeight: "600", fill: PALETTE.inkSecondary,
  } });
  private centerToast = new CenterBannerToast();
  private sparkles = new SparkleSystem();
  private envidoBoard: EnvidoBoard;
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
  private settledTableCards = new Set<string>();
  private hoveredHandCardId: string | null = null;
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
  private summaryOverlay: HandResult;
  private rulesModal = createRulesDialog();

  // Multijugador Online (Supabase: Server Postgres/Edge o Realtime endurecido)
  private roomClient!: TrucoRoomClient;
  private waitingAtTable = false;
  private mpLobby!: MultiplayerLobby;
  private directory!: RoomDirectory;
  private chat!: RoomChat;
  private hostEngine: TrucoEngine | null = null;
  private isOnlineMatch = false;
  private confirmedView: SafeViewerSyncPayload | null = null;
  private pendingAction: {
    id: string;
    label: string;
    rematchId?: number;
    slow?: boolean;
    playedSfx?: boolean;
    timer: ReturnType<typeof setTimeout>;
    slowTimer: ReturnType<typeof setTimeout>;
  } | null = null;
  private networkStatus: "idle" | "connecting" | "reconnecting" | "connected" | "error" = "idle";
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
    this.summaryOverlay = new HandResult(app.canvas.parentElement ?? document.body, () => {
      const phase = this.engine.getState().phase;
      if (phase === "HAND_OVER" && !this.pendingAction) {
        soundFX.playCardSlide();
        this.dispatchPlayer({ type: "NEXT_HAND" });
      } else if (phase === "MATCH_OVER") {
        if (this.isOnlineMatch) {
          this.dispatchPlayer({ type: "CONFIRM_REMATCH", matchId: this.engine.getState().rematch?.matchId ?? 0 });
        } else if (!this.roomClient.roomCode) this.startMatch();
      }
    }, () => this.showMenu());
    soundFX.enableOnInteraction();
    this.engine = new TrucoEngine(this.menuConfig);

    this.feltGrainSprite = new TilingSprite({
      texture: getFeltGrainTexture(),
      width: 100,
      height: 100,
    });
    this.feltGrainSprite.alpha = 0.055;

    this.tableTitle = new Text({
      text: "",
      style: {
        fontFamily: FONT_UI,
        fontSize: 11.5,
        fontWeight: "700",
        letterSpacing: 0.3,
        fill: PALETTE.brassLight,
      },
    });
    this.tableTitle.anchor.set(0.5);

    this.envidoBoard = new EnvidoBoard((cardIds) => this.highlightEnvidoHandCards(cardIds));

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
    this.partnerCommDrawer = new PartnerCommDrawer({
      onQuery: (q) => this.handlePartnerQuery(q),
      onCommand: (cmd) => this.handlePartnerCommandAction(cmd),
      onClose: () => {
        this.partnerCommDrawer.visible = false;
      },
    });
    this.overlayLayer.addChild(
      this.menuOverlay,
      this.partnerCommDrawer,
    );

    this.app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.app.canvas.addEventListener("pointerdown", () => {
      if (this.isDealing && !this.inMenu) {
        this.cancelDealChoreography(true);
      }
    });

    this.app.ticker.add((ticker) => {
      this.tweens.update(ticker.deltaMS);
      for (const b of Object.values(this.bubbles)) {
        b.tick(ticker.deltaMS);
      }
      this.partnerWhisper.tick(ticker.deltaMS);
      this.centerToast.tick(ticker.deltaMS);
      this.sparkles.tick(ticker.deltaMS);
    });

    this.app.renderer.on("resize", () => this.layout());
    this.setupMultiplayer();
    this.showMenu();

    // 1) Si el enlace incluye ?sala=CODIGO, abrir el lobby con el código listo
    // 2) Si existe una sesión activa reciente en esta pestaña, reconectar automáticamente
    const savedSession = this.roomClient.getSavedSession();
    if (this.mpLobby.hasPendingUrlCode() && !savedSession) {
      this.directory.suspend();
      this.mpLobby.open(this.menuConfig, { type: "code" });
    } else if (savedSession) {
      if (!savedSession.inMatch) {
        this.directory.suspend();
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
    return w < 780 || h > w * 1.05 || this.isShortLandscape();
  }

  private isShortLandscape(): boolean {
    const { width, height } = this.app.screen;
    return height <= 500 && width >= 520 && width > height * 1.25;
  }

  private headerHeight(): number {
    return this.isShortLandscape() ? 52 : this.isCompactLayout() ? 138 : 60;
  }

  private mobileSeats() {
    const { width: w, height: h } = this.app.screen;
    const landscape = this.isShortLandscape();
    const tableWidth = landscape ? Math.round(w * 0.56) : w;
    const handY = landscape ? (h + 62) / 2 : h - 192;
    // La carta revelada e inclinada necesita más espacio sobre su centro que un dorso.
    const northY = this.headerHeight() + 16 + Math.ceil((CARD_HEIGHT / 2 + 8) * 0.48);
    return {
      tableWidth, northX: tableWidth / 2, northY,
      handX: landscape ? (w + tableWidth) / 2 : w / 2, handY,
      centerY: landscape ? (northY + h - 80) / 2 : (northY + handY - 24) / 2,
    };
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
    this.tableCall.anchor.set(0.5);
    this.tableCaller.anchor.set(0.5);
    this.arenaLayer.addChild(this.arenaSlotsG, this.tableCall, this.tableCaller);
    this.arenaLayer.eventMode = "none";
    this.arenaLayer.interactiveChildren = false;
    this.cardsLayer.sortableChildren = true;

    this.deckLayer.addChild(this.deckGroup);
    this.deckLayer.eventMode = "none";
    this.deckLayer.interactiveChildren = false;

    this.hudLayer.addChild(
      this.headerBarBg,
      this.scoreboard,
      this.tableTitle,
      this.stakeBoard,
      this.trickDotsG,
      this.topControls,
      this.seatBadges.partner.container,
      this.seatBadges.cpu.container,
      this.seatBadges.cpu2.container,
      this.turnStatus,
      this.envidoBoard,
      this.actionBar,
    );

    this.turnStatus.anchor.set(0.5);
    this.turnStatus.eventMode = "none";
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
      label: compact ? "" : "Compañero",
      width: compact ? 44 : 136,
      height: compact ? 44 : 38,
      fontSize: compact ? 12 : 12.5,
      radius: 10,
      theme: "secondary",
      drawIcon: (g, col) => drawIconPartner(g, 14, col),
      onClick: () => this.togglePartnerCommDrawer(),
    });
    this.partnerCommBtn.accessible = true;
    this.partnerCommBtn.accessibleTitle = "Hablar con el compañero";
    this.partnerCommBtn.visible = this.canUsePartnerComms();
    this.hudLayer.addChild(this.partnerCommBtn);
  }

  private canUsePartnerComms(): boolean {
    if (this.inMenu || this.isDealing || !this.is2v2()) return false;
    const phase = this.engine.getState().phase;
    return (
      phase === "PLAYING" ||
      phase === "AWAITING_PRIVE" ||
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
      const seats = this.mobileSeats();
      const whisperY = this.isShortLandscape() ? cy + 54 : seats.northY + 57;
      this.partnerWhisper.setMaxWidth(seats.tableWidth - 28);
      this.partnerWhisper.position.set(seats.northX, whisperY);
      if (this.partnerCommBtn) {
        this.partnerCommBtn.position.set(32, this.mobileSeats().northY);
      }
    } else {
      this.partnerWhisper.setMaxWidth(Math.min(500, w - 180));
      this.partnerWhisper.position.set(w / 2, 218 * Math.max(0.86, cardScale));
      if (this.partnerCommBtn) {
        this.partnerCommBtn.position.set(w - 96, h - 110);
      }
    }
  }

  private buildTopControls(compact: boolean): void {
    if (this.lastCompactTopControls === compact) return;
    this.lastCompactTopControls = compact;
    this.topControls.removeChildren();

    const muted = soundFX.isMuted();

    if (compact) {
      const btnSize = 44;
      const rulesBtn = new PillButton({
        width: btnSize,
        height: btnSize,
        radius: 9,
        theme: "ghost",
        drawIcon: (g, col) => drawIconHelp(g, 17, col),
        onClick: () => {
          this.rulesModal.showModal();
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

      rulesBtn.position.set(-100, 0);
      this.muteBtn.position.set(-50, 0);
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
        this.rulesModal.showModal();
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
    for (const child of this.menuOverlay.removeChildren()) child.destroy({ children: true });
    const { width: w, height: h } = this.app.screen;
    const short = this.isShortLandscape();
    const isNarrow = !short && w < 700;
    const cardW = isNarrow ? Math.min(410, w - 26) : short ? Math.min(820, w - 24) : 920;
    const coverHeight = Math.max(100, Math.min(170, h - 444));
    const cardH = isNarrow ? coverHeight + 416 : short ? Math.min(350, h - 20) : 482;
    const shade = new Graphics().rect(0, 0, w, h).fill(0x102c23);
    shade.rect(10, 10, w - 20, h - 20).stroke({ width: 1, color: 0x617465, alpha: 0.4 });
    shade.eventMode = "static";
    const grain = new TilingSprite({ texture: getFeltGrainTexture(), width: w, height: h });
    grain.alpha = 0.038;
    const panel = new Container();
    panel.position.set(w / 2, h / 2);
    panel.scale.set(Math.min(1, (w - 20) / cardW, (h - 24) / cardH));
    this.menuOverlay.addChild(shade, grain, panel);

    const left = -cardW / 2;
    const top = -cardH / 2;
    const coverW = isNarrow ? cardW : short ? Math.round(cardW * 0.31) : 440;
    const coverH = isNarrow ? coverHeight : cardH;
    const formLeft = isNarrow ? left : left + coverW;
    const formTop = isNarrow ? top + coverH : top;
    const formW = isNarrow ? cardW : cardW - coverW;
    const inset = short ? 14 : isNarrow ? 19 : 35;
    const innerW = formW - inset * 2;
    const x = formLeft + inset;
    const bg = new Graphics()
      .rect(left + 3, top + 6, cardW, cardH).fill({ color: 0x06110d, alpha: 0.55 })
      .rect(left, top, cardW, cardH).fill(PALETTE.ivoryWarm)
      .rect(left, top, coverW, coverH).fill(0x623229)
      .rect(left + 7, top + 7, coverW - 14, coverH - 14).stroke({ width: 1, color: 0xc2a884, alpha: 0.64 })
      .rect(left + 11, top + 11, coverW - 22, coverH - 22).stroke({ width: 0.7, color: 0xc2a884, alpha: 0.45 });
    panel.addChild(bg);
    const heading = new Text({ text: "Privo\ny Truco", style: {
      fontFamily: FONT_DISPLAY, fontSize: isNarrow ? 37 : 56, lineHeight: isNarrow ? 37 : 54,
      fontWeight: "700", fill: PALETTE.ivoryWarm,
    } });
    const titleWidth = isNarrow ? cardW * 0.55 - 10 : coverW - 44;
    heading.scale.set(Math.min(1, titleWidth / heading.width));
    heading.position.set(left + (short ? 20 : isNarrow ? 23 : 38), top + (isNarrow ? 16 : 35));
    const deckLabel = new Text({ text: "BARAJA ESPAÑOLA  /  40 CARTAS", style: {
      fontFamily: FONT_UI, fontSize: isNarrow ? 9 : 11, fontWeight: "700", letterSpacing: 1.5, fill: 0xeee0c8,
    } });
    if (short) deckLabel.scale.set(Math.min(1, (coverW - 40) / deckLabel.width));
    deckLabel.position.set(heading.x, top + coverH - (isNarrow ? 20 : 42));
    panel.addChild(heading, deckLabel);
    const sample = [{ rank: 11, suit: "oros" }, { rank: 1, suit: "bastos" }, { rank: 1, suit: "espadas" }] as const;
    sample.forEach(({ rank, suit }, i) => {
      const card = new CardView({ id: `${rank}_${suit}`, rank, suit }, undefined, true);
      const scale = isNarrow ? Math.min(0.65, cardW / 620) : short ? Math.min(0.72, (coverW - 36) / 220) : 1.02;
      card.scale.set(scale);
      card.rotation = (i - 1) * 0.18;
      const center = isNarrow ? left + cardW * 0.77 : left + coverW / 2;
      card.position.set(center + (i - 1) * 47 * scale,
        top + (isNarrow ? coverH / 2 : short ? coverH * 0.60 : 296) + Math.abs(i - 1) * 9 * scale);
      panel.addChild(card);
    });
    const settings = new Text({ text: "Preparar la mesa", style: {
      fontFamily: FONT_DISPLAY, fontSize: short ? 24 : isNarrow ? 27 : 36, fontWeight: "700", fill: 0x24382b,
    } });
    settings.position.set(x, formTop + (short ? 12 : isNarrow ? 18 : 30));
    panel.addChild(settings);
    const addOptionRow = (
      y: number, label: string, leftLabel: string, rightLabel: string,
      leftActive: boolean, onLeft: () => void, onRight: () => void,
    ) => {
      const lbl = new Text({ text: label.toUpperCase(), style: {
        fontFamily: FONT_UI, fontSize: 11, fontWeight: "800", letterSpacing: 1.4, fill: 0x515849,
      } });
      lbl.position.set(x, short ? y - 5 : y - 39);
      const segW = short ? innerW - 86 : innerW;
      const seg = new SegmentedToggle({ width: segW, height: 44, leftLabel, rightLabel, leftActive, onLeft, onRight });
      seg.position.set(x + innerW - segW / 2, y + 4);
      panel.addChild(lbl, seg);
    };

    addOptionRow(
      formTop + (short ? 78 : isNarrow ? 102 : 132),
      "Mesa",
      "Individual",
      "Por parejas",
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
      formTop + (short ? 132 : isNarrow ? 181 : 219),
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
      formTop + (short ? 186 : isNarrow ? 260 : 306),
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
    const playW = isNarrow ? innerW : short ? (innerW - 16) * 0.4 : 178;
    const onlineW = isNarrow ? (innerW - btnGap) / 2 : short ? (innerW - 16) * 0.3 : 114;
    const rulesW = isNarrow ? onlineW : innerW - playW - onlineW - btnGap * 2;
    const startX = x;

    const playBtn = new PillButton({
      label: "Jugar solo",
      width: playW,
      height: 46,
      fontSize: 14.5,
      radius: 4,
      theme: "danger",
      onClick: () => this.startMatch(),
    });
    playBtn.position.set(startX + playW / 2, cardH / 2 - (isNarrow ? 92 : 48));

    const onlineBtn = new PillButton({
      label: "Volver",
      width: onlineW,
      height: 46,
      fontSize: 13.5,
      radius: 4,
      theme: "secondary",
      onClick: () => {
        this.menuOverlay.visible = false;
        this.directory.show();
      },
    });
    onlineBtn.position.set(startX + (isNarrow ? 0 : playW + btnGap) + onlineW / 2, cardH / 2 - (isNarrow ? 38 : 48));

    const rulesBtn = new PillButton({
      label: "Reglas",
      width: rulesW,
      height: 46,
      fontSize: 13,
      radius: 4,
      theme: "ghost",
      onClick: () => {
        this.rulesModal.showModal();
      },
    });
    rulesBtn.position.set(
      startX + innerW - rulesW / 2,
      cardH / 2 - (isNarrow ? 38 : 48),
    );
    panel.addChild(playBtn, onlineBtn, rulesBtn);
  }

  private setupMultiplayer(): void {
    this.roomClient = new TrucoRoomClient({
      onStatusChange: (status, detail) => {
        this.networkStatus = status;
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
        if (this.isOnlineMatch && !this.inMenu && !this.isDealing) {
          this.updateTurnIndicator();
        }
      },
      onMembersChange: () => {
        this.syncLobbySnapshot();
        if (this.isOnlineMatch && this.engine.getState().phase === "MATCH_OVER") this.updateSummaryOverlay();
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
      onChatChange: (room, messages, initial) => this.chat.receive(room, messages, initial),
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

    this.chat = new RoomChat(this.roomClient.clientId,
      (id, text) => this.roomClient.sendChat(id, text), () => this.roomClient.refreshChat());
    this.mpLobby = new MultiplayerLobby({
      onChatSlot: slot => this.chat.place(slot),
      onTableViewChange: waiting => {
        this.waitingAtTable = waiting;
        if (waiting) this.directory.hide();
        else this.chat.place();
        for (const layer of [this.deckLayer, this.arenaLayer, this.cardsLayer, this.hudLayer,
          this.fxLayer, this.bubbleLayer, this.overlayLayer]) layer.visible = !waiting;
        this.drawTableAndArena();
      },
      onCreateRoom: async (name, cfg, visibility) => {
        try {
          this.menuConfig = { ...cfg };
          await this.roomClient.createRoom(name, cfg, visibility);
          this.syncLobbySnapshot();
        } catch (err) {
          this.mpLobby.setStatus(
            err instanceof Error ? err.message : "No se pudo crear la sala.",
            true,
            false,
          );
        }
      },
      onJoinRoom: async (code, name, publicEntry) => {
        try {
          await this.roomClient.joinRoom(code, name, publicEntry);
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
        soundFX.stopVoices();
        this.resetOnlineState();
        await this.roomClient.leaveRoom(true);
        this.syncLobbySnapshot();
        this.mpLobby.close();
        this.directory.show();
      },
      onClose: () => {
        this.directory.show();
      },
    });
    const hand = new Container();
    const sample = [{ rank: 11, suit: "oros" }, { rank: 1, suit: "bastos" }, { rank: 1, suit: "espadas" }] as const;
    sample.forEach(({ rank, suit }, i) => {
      const card = new CardView({ id: `${rank}_${suit}`, rank, suit }, undefined, true);
      card.position.set((i - 1) * 40, Math.abs(i - 1) * 8);
      card.rotation = (i - 1) * .20;
      hand.addChild(card);
    });
    const cards = this.app.renderer.extract.canvas({ target: hand, resolution: 2 }) as HTMLCanvasElement;
    hand.destroy({ children: true });
    this.directory = new RoomDirectory(cards, {
      list: () => this.roomClient.listPublicRooms(),
      join: room => {
        this.directory.suspend();
        this.mpLobby.open(this.menuConfig, { type: "public", room });
      },
      create: () => {
        this.directory.suspend();
        this.mpLobby.open(this.menuConfig, { type: "create" });
      },
      code: () => {
        this.directory.suspend();
        this.mpLobby.open(this.menuConfig, { type: "code" });
      },
      solo: () => {
        this.buildMenuOverlay();
        this.menuOverlay.visible = true;
        this.directory.hide();
      },
    });
  }

  private resetOnlineState(): void {
    this.chat.setRoom(null);
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
    this.chat.setRoom(this.roomClient.roomCode);
    this.mpLobby.setRoomState({
      roomCode: this.roomClient.roomCode,
      visibility: this.roomClient.visibility,
      inviteCode: this.roomClient.inviteCode,
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
    if (this.isOnlineMatch || !this.roomClient.isHost || !this.roomClient.isConnected()) return;

    if (this.roomClient.backendMode === "server") {
      if (!await this.roomClient.startServerMatch()) {
        this.mpLobby.setStatus("No se pudo iniciar la partida. Intenta de nuevo.", true);
      }
      return;
    }

    const { seatNames, seatClientIds, humanSeats } = this.roomClient.getSeatAssignments();
    this.onlineCanonicalSeatNames = seatNames;
    this.onlineCanonicalSeatClientIds = seatClientIds;
    this.onlineCanonicalHumanSeats = new Set(humanSeats);
    this.hostEngine = new TrucoEngine(this.roomClient.config);
    startRoomMatch(this.hostEngine, humanSeats, this.roomClient.stateVersion + 1);
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
    this.confirmedView = payload;
    if (previous?.version === payload.version) {
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
        // Si falló la petición anterior del bot, el siguiente sondeo reanuda su turno.
        this.scheduleBotIfNeeded();
      }
      return;
    }
    const before = previous?.viewState;
    const next = payload.viewState;
    const turnBegan = getActiveActor(next) === "player" &&
      (!before || getActiveActor(before) !== "player" || before.phase !== next.phase ||
        before.handNumber !== next.handNumber || before.trickIndex !== next.trickIndex);
    const skipOptimisticSfx = Boolean(this.pendingAction?.playedSfx);
    soundFX.playOnlineUpdate(before, next, turnBegan, skipOptimisticSfx);
    if (this.pendingAction?.rematchId === undefined || next.phase !== "MATCH_OVER" ||
        next.rematch?.confirmed.includes("player")) this.clearPendingAction();
    const isFreshMatch = !this.isOnlineMatch || this.inMenu ||
      (before?.phase === "MATCH_OVER" && next.phase !== "MATCH_OVER") ||
      (before?.rematch && next.rematch && before.rematch.matchId !== next.rematch.matchId);

    this.isOnlineMatch = true;
    this.inMenu = false;
    this.burnMode = false;
    this.directory.hide();
    this.menuOverlay.visible = false;
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

  private handleRemotePlayerAction(canonicalSeat: PlayerId, action: RoomAction): boolean {
    if (!this.isOnlineMatch || !this.roomClient.isHost || !this.hostEngine) return false;
    const s = this.hostEngine.getState();

    if (action.type === "CONFIRM_REMATCH") {
      const players = [...this.onlineCanonicalHumanSeats];
      const online = players.filter(seat => this.roomClient.isSeatOnline(seat, this.onlineCanonicalSeatClientIds));
      if (!confirmRematch(this.hostEngine, canonicalSeat, action.matchId, players, online)) return false;
      this.broadcastAndApplyHostState();
      return true;
    }
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

  private seatLabel(seat: PlayerId): string {
    const mode = this.engine.getState().config.mode;
    if (this.isOnlineMatch) {
      if (this.onlineSeatNames[seat]) return this.onlineSeatNames[seat];
      if (mode === "1v1" && seat === "cpu" && this.onlineHumanSeats.has(seat)) return "Rival";
    }
    return getPlayerLabel(seat, mode);
  }

  private getDisplaySeatName(seat: PlayerId, compact = false): string {
    if (this.isOnlineMatch && this.onlineSeatNames[seat]) {
      const raw = this.seatLabel(seat);
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
      if (mode === "1v1") return this.seatLabel(seat).toUpperCase();
      return seat === "cpu" ? "DER" : "IZQ";
    }
    return this.seatLabel(seat).toUpperCase();
  }

  private showMenu(): void {
    soundFX.stopVoices();
    this.clearBotTimer();
    this.cancelDealChoreography(false);
    if (this.isOnlineMatch) {
      this.resetOnlineState();
      void this.roomClient.leaveRoom(true);
    }
    this.inMenu = true;
    this.stakeBoard.visible = false;
    this.clearActionBar();
    this.directory.show();
    this.menuOverlay.visible = false;
    this.summaryOverlay.hide();
    this.partnerCommDrawer.visible = false;
    this.partnerWhisper.hide();
    this.lastPartnerMsg = null;
    this.lastAutoCalloutKey = null;
    this.partnerHint = {};
    this.updatePartnerCommVisibility();
    this.setTurnStatus("");
    this.seatBadges.partner.container.visible = false;
    this.seatBadges.cpu.container.visible = false;
    this.seatBadges.cpu2.container.visible = false;
    this.layout();
  }

  private startMatch(): void {
    soundFX.stopVoices();
    this.clearBotTimer();
    this.cancelDealChoreography(false);
    if (this.isOnlineMatch) {
      this.resetOnlineState();
      void this.roomClient.leaveRoom(true);
    }
    this.inMenu = false;
    this.burnMode = false;
    this.directory.hide();
    this.menuOverlay.visible = false;
    this.summaryOverlay.hide();
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
      this.tweens.cancel(child);
      child.destroy({ children: true });
    }
    this.isDealing = false;
    this.deckGroup.visible = true;

    if (snapToReady && !this.inMenu) {
      for (const cv of this.cardViews.values()) {
        this.tweens.cancel(cv);
        cv.resetFlip();
        cv.setElevation(0);
        cv.setHighlighted(false);
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

  /**
   * Anima un giro 3D físico de carta (dorso ↔ cara) sin interferir con el vuelo ni el escalado.
   */
  private animateCardFlip(
    cv: CardView,
    toFaceUp: boolean,
    durationMs = 210,
    delayMs = 0,
    playSound = false,
  ): void {
    if (cv.faceUp === toFaceUp) {
      cv.resetFlip();
      return;
    }
    const fromFaceUp = cv.faceUp;
    let playedSfx = false;
    this.tweens.run(
      cv,
      durationMs,
      Easing.easeInOutCubic,
      (_rawT, easedT) => {
        if (playSound && !playedSfx) {
          playedSfx = true;
          soundFX.playCardFlip();
        }
        cv.applyFlip(easedT, fromFaceUp, toFaceUp);
      },
      () => {
        cv.setFaceUp(toFaceUp);
        cv.resetFlip();
      },
      "flip",
      delayMs,
    );
  }

  /**
   * Calcula una curvatura natural de muñeca perpendicular al desplazamiento + ligera parábola vertical.
   */
  private computeArcOffset(
    sx: number,
    sy: number,
    tx: number,
    ty: number,
    bend = 0.13,
    loft = 16,
  ): { curveX: number; curveY: number } {
    const dx = tx - sx;
    const dy = ty - sy;
    const dist = Math.hypot(dx, dy);
    if (dist < 8) return { curveX: 0, curveY: 0 };
    const nx = -dy / dist;
    const ny = dx / dist;
    const mag = Math.min(64, dist * bend);
    return {
      curveX: nx * mag,
      curveY: ny * mag - Math.min(loft, dist * 0.08),
    };
  }

  private clearPendingAction(): void {
    if (this.pendingAction) {
      clearTimeout(this.pendingAction.timer);
      clearTimeout(this.pendingAction.slowTimer);
    }
    this.pendingAction = null;
    this.actionBar.alpha = 1;
    this.actionBar.interactiveChildren = true;
  }

  private recoverPendingAction(id: string): void {
    if (this.pendingAction?.id !== id || !this.confirmedView) return;
    this.clearPendingAction();
    this.bubbles.player.hide();
    this.engine.loadExternalState(this.confirmedView.viewState);
    this.syncFromState(false);
    this.centerToast.show("Jugada sin confirmar", "Sincronizando la mesa…", PALETTE.brass, 2200);
    this.roomClient.requestCurrentView();
  }

  private submitOnlineAction(action: RoomAction): void {
    const base = this.confirmedView;
    if (!base || this.pendingAction) return;
    const id = `${this.roomClient.clientId}-${Date.now()}-${++this.actionSequence}`;
    const nextTrucoLevel = this.engine.getLegalActions("player").nextTrucoLevel;
    const label = pendingActionLabel(action, base.viewState, nextTrucoLevel);
    const fb = optimisticFeedback(action, base.viewState, nextTrucoLevel);

    this.pendingAction = {
      id,
      label,
      rematchId: action.type === "CONFIRM_REMATCH" ? action.matchId : undefined,
      playedSfx: Boolean(fb.sound),
      timer: setTimeout(() => this.recoverPendingAction(id), 5000),
      slowTimer: setTimeout(() => {
        if (this.pendingAction?.id === id) {
          this.pendingAction.slow = true;
          this.updateTurnIndicator();
        }
      }, 1200),
    };

    if (fb.sound === "card") soundFX.playCardSlap();
    else if (fb.sound === "call") soundFX.playCall();
    else if (fb.sound === "response") soundFX.playCall(true);

    if (fb.bubble) {
      const accent =
        fb.accent === "flor"
          ? PALETTE.brass
          : fb.accent === "truco"
            ? PALETTE.crimson
            : PALETTE.brassSoft;
      this.positionBubbleForSeat("player");
      this.bubbles.player.show(fb.bubble, accent, this.isCompactLayout() ? 1350 : 1800);
      this.positionBubbleForSeat("player");
    }

    if (action.type !== "CONFIRM_REMATCH") this.engine.loadExternalState(previewPlayerAction(base.viewState, action));
    const sent = this.roomClient.sendPlayerAction(action, id, base.version);
    if (action.type === "PLAY_CARD") this.tableCall.visible = this.tableCaller.visible = false;
    this.positionAllCards(false);
    this.updateTurnIndicator();
    this.rebuildActionBar();
    if (action.type === "NEXT_HAND" || action.type === "CONFIRM_REMATCH") this.updateSummaryOverlay();
    void sent.then((ok) => {
      if (!ok) this.recoverPendingAction(id);
    });
  }

  private dispatchPlayer(action: RoomAction): void {
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

    if (action.type === "CONFIRM_REMATCH") return;
    this.engine.dispatch("player", action);
    this.syncFromState(false);
  }

  private getActiveActor(): PlayerId | null {
    return getActiveActor(this.engine.getState());
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
        const baseDelay = isOfflineHuman ? 14_000 : isFreshDealLead ? BOT_OPENING_MS : BOT_REPLY_MS;
        const delay = this.roomClient.isPrimaryBotDriver() ? baseDelay : baseDelay + 1400;
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
      const canonicalActive = getActiveActor(this.hostEngine.getState());
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
        const freshActive = getActiveActor(this.hostEngine.getState());
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

    const previousEventId = this.lastEventId;

    // 1) Audio, globos de canto y destellos
    if (s.lastEvent && s.lastEvent.id !== this.lastEventId) {
      if (!this.isOnlineMatch) soundFX.playNewCantos(s.log, this.lastEventId);
      this.lastEventId = s.lastEvent.id;
      const ev = s.lastEvent;
      if (!this.isOnlineMatch) soundFX.playEvent(ev.type, s.matchWinner === "nosotros");

      const awaitingResponse =
        s.phase === "AWAITING_PRIVE" ||
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
      } else if (ev.type === "flor_result") {
        this.sparkles.burst(cx, cy, PALETTE.brassLight, 14);
      } else if (ev.type === "envido_result") {
        this.sparkles.burst(cx, cy, PALETTE.acceptBorder, 10);
      } else if (ev.type === "trick_win") {
        const prevTrick = s.tricks[s.trickIndex - 1];
        const namedWinner = this.isOnlineMatch && prevTrick?.winnerPlayer
          ? this.onlineSeatNames[prevTrick.winnerPlayer]
          : undefined;
        const ourTrick = prevTrick?.winnerTeam === "nosotros";
        if (ourTrick) this.sparkles.burst(cx, cy, PALETTE.brassLight, 8);
        if ((ourTrick || prevTrick?.winnerTeam === "ellos") && !this.isCompactLayout()) {
          let title = ourTrick ? "Baza tuya" : "Baza de la CPU";
          if (this.is2v2()) title = ourTrick ? "Baza de Nosotros" : "Baza de Ellos";
          if (namedWinner) title = `Baza de ${namedWinner}`;
          else if (this.isOnlineMatch && !this.is2v2() && !ourTrick) title = `Baza de ${this.seatLabel("cpu")}`;
          this.centerToast.show(
            title,
            `Sale ${this.seatLabel(s.turn)}`,
            ourTrick ? PALETTE.acceptBorder : PALETTE.crimsonBorder,
            1050,
          );
        } else if (prevTrick?.winnerTeam === "parda" && !this.isCompactLayout()) {
          this.centerToast.show(
            "Baza Parda",
            `Empate · vuelve a salir ${this.seatLabel(s.turn)}`,
            PALETTE.brass,
            1150,
          );
        }
      } else if (ev.type === "hand_end") {
        if (s.handSummary?.trickWinnerTeam === "nosotros") {
          this.sparkles.burst(cx, cy, PALETTE.brassLight, 12);
        }
      } else if (ev.type === "match_end") {
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
        this.isOnlineMatch && s.config.mode === "1v1"
          ? { ellos: this.seatLabel("cpu") }
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
        (s.phase !== "PLAYING" && s.prive?.next !== "ASK_PRIVE") ||
        s.envido.chain.length > 0 ||
        s.truco.level > 0 ||
        s.flor.stage !== "none";
      if (this.isOnlineMatch && hasMidHandProgress) {
        this.isDealing = false;
        this.deckGroup.visible = true;
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
      this.isOnlineMatch && s.config.mode === "1v1"
        ? { ellos: this.seatLabel("cpu") }
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
    const endedOnCard = (s.phase === "HAND_OVER" || s.phase === "MATCH_OVER") &&
      s.log.some(ev => ev.id > previousEventId && (ev.type === "play_card" || ev.type === "burn_card"));
    this.updateSummaryOverlay(endedOnCard);

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
      return compact ? { x: this.mobileSeats().handX, y: this.mobileSeats().handY } :
        { x: w / 2, y: h - 186 * Math.max(0.84, cardScale) };
    }
    if (seat === "partner" || (!isFour && seat === "cpu")) {
      return {
        x: compact ? this.mobileSeats().northX : w / 2,
        y: compact ? this.mobileSeats().northY : 122 * Math.max(0.85, cardScale),
      };
    }
    if (seat === "cpu2") {
      return { x: compact ? 52 : Math.max(106, w * 0.13), y: cy };
    }
    // cpu (Rival Der en 2v2)
    return { x: compact ? this.mobileSeats().tableWidth - 52 : Math.min(w - 106, w * 0.87), y: cy };
  }

  private getSeatHandTarget(
    seat: PlayerId,
    idx: number,
    totalCount: number,
    revealed = false,
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
      const topScale = compact ? (revealed ? 0.48 : 0.43) : cardScale * (revealed ? 0.72 : 0.64);
      const centerX = compact ? this.mobileSeats().northX : w / 2;
      const spreadX = compact ? (revealed ? 32 : 26) : (revealed ? 82 : 74) * topScale;
      return {
        x: centerX + offset * spreadX,
        y: compact
          ? this.mobileSeats().northY + Math.abs(offset) * 3
          : 132 * Math.max(0.88, cardScale) + Math.abs(offset) * 3,
        rot: -offset * 0.07,
        scale: topScale,
      };
    }

    // Asientos laterales en 2v2 (cpu2 Izq, cpu Der)
    const isLeft = seat === "cpu2";
    const sideScale = compact ? (revealed ? 0.42 : 0.36) : cardScale * (revealed ? 0.66 : 0.56);
    const sideX = isLeft
      ? compact
        ? 42
        : Math.max(76, w * 0.095)
      : compact
        ? this.mobileSeats().tableWidth - 42
        : Math.min(w - 76, w * 0.905);
    const spreadY = compact ? 10 : 44 * sideScale;
    const offset = idx - (totalCount - 1) / 2;
    return {
      x: sideX + (revealed ? (isLeft ? 10 : -10) : 0),
      y: cy + offset * spreadY,
      rot: revealed ? 0 : (isLeft ? 1 : -1) * (Math.PI / 2 + offset * 0.05),
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
    const dealerLabel = this.seatLabel(dealer);

    const compact = this.isCompactLayout();
    const { cx, cy, cardScale } = this.getArenaMetrics();
    const dealerAnchor = this.getSeatAnchorPos(dealer);
    const shufflePos = {
      x: dealerAnchor.x + (cx - dealerAnchor.x) * 0.34,
      y: dealerAnchor.y + (cy - dealerAnchor.y) * 0.34,
    };
    const deckScale = compact ? 0.43 : Math.max(0.72, cardScale);

    this.isDealing = true;
    this.clearActionBar();
    this.deckGroup.visible = false;
    this.envidoBoard.visible = false;
    this.updateSeatBadges();

    for (const cv of this.cardViews.values()) {
      this.tweens.cancel(cv);
      cv.visible = false;
      cv.resetFlip();
      cv.setFaceUp(false);
      cv.setElevation(0);
      cv.position.set(shufflePos.x, shufflePos.y);
      cv.scale.set(deckScale * 0.78);
      cv.rotation = 0;
      cv.alpha = 1;
    }

    const shuffleContainer = new Container();
    shuffleContainer.position.set(shufflePos.x, shufflePos.y);
    shuffleContainer.scale.set(deckScale);
    shuffleContainer.zIndex = 5;

    const mergedDeck = new DeckStackView(0);
    const leftPacket = new DeckStackView(20);
    const rightPacket = new DeckStackView(20);
    // Inicialmente el paquete superior descansa justo encima del inferior (baraja completa de 40)
    const splitTop = leftPacket.getTopOffset();
    rightPacket.position.set(splitTop.x, splitTop.y);
    const riffleLayer = new Container();

    shuffleContainer.addChild(mergedDeck, leftPacket, rightPacket, riffleLayer);
    this.dealFxContainer.addChild(shuffleContainer);

    let remainingInDeck = 40;
    const getDeckTopWorldPos = (): { x: number; y: number } => {
      const top = mergedDeck.getTopOffset();
      return {
        x: shufflePos.x + top.x * deckScale,
        y: shufflePos.y + top.y * deckScale,
      };
    };
    const peelFromDeck = (): { x: number; y: number } => {
      const pos = getDeckTopWorldPos();
      remainingInDeck = Math.max(0, remainingInDeck - 1);
      mergedDeck.setCardCount(remainingInDeck);
      return pos;
    };

    const setDealBanner = (text: string) => {
      this.setTurnStatus(text, true);
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

    // --- FASE 1: BARAJAR REAL DE 40 CARTAS + CORTE (0ms - 730ms) ---
    setDealBanner(`${dealerLabel} barajando… · Toca para saltar`);

    // 1A) Separación de los dos paquetes de 20 cartas en arco suave
    this.tweens.to(
      leftPacket,
      { x: -48, y: 4, rotation: -0.15 },
      150,
      Easing.easeOutQuart,
      undefined,
      { curveY: -10 },
    );
    this.tweens.to(
      rightPacket,
      { x: 48, y: 4, rotation: 0.15 },
      150,
      Easing.easeOutQuart,
      undefined,
      { curveY: -16 },
    );

    // 1B) Riffle intercalado de 10 hojas reales entre ambos paquetes hacia el mazo central
    this.scheduleDealStep(155, () => {
      soundFX.playShuffleRiffle();
      const leafCount = 10;
      let leftLeft = 20;
      let rightLeft = 20;
      let stacked = 0;

      for (let i = 0; i < leafCount; i++) {
        const fromLeft = i % 2 === 0;
        const leafDelay = i * 24;
        this.scheduleDealStep(leafDelay, () => {
          if (shuffleContainer.destroyed) return;
          const sourcePacket = fromLeft ? leftPacket : rightPacket;
          const srcTop = sourcePacket.getTopOffset();
          const leaf = createCardBackGraphics(true);
          leaf.position.set(sourcePacket.x + srcTop.x, sourcePacket.y + srcTop.y);
          leaf.rotation = fromLeft ? -0.15 : 0.15;
          riffleLayer.addChild(leaf);

          if (fromLeft) {
            leftLeft = Math.max(0, leftLeft - 4);
            leftPacket.setCardCount(leftLeft);
          } else {
            rightLeft = Math.max(0, rightLeft - 4);
            rightPacket.setCardCount(rightLeft);
          }

          const destTop = mergedDeck.getTopOffset();
          this.tweens.to(
            leaf,
            {
              x: destTop.x + (fromLeft ? -0.5 : 0.5),
              y: destTop.y - 1,
              rotation: (fromLeft ? 1 : -1) * 0.015,
            },
            130,
            Easing.easeInOutSine,
            () => {
              stacked = Math.min(40, stacked + 4);
              mergedDeck.setCardCount(stacked);
              if (!leaf.destroyed) leaf.destroy();
            },
            { curveY: -22, liftScale: 0.06 },
          );
        });
      }
    });

    // 1C) Corte clásico de baraja española y cuadre final
    this.scheduleDealStep(455, () => {
      leftPacket.visible = false;
      rightPacket.visible = false;
      mergedDeck.setCardCount(22);

      const cutPacket = new DeckStackView(18);
      const cutStart = mergedDeck.getTopOffset();
      cutPacket.position.set(cutStart.x, cutStart.y);
      shuffleContainer.addChild(cutPacket);
      soundFX.playCardSlide();

      this.tweens.to(
        cutPacket,
        { x: 56, y: cutStart.y - 12, rotation: 0.08 },
        125,
        Easing.easeOutQuart,
        () => {
          if (cutPacket.destroyed) return;
          this.tweens.to(
            cutPacket,
            { x: cutStart.x, y: cutStart.y, rotation: 0 },
            125,
            Easing.easeInOutCubic,
            () => {
              soundFX.playDeckCut();
              mergedDeck.setCardCount(40);
              if (!cutPacket.destroyed) cutPacket.destroy({ children: true });
              // Micro-asentamiento táctil al cuadrar el mazo
              mergedDeck.y = 2;
              this.tweens.to(mergedDeck, { y: 0 }, 90, Easing.easeOutQuart);
            },
            { curveY: -18 },
          );
        },
        { curveY: -14 },
      );
    });

    // Helper para lanzar una carta directa del mazo en arco fluido con giro 3D opcional
    const launchDirectCard = (seat: PlayerId, round: number, atMs: number) => {
      const card = (s.hands[seat] ?? [])[round];
      if (!card) return;
      const cv = this.cardViews.get(`${seat}_${card.id}`);
      if (!cv) return;
      const target = this.getSeatHandTarget(seat, round, 3);

      this.scheduleDealStep(atMs, () => {
        const startPos = peelFromDeck();
        const arc = this.computeArcOffset(startPos.x, startPos.y, target.x, target.y, 0.12, 22);
        const spinDir = target.x >= startPos.x ? -1 : 1;

        cv.visible = true;
        cv.resetFlip();
        cv.setFaceUp(false);
        cv.position.set(startPos.x, startPos.y);
        cv.scale.set(deckScale * 0.78);
        cv.rotation = target.rot + spinDir * 0.34;
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
          295,
          Easing.easeOutQuart,
          () => cv.setElevation(0),
          {
            curveX: arc.curveX,
            curveY: arc.curveY,
            liftScale: 0.085,
            onUpdate: (rawT) => {
              cv.setElevation(Math.sin(rawT * Math.PI) * 0.95);
            },
          },
        );
        if (seat === "player") {
          this.animateCardFlip(cv, true, 200, 95);
        }
      });
    };

    // --- FASE 2: REPARTICIÓN ---
    let cursorMs = 745;

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
        const antepieLbl = this.seatLabel(antepieSeat);
        const manoLbl = this.seatLabel(manoSeat);
        const isHumanPeeking = antepieSeat === "player";
        const scale = isHumanPeeking ? humanPeekScale : botPeekScale;
        const holdMs = isHumanPeeking ? 760 : 480;

        this.scheduleDealStep(cursorMs, () => {
          setDealBanner(
            isHumanPeeking
              ? `Ves ${getCardName(manoFirstCard, s.vira)} → ${manoLbl}`
              : `${antepieLbl} la ve y pasa a ${manoLbl}`,
          );
          const startPos = peelFromDeck();
          const arc = this.computeArcOffset(startPos.x, startPos.y, antepiePeek.x, antepiePeek.y, 0.14, 24);
          manoFirstCv.visible = true;
          manoFirstCv.resetFlip();
          manoFirstCv.setFaceUp(false);
          manoFirstCv.setHighlighted(true);
          manoFirstCv.position.set(startPos.x, startPos.y);
          manoFirstCv.scale.set(deckScale * 0.78);
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
            275,
            Easing.easeOutQuart,
            () => manoFirstCv.setElevation(0.65),
            {
              curveX: arc.curveX,
              curveY: arc.curveY,
              liftScale: 0.1,
              onUpdate: (rawT) => {
                manoFirstCv.setElevation(Math.sin(rawT * Math.PI) * 0.6 + rawT * 0.65);
              },
            },
          );
          if (isHumanPeeking) {
            this.animateCardFlip(manoFirstCv, true, 210, 70, true);
          }
        });

        this.scheduleDealStep(cursorMs + 275 + holdMs, () => {
          manoFirstCv.setHighlighted(false);
          if (manoSeat !== "player" && manoFirstCv.faceUp) {
            this.animateCardFlip(manoFirstCv, false, 175, 0);
          }
          const arc = this.computeArcOffset(
            manoFirstCv.x,
            manoFirstCv.y,
            manoTarget.x,
            manoTarget.y,
            0.13,
            20,
          );
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
            285,
            Easing.easeOutQuart,
            () => manoFirstCv.setElevation(0),
            {
              curveX: arc.curveX,
              curveY: arc.curveY,
              liftScale: 0.08,
              onUpdate: (rawT) => {
                manoFirstCv.setElevation((1 - rawT) * 0.65 + Math.sin(rawT * Math.PI) * 0.45);
              },
            },
          );
          if (manoSeat === "player") {
            this.animateCardFlip(manoFirstCv, true, 200, 95);
          }
        });

        cursorMs += 275 + holdMs + 300;
      }

      // 2B) El que baraja saca otra carta, la ve claramente fuera del mazo y se la pasa a su compañero (trasmano)
      const trasFirstCard = (s.hands[trasmanoSeat] ?? [])[0];
      const trasFirstCv = trasFirstCard
        ? this.cardViews.get(`${trasmanoSeat}_${trasFirstCard.id}`)
        : undefined;

      if (trasFirstCv && trasFirstCard) {
        const dealerPeek = getInspectPoint(dealer, true);
        const trasTarget = this.getSeatHandTarget(trasmanoSeat, 0, 3);
        const trasLbl = this.seatLabel(trasmanoSeat);
        const isHumanPeeking = dealer === "player";
        const scale = isHumanPeeking ? humanPeekScale : botPeekScale;
        const holdMs = isHumanPeeking ? 760 : 500;

        this.scheduleDealStep(cursorMs, () => {
          setDealBanner(
            isHumanPeeking
              ? `Ves ${getCardName(trasFirstCard, s.vira)} → ${trasLbl}`
              : `${dealerLabel} saca, la ve y pasa a ${trasLbl}`,
          );
          const startPos = peelFromDeck();
          const arc = this.computeArcOffset(startPos.x, startPos.y, dealerPeek.x, dealerPeek.y, 0.14, 24);
          trasFirstCv.visible = true;
          trasFirstCv.resetFlip();
          trasFirstCv.setFaceUp(false);
          trasFirstCv.setHighlighted(true);
          trasFirstCv.position.set(startPos.x, startPos.y);
          trasFirstCv.scale.set(deckScale * 0.78);
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
            275,
            Easing.easeOutQuart,
            () => trasFirstCv.setElevation(0.65),
            {
              curveX: arc.curveX,
              curveY: arc.curveY,
              liftScale: 0.1,
              onUpdate: (rawT) => {
                trasFirstCv.setElevation(Math.sin(rawT * Math.PI) * 0.6 + rawT * 0.65);
              },
            },
          );
          if (isHumanPeeking) {
            this.animateCardFlip(trasFirstCv, true, 210, 70, true);
          }
        });

        this.scheduleDealStep(cursorMs + 275 + holdMs, () => {
          trasFirstCv.setHighlighted(false);
          if (trasmanoSeat !== "player" && trasFirstCv.faceUp) {
            this.animateCardFlip(trasFirstCv, false, 175, 0);
          }
          const arc = this.computeArcOffset(
            trasFirstCv.x,
            trasFirstCv.y,
            trasTarget.x,
            trasTarget.y,
            0.13,
            20,
          );
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
            285,
            Easing.easeOutQuart,
            () => trasFirstCv.setElevation(0),
            {
              curveX: arc.curveX,
              curveY: arc.curveY,
              liftScale: 0.08,
              onUpdate: (rawT) => {
                trasFirstCv.setElevation((1 - rawT) * 0.65 + Math.sin(rawT * Math.PI) * 0.45);
              },
            },
          );
          if (trasmanoSeat === "player") {
            this.animateCardFlip(trasFirstCv, true, 200, 95);
          }
        });

        cursorMs += 275 + holdMs + 300;
      }

      // 2C) Resto del reparto hasta completar 3 cartas por jugador
      this.scheduleDealStep(cursorMs, () => {
        setDealBanner(`${dealerLabel} repartiendo el resto…`);
      });

      const restStepMs = 74;
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
      cursorMs += 220;
    } else {
      // 1 vs 1: reparto 1 a 1 clásico
      this.scheduleDealStep(cursorMs, () => {
        setDealBanner(`${dealerLabel} repartiendo…`);
      });
      const stepMs = 98;
      for (let round = 0; round < 3; round++) {
        for (let offset = 0; offset < seats.length; offset++) {
          const seat = seats[(manoIdx + offset) % seats.length];
          launchDirectCard(seat, round, cursorMs);
          cursorMs += stepMs;
        }
      }
      cursorMs += 230;
    }

    // --- FASE 3: DE ÚLTIMO, VOLTEO 3D DE LA VIRA Y ACOPLE BAJO EL MAZO ---
    const viraStartMs = cursorMs;
    const viraScale = compact ? 0.62 : Math.max(0.76, cardScale * 0.88);
    let flyingVira: CardView | null = null;

    this.scheduleDealStep(viraStartMs, () => {
      setDealBanner(`La Vira: ${getCardName(s.vira)}`);
      const startPos = peelFromDeck();
      const arc = this.computeArcOffset(startPos.x, startPos.y, cx, cy, 0.14, 28);

      flyingVira = new CardView(s.vira, s.vira, false);
      flyingVira.setHighlighted(true);
      flyingVira.position.set(startPos.x, startPos.y);
      flyingVira.scale.set(deckScale * 0.78);
      flyingVira.rotation = 0.22;
      flyingVira.zIndex = 8;
      this.dealFxContainer.addChild(flyingVira);

      this.animateCardFlip(flyingVira, true, 250, 40, true);
      this.scheduleDealStep(185, () => {
        soundFX.playCardSlap();
        this.sparkles.burst(cx, cy, 0xffd75e, 14);
      });

      this.tweens.to(
        flyingVira,
        {
          x: cx,
          y: cy,
          rotation: -0.05,
          scaleX: viraScale,
          scaleY: viraScale,
        },
        310,
        Easing.easeOutQuart,
        () => flyingVira?.setElevation(0.55),
        {
          curveX: arc.curveX,
          curveY: arc.curveY,
          liftScale: 0.15,
          onUpdate: (rawT) => {
            flyingVira?.setElevation(Math.sin(rawT * Math.PI) * 1.1 + rawT * 0.55);
          },
        },
      );
    });

    // Asentar la Vira justo debajo del mazo de 33/27 cartas en la posición de la Mano
    const settleMs = viraStartMs + 540;
    this.scheduleDealStep(settleMs, () => {
      const finalDeckPos = this.getDeckScreenPos();
      const settledScale = deckScale * 0.76;
      const deckTargetX = finalDeckPos.x + 18 * deckScale;
      const deckTargetY = finalDeckPos.y + 4 * deckScale;
      const deckArc = this.computeArcOffset(
        shuffleContainer.x,
        shuffleContainer.y,
        deckTargetX,
        deckTargetY,
        0.08,
        14,
      );

      soundFX.playCardSlide();
      this.tweens.to(
        shuffleContainer,
        {
          x: deckTargetX,
          y: deckTargetY,
          scaleX: settledScale,
          scaleY: settledScale,
        },
        300,
        Easing.easeInOutCubic,
        undefined,
        { curveX: deckArc.curveX, curveY: deckArc.curveY },
      );

      if (flyingVira) {
        flyingVira.setHighlighted(false);
        // Colocar la Vira detrás del mazo para que entre suavemente por debajo
        flyingVira.zIndex = 2;
        const viraTargetX = finalDeckPos.x - 36 * deckScale;
        const viraTargetY = finalDeckPos.y + 8 * deckScale;
        const viraArc = this.computeArcOffset(
          flyingVira.x,
          flyingVira.y,
          viraTargetX,
          viraTargetY,
          0.1,
          12,
        );
        this.tweens.to(
          flyingVira,
          {
            x: viraTargetX,
            y: viraTargetY,
            rotation: -0.16,
            scaleX: settledScale,
            scaleY: settledScale,
          },
          300,
          Easing.easeInOutCubic,
          () => flyingVira?.setElevation(0),
          {
            curveX: viraArc.curveX,
            curveY: viraArc.curveY,
            onUpdate: (rawT) => {
              flyingVira?.setElevation((1 - rawT) * 0.55);
            },
          },
        );
      }
    });

    // Finalizar coreografía y habilitar la mano sin ningún salto visual
    this.scheduleDealStep(settleMs + 320, () => {
      for (const child of this.dealFxContainer.removeChildren()) {
        this.tweens.cancel(child);
        child.destroy({ children: true });
      }
      this.isDealing = false;
      this.deckGroup.visible = true;
      this.positionDeckAndVira(false);

      if (!this.isCompactLayout() && s.phase === "PLAYING") {
        const manoLabel = this.seatLabel(s.mano);
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
      badge.txt.scale.set(1);
      if (compact) {
        const maxWidth = badge === this.seatBadges.partner ? this.mobileSeats().tableWidth * 0.64 : 66;
        badge.txt.scale.set(Math.min(1, maxWidth / badge.txt.width));
      }
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
      this.setTurnStatus("");
      return;
    }

    const s = this.engine.getState();
    const active = this.getActiveActor();
    const compact = this.isCompactLayout();

    if (this.isOnlineMatch && (this.networkStatus === "reconnecting" || this.networkStatus === "error")) {
      this.setTurnStatus(
        this.networkStatus === "reconnecting"
          ? "Reconectando a la mesa…"
          : "Conexión inestable · Sincronizando…",
        true,
      );
      return;
    }

    if (this.pendingAction) {
      this.setTurnStatus(
        this.pendingAction.slow
          ? `${this.pendingAction.label} (conexión lenta…)`
          : this.pendingAction.label,
      );
      return;
    }
    if (!active) {
      this.setTurnStatus("");
      return;
    }

    if (s.phase === "AWAITING_PRIVE" && s.prive) {
      const who = this.seatLabel(active);
      const ask = s.prive.next === "ASK_PRIVE";
      const declare = s.prive.next === "DECLARE_PRIVE";
      this.setTurnStatus(active === "player"
        ? (ask ? "Pregunta el prive" : declare ? "Canta tus tantos" : "Responde al prive")
        : (ask ? `Esperando la pregunta de ${who}` : `Esperando a ${who}`), active === "player");
      return;
    }

    if (active === "player") {
      const legal = this.engine.getLegalActions("player");
      if (this.burnMode) {
        this.setTurnStatus("Modo quemar · Toca una carta", true);
      } else if (legal.mustCallFlorALey) {
        this.setTurnStatus("Canta tu flor", true);
      } else if (s.phase === "AWAITING_TRUCO") {
        const lvl = s.truco.pendingLevel ?? 1;
        this.setTurnStatus(`Responde ${TRUCO_LEVEL_NAMES[lvl]}`, true);
      } else if (s.phase === "AWAITING_ENVIDO") {
        this.setTurnStatus("Responde Envido", true);
      } else if (s.phase === "AWAITING_FLOR") {
        this.setTurnStatus("Responde Flor", true);
      } else if (s.ley.declaredBy.includes("player") && s.trickIndex === 0) {
        this.setTurnStatus("Tu turno · A Ley");
      } else {
        this.setTurnStatus("Tu turno");
      }
    } else {
      const who = this.seatLabel(active);
      const isOffline = this.isOnlineMatch && this.onlineOfflineSeats.has(active);
      const label = compact
        ? `${who}${isOffline ? " (Bot)" : ""}`
        : isOffline
          ? `${who} desconectado · Bot suplente`
          : s.phase === "PLAYING"
            ? `Turno de ${who}`
            : `${who} respondiendo`;
      this.setTurnStatus(label);
    }
  }

  private setTurnStatus(label: string, urgent = false): void {
    this.turnStatus.text = label;
    this.turnStatus.style.fill = urgent ? PALETTE.brassLight : PALETTE.inkSecondary;
    this.turnStatus.scale.set(1);
    const w = this.app.screen.width;
    const online = this.isOnlineMatch;
    const available = this.isShortLandscape() ? w - 2 * (online ? 210 : 165) :
      this.isCompactLayout() ? w - 144 : w - (online ? 626 : 510);
    this.turnStatus.scale.set(Math.min(1, available / Math.max(1, this.turnStatus.width)));
  }

  private getEnvidoBoardLayout(): { x: number; y: number; width: number; compact: boolean } {
    const { width: w, height: h } = this.app.screen;
    const compact = this.isCompactLayout();
    if (!compact) {
      const width = Math.min(234, Math.max(202, Math.floor(w * 0.2)));
      return { x: 30, y: h - 166, width, compact: false };
    }
    if (this.isShortLandscape()) {
      const seats = this.mobileSeats();
      const width = Math.min(196, Math.max(124, w - seats.tableWidth - 16));
      return { x: seats.tableWidth + 8, y: 117, width, compact: true };
    }
    // Móvil vertical: justo debajo del encabezado a la izquierda, sin tocar asientos ni el botón Compañero
    const width = Math.min(156, Math.max(118, Math.floor(w / 2 - 42)));
    return { x: 8, y: 143, width, compact: true };
  }

  private positionHandHelper(): void {
    const s = this.engine.getState();
    const finished = s.phase === "HAND_OVER" || s.phase === "MATCH_OVER";
    const visible = !this.inMenu && !this.isDealing && !finished && (s.initialHands.player?.length ?? 0) > 0;
    this.envidoBoard.visible = visible;
    if (!visible) return;
    const pos = this.getEnvidoBoardLayout();
    this.envidoBoard.position.set(pos.x, pos.y);
  }

  /**
   * Resalta suavemente en tu mano las cartas exactas que forman el puntaje de Envido o Flor
   * al pasar el puntero o tocar la calculadora.
   */
  private highlightEnvidoHandCards(cardIds: string[] | null): void {
    if (this.inMenu || this.isDealing) return;
    if (!cardIds) {
      this.updatePlayerHandHover(this.hoveredHandCardId);
      return;
    }
    const targetSet = new Set(cardIds);
    const s = this.engine.getState();
    const pHand = s.hands.player ?? [];
    const canPlay = !this.pendingAction && this.engine.getLegalActions("player").canPlayCard;
    const baseLiftY = canPlay ? -4 : 4;

    pHand.forEach((hc, idx) => {
      const cv = this.cardViews.get(`player_${hc.id}`);
      const slot = this.getPlayerHandSlot(hc.id);
      if (!cv || !slot) return;
      const inCombo = targetSet.has(hc.id);
      cv.setHighlighted(inCombo);
      cv.zIndex = inCombo ? 88 + idx : 60 + idx;
      const startElev = cv.elevation;
      const endElev = inCombo ? 0.85 : 0;
      this.tweens.to(
        cv,
        {
          x: slot.x,
          y: inCombo ? slot.y - 16 : slot.y + baseLiftY,
          rotation: inCombo ? slot.rot * 0.45 : slot.rot,
          scaleX: inCombo ? slot.scale * 1.05 : slot.scale,
          scaleY: inCombo ? slot.scale * 1.05 : slot.scale,
        },
        175,
        Easing.easeOutQuart,
        () => cv.setElevation(endElev),
        {
          onUpdate: (_rawT, easedT) => {
            cv.setElevation(startElev + (endElev - startElev) * easedT);
          },
        },
      );
    });
  }

  private rebuildDeckAndVira(): void {
    const s = this.engine.getState();
    for (const child of this.deckGroup.removeChildren()) {
      child.destroy({ children: true });
    }

    const viraView = new CardView(s.vira, s.vira, true);
    viraView.scale.set(0.76);
    viraView.position.set(-36, 8);
    viraView.rotation = -0.16;
    this.deckGroup.addChild(viraView);

    // Resto real de la baraja española de 40 cartas (33 en 1v1, 27 en 2v2) apoyado sobre la Vira
    const remainingCards = Math.max(1, 40 - s.seats.length * 3 - 1);
    const deckStack = new DeckStackView(remainingCards);
    deckStack.scale.set(0.76);
    deckStack.position.set(18, 4);
    this.deckGroup.addChild(deckStack);

    const stackTopY = 4 + deckStack.getTopOffset().y * 0.76;
    const chipCenterY = stackTopY - 72;

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
      .roundRect(chipLeft, chipCenterY - 10, chipW, 20, 8)
      .fill(PALETTE.surfaceCard)
      .stroke({ width: 1.2, color: PALETTE.brass, alpha: 0.9 });
    const manoCrown = new Graphics();
    drawIconDiamondCrown(manoCrown, 8, PALETTE.brass);
    manoCrown.position.set(chipLeft + 11, chipCenterY);

    manoChipTxt.anchor.set(0.5);
    manoChipTxt.position.set(chipLeft + 20 + (chipW - 24) / 2, chipCenterY);
    this.deckGroup.addChild(manoChipBg, manoCrown, manoChipTxt);
  }

  private rebuildHandCards(): void {
    this.tweens.clear();
    this.settledTableCards.clear();
    this.hoveredHandCardId = null;
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
            this.updatePlayerHandHover(c.id);
          });

          cv.on("pointerout", () => {
            if (this.hoveredHandCardId === c.id) {
              this.updatePlayerHandHover(null);
            }
          });

          cv.on("pointertap", (e) => {
            if (!this.isCardInteractive(c.id)) return;
            const burned = this.burnMode || e.button === 2;
            this.hoveredHandCardId = null;
            cv.setHighlighted(false);
            this.dispatchPlayer({ type: "PLAY_CARD", cardId: c.id, burned });
          });
        }

        this.cardsLayer.addChild(cv);
        this.cardViews.set(`${seat}_${c.id}`, cv);
      }
    }
  }

  /**
   * Abanico táctil: eleva suavemente la carta bajo el puntero, endereza su inclinación
   * y separa sutilmente las cartas vecinas como al abrir la mano con los dedos.
   */
  private updatePlayerHandHover(hoveredId: string | null): void {
    this.hoveredHandCardId = hoveredId;
    const s = this.engine.getState();
    const pHand = s.hands.player ?? [];
    const canPlay = !this.pendingAction && this.engine.getLegalActions("player").canPlayCard;
    const hoveredIdx = hoveredId ? pHand.findIndex((hc) => hc.id === hoveredId) : -1;

    pHand.forEach((hc, idx) => {
      const cv = this.cardViews.get(`player_${hc.id}`);
      const slot = this.getPlayerHandSlot(hc.id);
      if (!cv || !slot) return;

      const isHovered = hoveredIdx !== -1 && idx === hoveredIdx && canPlay;
      cv.setHighlighted(isHovered);
      cv.zIndex = isHovered ? 92 : 60 + idx;

      const baseLiftY = canPlay ? -4 : 4;
      const neighborNudge =
        hoveredIdx !== -1 && !isHovered ? (idx < hoveredIdx ? -8 : 8) : 0;
      const targetX = slot.x + neighborNudge;
      const targetY = isHovered ? slot.y - 22 : slot.y + baseLiftY;
      const targetRot = isHovered ? slot.rot * 0.3 : slot.rot;
      const targetScale = isHovered ? slot.scale * 1.075 : slot.scale;
      const startElev = cv.elevation;
      const endElev = isHovered ? 1 : 0;

      this.tweens.to(
        cv,
        {
          x: targetX,
          y: targetY,
          rotation: targetRot,
          scaleX: targetScale,
          scaleY: targetScale,
        },
        isHovered ? 165 : 195,
        Easing.easeOutQuart,
        () => cv.setElevation(endElev),
        {
          onUpdate: (_rawT, easedT) => {
            cv.setElevation(startElev + (endElev - startElev) * easedT);
          },
        },
      );
    });
  }

  private isCardInteractive(cardId: string): boolean {
    if (
      this.inMenu ||
      this.isDealing ||
      this.pendingAction ||
      this.rulesModal.open ||
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
      const seats = this.mobileSeats();
      const slotSpacing = Math.min(this.isShortLandscape() ? 77 : 116, Math.floor((w - 36) / 3));
      const cardScale = Math.max(0.56, Math.min(0.75, (slotSpacing - 12) / CARD_WIDTH));
      return {
        cx: seats.northX,
        cy: seats.centerY,
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

    if (this.isCompactLayout()) {
      const seats = this.mobileSeats();
      return { x: seats.tableWidth - 45, y: seats.northY - 6 };
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

    this.deckGroup.scale.set(deckScale);

    if (animate) {
      this.tweens.to(this.deckGroup, { x: deckPos.x, y: deckPos.y }, 380, Easing.easeOutCubic);
    } else {
      this.deckGroup.position.set(deckPos.x, deckPos.y);
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
      const seats = this.mobileSeats();
      const handWidth = this.isShortLandscape() ? w - seats.tableWidth : w;
      const scale = Math.min(0.86, (handWidth - 24) / 310, this.isShortLandscape() ? (h - 184) / 168 : Math.max(0.6, (h - 295) / 345));
      const spread = Math.min(104 * scale, (handWidth - 98 * scale - 24) / Math.max(1, count - 1));
      const offset = idx - (count - 1) / 2;
      return {
        x: seats.handX + offset * spread,
        y: seats.handY + Math.abs(offset) * 5,
        rot: offset * 0.06,
        scale,
      };
    }

    const { cardScale } = this.getArenaMetrics();
    const scale = cardScale * 0.98;
    const spread = 112 * scale;
    const offset = idx - (count - 1) / 2;
    return {
      x: w / 2 + offset * spread,
      y: h - 178 * Math.max(0.84, cardScale) + Math.abs(offset) * 6,
      rot: offset * 0.06,
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
    const compact = this.isCompactLayout();
    const isFour = this.is2v2();
    const { cx, cy, cardScale } = this.getArenaMetrics();

    const northSeat = isFour ? "partner" : "cpu";
    for (const seat of s.seats) {
      if (seat === "player") continue;
      const hand = s.hands[seat] ?? [];
      const revealed = this.shouldRevealSeatAtHandEnd(seat);
      hand.forEach((card, idx) => {
        const view = this.cardViews.get(`${seat}_${card.id}`);
        if (!view) return;
        if (revealed && !view.faceUp) {
          this.animateCardFlip(view, true, 220, idx * 75, idx === 0);
        } else if (!revealed) {
          view.setFaceUp(false);
          view.resetFlip();
        }
        view.alpha = 1;
        view.zIndex = 50 + idx;
        const slot = this.getSeatHandTarget(seat, idx, hand.length, revealed);
        const duration = isDealAnimation ? (seat === northSeat ? 340 : 360) + idx * 85 : 260;
        this.tweens.to(
          view,
          {
            x: slot.x,
            y: slot.y,
            rotation: slot.rot,
            scaleX: slot.scale,
            scaleY: slot.scale,
          },
          duration,
          Easing.easeOutQuart,
        );
      });
    }

    // 2) Mano del jugador humano (Sur)
    const canPlay = !this.pendingAction && this.engine.getLegalActions("player").canPlayCard;
    const pHand = s.hands.player ?? [];
    if (!canPlay || (this.hoveredHandCardId && !pHand.some((c) => c.id === this.hoveredHandCardId))) {
      this.hoveredHandCardId = null;
    }
    pHand.forEach((c, idx) => {
      const cv = this.cardViews.get(`player_${c.id}`);
      if (!cv) return;
      cv.setFaceUp(true);
      cv.resetFlip();
      cv.cursor = canPlay ? "pointer" : "default";
      const isHovered = canPlay && this.hoveredHandCardId === c.id;
      cv.setHighlighted(isHovered);
      cv.zIndex = isHovered ? 92 : 60 + idx;
      const slot = this.getPlayerHandSlot(c.id);
      if (!slot) return;
      const dur = isDealAnimation ? 380 + idx * 90 : 250;
      const targetAlpha = canPlay ? 1 : 0.88;
      const liftY = isHovered ? -22 : canPlay ? -4 : 4;
      const targetScale = isHovered ? slot.scale * 1.075 : slot.scale;
      const targetRot = isHovered ? slot.rot * 0.3 : slot.rot;
      const endElev = isHovered ? 1 : 0;
      const startElev = cv.elevation;
      this.tweens.to(
        cv,
        {
          x: slot.x,
          y: slot.y + liftY,
          rotation: targetRot,
          scaleX: targetScale,
          scaleY: targetScale,
          alpha: targetAlpha,
        },
        dur,
        Easing.easeOutQuart,
        () => cv.setElevation(endElev),
        {
          onUpdate: (_rawT, easedT) => {
            cv.setElevation(startElev + (endElev - startElev) * easedT);
          },
        },
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
        const wantFaceUp = !entry.burned || revealBurned;
        const isNewPlay = !this.settledTableCards.has(cardKey);
        this.settledTableCards.add(cardKey);

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

        const targetRot = jitter.rot + (tIdx - 1) * 0.025;
        const targetAlpha = isPreviousTrick ? 0.93 : 1;

        if (isNewPlay) {
          // Lanzamiento natural en arco con elevación de sombra y giro 3D si cambia de cara
          const dist = Math.hypot(tx - cv.x, ty - cv.y);
          const arc = this.computeArcOffset(
            cv.x,
            cv.y,
            tx,
            ty,
            entry.burned ? 0.07 : 0.13,
            entry.burned ? 10 : 24,
          );
          if (cv.faceUp !== wantFaceUp) {
            this.animateCardFlip(cv, wantFaceUp, 195, 25);
          } else {
            cv.setFaceUp(wantFaceUp);
            cv.resetFlip();
          }
          const flightDuration = entry.burned ? 270 : Math.min(340, Math.max(265, 240 + dist * 0.18));
          const peakElevation = entry.burned ? 0.45 : 1.05;
          this.tweens.to(
            cv,
            {
              x: tx,
              y: ty,
              rotation: targetRot,
              scaleX: playedScale,
              scaleY: playedScale,
              alpha: targetAlpha,
            },
            flightDuration,
            Easing.easeOutQuint,
            () => cv.setElevation(0),
            {
              curveX: arc.curveX,
              curveY: arc.curveY,
              liftScale: entry.burned ? 0.04 : 0.13,
              onUpdate: (rawT) => {
                cv.setElevation(Math.sin(rawT * Math.PI) * peakElevation);
              },
            },
          );
        } else {
          // Carta ya asentada en el tapete: sin rebotes artificiales; solo voltea en 3D si se revela al cierre
          if (cv.faceUp !== wantFaceUp) {
            this.animateCardFlip(cv, wantFaceUp, 220, 40, true);
          }
          this.tweens.to(
            cv,
            {
              x: tx,
              y: ty,
              rotation: targetRot,
              scaleX: playedScale,
              scaleY: playedScale,
              alpha: targetAlpha,
            },
            210,
            Easing.easeOutQuart,
            () => cv.setElevation(0),
          );
        }
      }
    });
  }

  private updateStakeAndStatus(): void {
    const s = this.engine.getState();
    const compact = this.isCompactLayout();
    const w = this.app.screen.width;
    const stake = tableStake(this.engine);
    const finished = s.phase === "HAND_OVER" || s.phase === "MATCH_OVER";
    this.stakeBoard.visible = !this.inMenu && !finished;
    this.stakeBoard.update(stake, compact ? (this.isShortLandscape() ? w - this.mobileSeats().tableWidth : w) - 16 : 248, compact);
    this.tableTitle.text = `MANO ${String(s.handNumber).padStart(2, "0")}`;

    const emptyTable = s.tricks.every(trick => Object.keys(trick.played).length === 0);
    this.tableCall.visible = this.tableCaller.visible = emptyTable && !finished && !this.inMenu;
    if (this.tableCall.visible) {
      const caller = s.phase === "AWAITING_TRUCO" ? s.truco.caller :
        s.phase === "AWAITING_ENVIDO" ? s.envido.caller : s.phase === "AWAITING_FLOR" ? s.flor.caller : undefined;
      const { cx, cy } = this.getArenaMetrics();
      this.tableCall.text = caller ? (s.phase === "AWAITING_FLOR" && s.flor.stage === "flor" ? "Flor" : stake.name) : "Primera baza";
      if (s.phase === "AWAITING_PRIVE") this.tableCall.text = "Prive";
      this.tableCall.style.fontSize = compact ? 24 : 37;
      this.tableCall.alpha = caller ? 0.95 : 0.62;
      this.tableCall.position.set(cx, cy - (compact ? 7 : 10));
      const speaker = caller ?? s.turn;
      this.tableCaller.text = speaker === "player"
        ? (caller ? "TU CANTO" : "SALES TÚ")
        : `${caller ? "Canta" : "Sale"} ${this.seatLabel(speaker)}`.toUpperCase();
      if (s.phase === "AWAITING_PRIVE" && s.prive) {
        this.tableCaller.text = s.prive.declaredPoints !== undefined
          ? `PRIVO ${s.prive.declaredPoints}` : s.prive.next === "ASK_PRIVE" ? "A UNA PIEDRA" : "¿CUÁNTO PRIVAS?";
      }
      this.tableCaller.position.set(cx, cy + (compact ? 17 : 22));
    }
    const envidoLayout = this.getEnvidoBoardLayout();
    this.positionHandHelper();
    if (this.envidoBoard.visible) {
      this.envidoBoard.update(s, envidoLayout.compact, envidoLayout.width);
    }
  }

  private updateTrickDots(): void {
    const s = this.engine.getState();
    const compact = this.isCompactLayout();
    const w = this.app.screen.width;
    // 3 rombos limpios integrados dentro de la barra superior unificada
    const dotCenterX = this.isShortLandscape() ? w / 2 + 39 : compact ? w - 32 : w / 2;
    const dotY = this.isShortLandscape() ? 16 : compact ? 123 : 41;
    const spacing = compact ? 11 : 20;
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

  private clearActionBar(): void {
    for (const child of this.actionBar.removeChildren()) child.destroy({ children: true });
  }

  private rebuildActionBar(): void {
    if (this.pendingAction) {
      this.actionBar.alpha = 0.45;
      this.actionBar.interactiveChildren = false;
      return;
    }
    this.actionBar.alpha = 1;
    this.actionBar.interactiveChildren = true;
    this.clearActionBar();
    if (this.inMenu || this.isDealing) return;
    const choices = tableChoices(this.engine, this.burnMode);
    if (!choices.length) return;

    const compact = this.isCompactLayout();
    const available = this.app.screen.width - (compact ? 24 : 48);
    const gap = compact ? 5 : 8;
    const maxColumns = compact ? Math.min(4, Math.max(3, Math.floor(available / 82))) : choices.length;
    // Up to seven options fit in two touch rows, including the narrowest table.
    const rows = compact && !this.isShortLandscape() && choices.length > maxColumns ? 2 : 1;
    const cols = Math.ceil(choices.length / rows);
    const width = Math.min(compact ? 148 : 138, Math.floor((available - (cols - 1) * gap) / cols));
    const height = compact ? 46 : 52;
    const rail = new Graphics();
    this.actionBar.addChild(rail);
    const baseY = this.app.screen.height - (compact ? 13 : 16);
    this.actionBar.position.set(this.app.screen.width / 2, baseY);
    const railW = cols * width + (cols - 1) * gap + 12;
    const railH = rows * (height + gap) - gap + 10;
    rail.roundRect(-railW / 2, -railH, railW, railH, 6)
      .fill(0x14221c).stroke({ width: 1, color: 0x796b4d });
    choices.forEach((choice, index) => {
      const row = Math.floor(index / cols);
      const rowCount = Math.min(cols, choices.length - row * cols);
      const button = new PillButton({
        bid: true, label: choice.action.type === "CALL_ENVIDO" && choice.action.call === "envido_cinco"
          ? "Envido" : choice.label,
        detail: choice.detail, width, height,
        fontSize: compact ? 14.5 : 18, radius: 3,
        theme: choice.tone === "lead" ? "danger" : choice.tone === "call" ? "paper" : "ghost",
        onClick: () => {
          if (this.rulesModal.open || this.partnerCommDrawer.visible) return;
          if (choice.action.type === "TOGGLE_BURN") {
            this.burnMode = !this.burnMode;
            this.updateTurnIndicator();
            this.rebuildActionBar();
          } else {
            this.dispatchPlayer(choice.action);
          }
        },
      });
      button.position.set((index % cols - (rowCount - 1) / 2) * (width + gap),
        -5 - height / 2 - (rows - row - 1) * (height + gap));
      this.actionBar.addChild(button);
    });
  }

  private revealedResultHands(s: GameState): RevealedHand[] {
    if (s.flor.stage !== "none" && s.flor.resolved) {
      const flor = s.flor;
      if (flor.nosotrosBestPlayer && flor.ellosBestPlayer &&
          flor.nosotrosPoints !== undefined && flor.ellosPoints !== undefined) {
        return (["nosotros", "ellos"] as const).map(team => {
          const seat = team === "nosotros" ? flor.nosotrosBestPlayer! : flor.ellosBestPlayer!;
          const points = team === "nosotros" ? flor.nosotrosPoints : flor.ellosPoints;
          return { label: `${this.seatLabel(seat)} · ${points} pts`, cards: s.initialHands[seat] ?? [], winner: flor.winnerTeam === team };
        });
      }
      const owner = flor.winnerPlayer ?? flor.caller ?? "player";
      const cards = s.initialHands[owner] ?? [];
      const value = evaluateFlor(cards, s.vira);
      const label = value.isReservada ? "Flor reservada" : `${value.points} pts`;
      return [{ label: `${this.seatLabel(owner)} · ${label}`, cards, winner: true }];
    }
    const envido = s.envido;
    if (!envido.accepted || envido.nosotrosPoints === undefined || envido.ellosPoints === undefined) return [];
    return (["nosotros", "ellos"] as const).map(team => {
      const seat = team === "nosotros" ? envido.nosotrosBestPlayer ?? "player" : envido.ellosBestPlayer ?? "cpu";
      const points = team === "nosotros" ? envido.nosotrosPoints : envido.ellosPoints;
      return {
        label: `${this.seatLabel(seat)} · ${points} pts`,
        cards: getEnvidoCards(s.initialHands[seat] ?? [], s.vira),
        winner: envido.winnerTeam === team,
      };
    });
  }

  private drawRevealedCards(cards: Card[], vira: Card): HTMLCanvasElement {
    const hand = new Container();
    try {
      cards.forEach((card, index) => {
        const view = new CardView(card, vira, true);
        view.x = index * (CARD_WIDTH + 4);
        hand.addChild(view);
      });
      const canvas = this.app.renderer.extract.canvas({ target: hand, resolution: 1.5 }) as HTMLCanvasElement;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", cards.map(card => getCardName(card, vira)).join(", "));
      return canvas;
    } finally {
      hand.destroy({ children: true });
    }
  }

  private updateSummaryOverlay(previewLastCard = false): void {
    const s = this.engine.getState();
    const matchOver = s.phase === "MATCH_OVER";
    if (this.inMenu || (!matchOver && s.phase !== "HAND_OVER")) {
      this.summaryOverlay.hide();
      return;
    }
    const ourWin = (matchOver ? s.matchWinner : s.handSummary?.trickWinnerTeam) === "nosotros";
    const rival = this.is2v2() ? getTeamLabel("ellos", s.config.mode) : this.seatLabel("cpu");
    const winner = ourWin ? (this.is2v2() ? "Ganamos" : "Ganaste") : (this.is2v2() ? "Ellos ganaron" : `${rival} ganó`);
    const localize = (line: string) => this.isOnlineMatch && this.roomClient.mySeat
      ? formatOnlineSummaryText(line, s.config.mode, this.roomClient.mySeat, seat => this.seatLabel(seat))
      : line;
    const summary = s.handSummary;
    const notes = [summary?.florText, summary?.envidoText].filter((note): note is string => Boolean(note)).map(localize);
    if (s.prive?.winnerTeam) {
      const side = s.prive.winnerTeam === "nosotros" ? getTeamLabel("nosotros", s.config.mode) : rival;
      notes.unshift(`Prive de ${side} · ${s.prive.winningPoints} tantos (+1 piedra)`);
    }
    let reason = "";
    if (summary && (summary.trucoPoints || !notes.length)) {
      reason = summary.reason.endsWith(" gana el lance del Truco")
        ? TRUCO_LEVEL_NAMES[s.truco.level]
        : localize(summary.reason);
    }
    let action = matchOver ? "Sí, jugar" : "Siguiente mano";
    let enabled = !this.pendingAction;
    let prompt = matchOver ? "¿Jugar otra partida contra la CPU?" : undefined;
    const roomResult = matchOver && this.isOnlineMatch;
    if (roomResult) {
      const players = s.rematch?.players ?? [...this.onlineHumanSeats];
      const confirmed = s.rematch?.confirmed ?? [];
      const online = this.roomClient.members.flatMap(member => member.seat && member.online !== false && this.roomClient.mySeat
        ? [mapSeatToViewer(member.seat, this.roomClient.mySeat, s.seats)] : []);
      const missing = players.find(seat => !online.includes(seat));
      prompt = missing ? "Falta un jugador de esta partida. La revancha esperará a que vuelva."
        : `¿Otra partida en esta sala? · ${confirmed.length}/${players.length} confirmados`;
      if (confirmed.includes("player")) action = "Ya confirmaste";
      enabled = enabled && online.includes("player") && players.includes("player") && !confirmed.includes("player") &&
        (!missing || confirmed.length + 1 < players.length);
    }
    action = this.pendingAction?.label ?? action;
    const lastTrick = [...s.tricks].reverse().find(trick => Object.keys(trick.played).length > 0);
    const last = lastTrick && s.seats.flatMap(seat => {
      const play = lastTrick.played[seat];
      return play ? [{ seat, ...play }] : [];
    }).sort((a, b) => b.order - a.order)[0];
    const lastPlay = last && `${this.seatLabel(last.seat)} · ${last.burned || isHiddenCardId(last.card.id) ? "Carta boca abajo" : getCardName(last.card, s.vira)}`;
    this.summaryOverlay.show({
      lastPlay,
      hand: s.handNumber,
      target: s.config.targetScore,
      title: `${winner} la ${matchOver ? "partida" : "mano"}`,
      matchOver,
      roomResult,
      prompt,
      scores: [
        { label: getTeamLabel("nosotros", s.config.mode), value: s.scores.nosotros },
        { label: rival, value: s.scores.ellos },
      ],
      reason,
      points: summary?.trucoPoints ?? 0,
      notes,
      reveals: this.revealedResultHands(s),
      vira: s.vira,
    }, action, enabled, cards => this.drawRevealedCards(cards, s.vira), previewLastCard);
  }

  private drawTableAndArena(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const compact = this.isCompactLayout();
    const { cx, cy, cardScale } = this.getArenaMetrics();
    const headerH = this.headerHeight();

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
    const topY = this.waitingAtTable ? pad : headerH + (compact ? 4 : 8);
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
        x = this.mobileSeats().handX;
        y = this.mobileSeats().handY - 64;
      } else if (seat === "partner") {
        x = this.mobileSeats().northX;
        y = this.mobileSeats().northY + 42;
      } else if (seat === "cpu2") {
        x = 84;
        y = cy - 94;
      } else {
        // cpu: arriba-izquierda en 1v1, lado derecho en 2v2
        x = isFour ? this.mobileSeats().tableWidth - 84 : this.mobileSeats().northX;
        y = isFour ? cy - 76 : this.mobileSeats().northY + 42;
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
    const headerH = this.headerHeight();

    this.summaryOverlay.centerOn(cx, cy);
    this.chat?.setCompact(compact);
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
      const landscape = this.isShortLandscape();
      const seats = this.mobileSeats();
      const controlsWidth = this.isOnlineMatch ? 194 : 144;
      const scoreWidth = Math.min(148, w - controlsWidth - 24);
      this.scoreboard.setCompactWidth(scoreWidth);
      this.scoreboard.position.set(8, 8);
      this.tableTitle.position.set(landscape ? w / 2 - 24 : 38, landscape ? 16 : 123);
      this.turnStatus.position.set(w / 2, landscape ? 36 : 123);
      this.stakeBoard.position.set(landscape ? seats.tableWidth + 8 : 8, 54);
      this.topControls.position.set(w - 30, 27);
      this.positionDeckAndVira(false);

      this.seatBadges.partner.container.position.set(seats.northX, seats.northY - 43);
      const sideLabelY = cy - 50 >= seats.northY + 32 ? cy - 40 : cy + 42;
      this.seatBadges.cpu2.container.position.set(40, sideLabelY);
      this.seatBadges.cpu.container.position.set(seats.tableWidth - 40, sideLabelY);

      for (const seat of ["player", "cpu", "partner", "cpu2"] as PlayerId[]) {
        this.positionBubbleForSeat(seat);
      }

      // Dock inferior con 2 filas táctiles cómodas (sin barra negra abajo)
      this.actionBar.position.set(w / 2, h - 64);
      this.centerToast.position.set(w / 2, 143);
    } else {
      this.scoreboard.scale.set(1);
      this.scoreboard.position.set(20, 7);

      this.tableTitle.position.set(w / 2, 18);
      this.turnStatus.position.set(w / 2, 39);
      this.stakeBoard.position.set(30, 86);
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

    this.positionHandHelper();
    this.positionPartnerComms();
    this.updatePartnerCommVisibility();
    this.partnerCommDrawer.layout(w, h);
    if (this.inMenu) {
      if (this.menuOverlay.visible) this.buildMenuOverlay();
    } else if (this.isDealing) {
      this.cancelDealChoreography(true);
    } else {
      this.rebuildDeckAndVira();
      this.updateSeatBadges();
      this.updateStakeAndStatus();
      this.updateTurnIndicator();
      this.positionAllCards(false);
      this.updateTrickDots();
      this.rebuildActionBar();
      this.updateSummaryOverlay();
    }
  }
}
