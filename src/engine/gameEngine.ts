import { dealHandForSeats, DealResult } from "./deck.ts";
import {
  calculateEnvidoPoints,
  calculateFaltaEnvidoPoints,
  evaluateFlor,
  getCardName,
  getSeatDistanceFromMano,
  getTrucoAcceptPoints,
  getTrucoRejectPoints,
  hasFlor,
  isFlorReservada,
  resolveHandWinnerFromTricks,
  resolveTrickOutcome,
} from "./evaluator.ts";
import {
  EnvidoCallType,
  envidoLabel,
  envidoResponseLabel,
  GameConfig,
  GameEvent,
  GameState,
  getOppositeTeam,
  getPlayerLabel,
  getPlayerTeam,
  getSeatsForMode,
  getTeamLabel,
  PlayerAction,
  PlayerId,
  TeamId,
  TrickWinner,
  TRUCO_LEVEL_NAMES,
  trucoCallLabel,
  TrucoLevel,
} from "./types.ts";

export interface LegalActions {
  canPlayCard: boolean;
  canBurnCard: boolean;
  canCallALey: boolean;
  canCallFlor: boolean;
  mustCallFlorALey: boolean;
  florResponses: Array<"achico" | "contraflor" | "contraflor_resto" | "quiero" | "no_quiero">;
  envidoCalls: EnvidoCallType[];
  canRespondEnvido: boolean;
  canCallTruco: boolean;
  nextTrucoLevel?: TrucoLevel;
  canRespondTruco: boolean;
  canIrseAlMazo: boolean;
  canNextHand: boolean;
}

const DEFAULT_CONFIG: GameConfig = {
  mode: "1v1",
  targetScore: 24,
  withFlor: true,
};

export class TrucoEngine {
  private state: GameState;
  private eventSeq = 1;
  private rng: () => number;
  private customDeal?: (seats: PlayerId[]) => DealResult;

  constructor(
    config: Partial<GameConfig> = {},
    options?: { rng?: () => number; customDeal?: (seats: PlayerId[]) => DealResult },
  ) {
    this.rng = options?.rng ?? Math.random;
    this.customDeal = options?.customDeal;
    const mergedConfig: GameConfig = { ...DEFAULT_CONFIG, ...config };
    this.state = this.createInitialMatchState(mergedConfig, "player");
  }

  private deal(seats: PlayerId[]): DealResult {
    return this.customDeal ? this.customDeal(seats) : dealHandForSeats(seats, this.rng);
  }

  private createInitialMatchState(config: GameConfig, firstMano: PlayerId): GameState {
    const seats = getSeatsForMode(config.mode);
    const mano = seats.includes(firstMano) ? firstMano : seats[0];
    const deal = this.deal(seats);

    const initialHands: Partial<Record<PlayerId, typeof deal.vira[]>> = {};
    const hands: Partial<Record<PlayerId, typeof deal.vira[]>> = {};
    for (const seat of seats) {
      const cards = deal.hands[seat] ?? [];
      initialHands[seat] = [...cards];
      hands[seat] = [...cards];
    }

    return {
      config,
      seats,
      phase: "PLAYING",
      handNumber: 1,
      scores: { nosotros: 0, ellos: 0 },
      mano,
      turn: mano,
      vira: deal.vira,
      initialHands,
      hands,
      trickIndex: 0,
      tricks: [{ lead: mano, played: {} }],
      envido: { resolved: false, chain: [], pointsAwarded: 0 },
      flor: { resolved: false, stage: "none", pointsAwarded: 0 },
      truco: { level: 0 },
      ley: { active: false, declaredBy: [], hiddenFlorPlayers: [], forfeitedBy: [] },
      log: [],
    };
  }

  public startNewMatch(config?: Partial<GameConfig>, firstMano: PlayerId = "player"): GameState {
    const merged: GameConfig = { ...this.state.config, ...config };
    this.eventSeq = 1;
    this.state = this.createInitialMatchState(merged, firstMano);
    this.emit(
      "system",
      "deal",
      `Mano #1 — Vira: ${getCardName(this.state.vira)}. Sale ${this.actorLabel(this.state.mano)}.`,
    );
    return this.getState();
  }

  public getState(): GameState {
    return this.state;
  }

  /**
   * Hidrata un estado proyectado recibido desde el anfitrión en modo Multijugador Online.
   */
  public loadExternalState(externalState: GameState): void {
    this.state = externalState;
    if (externalState.lastEvent) {
      this.eventSeq = Math.max(this.eventSeq, externalState.lastEvent.id + 1);
    }
  }

  private actorLabel(actor: PlayerId): string {
    return getPlayerLabel(actor, this.state.config.mode);
  }

  private teamLabel(team: TeamId): string {
    return getTeamLabel(team, this.state.config.mode);
  }

  private getNextSeat(seat: PlayerId): PlayerId {
    const seats = this.state.seats;
    const idx = seats.indexOf(seat);
    return seats[(idx + 1) % seats.length];
  }

  private getTeamMembers(team: TeamId): PlayerId[] {
    return this.state.seats.filter((p) => getPlayerTeam(p) === team);
  }

  private pickResponder(team: TeamId, preferred?: PlayerId): PlayerId {
    const members = this.getTeamMembers(team);
    if (preferred && members.includes(preferred)) return preferred;
    // El jugador humano siempre toma las decisiones de respuesta de su equipo ("nosotros")
    if (team === "nosotros" && members.includes("player")) return "player";
    return members[0];
  }

  private emit(
    actor: PlayerId | "system",
    type: GameEvent["type"],
    text: string,
    bubble?: string,
  ): void {
    const ev: GameEvent = {
      id: this.eventSeq++,
      actor,
      type,
      text,
      bubble,
    };
    this.state.lastEvent = ev;
    this.state.log = [...this.state.log.slice(-39), ev];
  }

  private hasPlayedInTrick(actor: PlayerId, trickIdx: number): boolean {
    const t = this.state.tricks[trickIdx];
    return Boolean(t?.played[actor]);
  }

  private isPlayerEligibleForFirstTrickLances(actor: PlayerId): boolean {
    return this.state.trickIndex === 0 && !this.hasPlayedInTrick(actor, 0);
  }

  private actorHasFlor(actor: PlayerId): boolean {
    const hand = this.state.initialHands[actor] ?? [];
    return this.state.config.withFlor && hasFlor(hand, this.state.vira);
  }

  private actorHasFlorReservada(actor: PlayerId): boolean {
    const hand = this.state.initialHands[actor] ?? [];
    return this.state.config.withFlor && isFlorReservada(hand, this.state.vira);
  }

  private isPie(actor: PlayerId): boolean {
    return (
      getSeatDistanceFromMano(actor, this.state.mano, this.state.seats) ===
      this.state.seats.length - 1
    );
  }

  private hasDeferredFlorALey(actor: PlayerId): boolean {
    const s = this.state;
    return (
      s.config.withFlor &&
      s.ley.hiddenFlorPlayers.includes(actor) &&
      !s.flor.resolved &&
      s.trickIndex <= 1 &&
      !this.hasPlayedInTrick(actor, 1)
    );
  }

  private canActorCallALey(actor: PlayerId): boolean {
    const s = this.state;
    return (
      s.config.withFlor &&
      s.phase === "PLAYING" &&
      s.turn === actor &&
      !this.isPie(actor) &&
      !this.actorHasFlorReservada(actor) &&
      this.isPlayerEligibleForFirstTrickLances(actor) &&
      !s.ley.declaredBy.includes(actor) &&
      !s.flor.resolved &&
      !s.envido.resolved
    );
  }

  private isActorEligibleForFlor(actor: PlayerId): boolean {
    return (
      this.actorHasFlor(actor) &&
      (!this.hasPlayedInTrick(actor, 0) ||
        this.hasDeferredFlorALey(actor) ||
        this.actorHasFlorReservada(actor))
    );
  }

  private getTeamEligibleFlorHolders(team: TeamId): PlayerId[] {
    return this.getTeamMembers(team).filter((p) => this.isActorEligibleForFlor(p));
  }

  /**
   * Elige quién responde una Flor / Contraflor: SIEMPRE un jugador que realmente tiene Flor
   * (jamás el compañero sin Flor). Si ambos la tienen, prioriza al jugador humano.
   */
  private pickFlorResponder(team: TeamId, eligibleOnly = true): PlayerId | undefined {
    const holders = eligibleOnly
      ? this.getTeamEligibleFlorHolders(team)
      : this.getTeamMembers(team).filter((p) => this.actorHasFlor(p));
    if (holders.length === 0) return undefined;
    if (team === "nosotros" && holders.includes("player")) return "player";
    return holders[0];
  }

  private getTeamBestEnvido(team: TeamId): { points: number; player: PlayerId } {
    const s = this.state;
    const members = this.getTeamMembers(team);
    let bestPts = -1;
    let bestPlayer = members[0];
    let bestDist = Infinity;

    for (const m of members) {
      const hand = s.initialHands[m] ?? [];
      const pts = calculateEnvidoPoints(hand, s.vira);
      const dist = getSeatDistanceFromMano(m, s.mano, s.seats);
      if (pts > bestPts || (pts === bestPts && dist < bestDist)) {
        bestPts = pts;
        bestPlayer = m;
        bestDist = dist;
      }
    }
    return { points: bestPts, player: bestPlayer };
  }

  private getTeamBestFlor(team: TeamId): {
    hasFlor: boolean;
    isReservada: boolean;
    points: number;
    player?: PlayerId;
  } {
    const s = this.state;
    const members = this.getTeamMembers(team);
    let best = { hasFlor: false, isReservada: false, points: -1, player: undefined as PlayerId | undefined };
    let bestDist = Infinity;

    for (const m of members) {
      const hand = s.initialHands[m] ?? [];
      const ev = evaluateFlor(hand, s.vira);
      if (!ev.hasFlor) continue;
      const dist = getSeatDistanceFromMano(m, s.mano, s.seats);
      const better =
        !best.hasFlor ||
        (ev.isReservada && !best.isReservada) ||
        (ev.isReservada === best.isReservada &&
          (ev.points > best.points || (ev.points === best.points && dist < bestDist)));
      if (better) {
        best = { ...ev, player: m };
        bestDist = dist;
      }
    }

    return best.hasFlor ? best : { hasFlor: false, isReservada: false, points: 0 };
  }

  public getLegalActions(actor: PlayerId): LegalActions {
    const empty: LegalActions = {
      canPlayCard: false,
      canBurnCard: false,
      canCallALey: false,
      canCallFlor: false,
      mustCallFlorALey: false,
      florResponses: [],
      envidoCalls: [],
      canRespondEnvido: false,
      canCallTruco: false,
      canRespondTruco: false,
      canIrseAlMazo: false,
      canNextHand: false,
    };

    const s = this.state;
    if (!s.seats.includes(actor)) return empty;

    if (s.phase === "HAND_OVER") {
      return { ...empty, canNextHand: actor === "player" };
    }
    if (s.phase === "MATCH_OVER" || s.phase === "MENU") {
      return empty;
    }

    const actorTeam = getPlayerTeam(actor);

    // 1) AWAITING_FLOR
    if (s.phase === "AWAITING_FLOR") {
      if (s.flor.responder !== actor) return empty;
      if (s.flor.stage === "flor") {
        return {
          ...empty,
          florResponses: ["achico", "contraflor", "contraflor_resto"],
        };
      }
      if (s.flor.stage === "contraflor") {
        return {
          ...empty,
          florResponses: ["quiero", "no_quiero", "contraflor_resto"],
        };
      }
      if (s.flor.stage === "contraflor_resto") {
        return {
          ...empty,
          florResponses: ["quiero", "no_quiero"],
        };
      }
      return empty;
    }

    // 2) AWAITING_ENVIDO
    if (s.phase === "AWAITING_ENVIDO") {
      if (s.envido.responder !== actor) return empty;
      // Solo quien tiene Flor en SU propia mano puede cantar su Flor (nunca la del compañero)
      const canFlorInterrupt = !s.flor.resolved && this.isActorEligibleForFlor(actor);
      const deferredALey = this.hasDeferredFlorALey(actor);
      const envidoCalls = canFlorInterrupt ? [] : this.getEnvidoEscalations(s.envido.chain);
      return {
        ...empty,
        canCallFlor: canFlorInterrupt,
        mustCallFlorALey: deferredALey,
        canRespondEnvido: !canFlorInterrupt,
        envidoCalls,
      };
    }

    // 3) AWAITING_TRUCO
    if (s.phase === "AWAITING_TRUCO") {
      if (s.truco.responder !== actor) return empty;
      const pending = s.truco.pendingLevel ?? 1;
      const canRaise = pending < 4;
      const nextTrucoLevel = canRaise ? ((pending + 1) as TrucoLevel) : undefined;

      const teamHasUnplayedTrick0 = this.getTeamMembers(actorTeam).some(
        (m) => this.state.trickIndex === 0 && !this.hasPlayedInTrick(m, 0),
      );

      const canFirstTrickInterrupt =
        pending === 1 &&
        !s.envido.resolved &&
        !s.flor.resolved &&
        teamHasUnplayedTrick0;

      // Solo el propio jugador con Flor puede cantar SU Flor
      const actorHasEligibleFlor = this.isActorEligibleForFlor(actor);
      const deferredALey = this.hasDeferredFlorALey(actor);
      const canCallFlor =
        !s.flor.resolved &&
        ((canFirstTrickInterrupt && actorHasEligibleFlor) || deferredALey);

      const envidoCalls: EnvidoCallType[] =
        canFirstTrickInterrupt && !actorHasEligibleFlor
          ? ["envido", "envido_cinco", "falta_envido"]
          : [];

      return {
        ...empty,
        canRespondTruco: true,
        canCallTruco: canRaise,
        nextTrucoLevel,
        canCallFlor,
        mustCallFlorALey: deferredALey,
        envidoCalls,
      };
    }

    // 4) PLAYING
    if (s.phase === "PLAYING") {
      if (s.turn !== actor) return empty;

      const hand = s.hands[actor] ?? [];
      const canPlayCard = hand.length > 0;
      const canFirstTrick = this.isPlayerEligibleForFirstTrickLances(actor);
      const hasActorFlor = this.actorHasFlor(actor);
      const deferredALey = this.hasDeferredFlorALey(actor);

      const canCallALey = this.canActorCallALey(actor) && s.truco.level === 0;
      const canCallFlor =
        (canFirstTrick && !s.flor.resolved && hasActorFlor && s.truco.level === 0) ||
        deferredALey;
      const mustCallFlorALey = deferredALey && s.trickIndex === 1;
      const envidoCalls: EnvidoCallType[] =
        canFirstTrick &&
        s.truco.level === 0 &&
        !s.envido.resolved &&
        !s.flor.resolved &&
        !hasActorFlor
          ? ["envido", "envido_cinco", "falta_envido"]
          : [];

      const canRaiseTruco =
        s.truco.level === 0 || (s.truco.level < 4 && s.truco.ownerTeam === actorTeam);
      const nextTrucoLevel = canRaiseTruco
        ? ((s.truco.level + 1) as TrucoLevel)
        : undefined;

      return {
        ...empty,
        canPlayCard,
        canBurnCard: canPlayCard,
        canCallALey,
        canCallFlor,
        mustCallFlorALey,
        envidoCalls,
        canCallTruco: canRaiseTruco,
        nextTrucoLevel,
        canIrseAlMazo: true,
      };
    }

    return empty;
  }

  private getEnvidoEscalations(chain: EnvidoCallType[]): EnvidoCallType[] {
    if (chain.length === 0) return ["envido", "envido_cinco", "falta_envido"];
    const last = chain[chain.length - 1];
    if (last === "falta_envido") return [];
    if (last === "envido_cinco" || last === "real_envido") return ["falta_envido"];
    const envidoCount = chain.filter((c) => c === "envido").length;
    if (envidoCount < 2) {
      return ["envido", "envido_cinco", "falta_envido"];
    }
    return ["envido_cinco", "falta_envido"];
  }

  public getEnvidoStakes(chain: EnvidoCallType[]): { accept: number; reject: number } {
    if (chain.length === 0) return { accept: 0, reject: 0 };
    let accept = 0;
    let reject = 1;
    for (const call of chain) {
      reject = accept || 1;
      switch (call) {
        case "envido": accept += 2; break;
        case "envido_cinco": accept = 5; break;
        case "falta_envido": accept = calculateFaltaEnvidoPoints(this.state.scores, this.state.config); break;
        case "real_envido": accept += 3; break;
      }
    }
    return { accept, reject };
  }

  public dispatch(actor: PlayerId, action: PlayerAction): GameState {
    const legal = this.getLegalActions(actor);

    switch (action.type) {
      case "NEXT_HAND":
        if (!legal.canNextHand) return this.state;
        this.startNextHand();
        return this.state;

      case "PLAY_CARD":
        if (!legal.canPlayCard) return this.state;
        this.handlePlayCard(actor, action.cardId, Boolean(action.burned));
        return this.state;

      case "CALL_A_LEY":
        if (!legal.canCallALey) return this.state;
        this.handleCallALey(actor);
        return this.state;

      case "CALL_FLOR":
        if (!legal.canCallFlor) return this.state;
        this.handleCallFlor(actor);
        return this.state;

      case "RESPOND_FLOR":
        if (!legal.florResponses.includes(action.choice)) return this.state;
        this.handleRespondFlor(actor, action.choice);
        return this.state;

      case "CALL_ENVIDO":
        if (!legal.envidoCalls.includes(action.call)) return this.state;
        this.handleCallEnvido(actor, action.call);
        return this.state;

      case "RESPOND_ENVIDO":
        if (!legal.canRespondEnvido) return this.state;
        this.handleRespondEnvido(actor, action.accept);
        return this.state;

      case "CALL_TRUCO":
        if (!legal.canCallTruco) return this.state;
        this.handleCallTruco(actor);
        return this.state;

      case "RESPOND_TRUCO":
        if (!legal.canRespondTruco) return this.state;
        this.handleRespondTruco(actor, action.accept);
        return this.state;

      case "IRSE_AL_MAZO":
        if (!legal.canIrseAlMazo) return this.state;
        this.handleIrseAlMazo(actor);
        return this.state;
    }
  }

  private addScore(winnerTeam: TeamId, points: number): boolean {
    this.state.scores[winnerTeam] = Math.min(
      this.state.config.targetScore,
      this.state.scores[winnerTeam] + points,
    );
    if (this.state.scores[winnerTeam] >= this.state.config.targetScore) {
      this.state.phase = "MATCH_OVER";
      this.state.matchWinner = winnerTeam;
      const bubbleActor: PlayerId = winnerTeam === "nosotros" ? "player" : "cpu";
      this.emit(
        bubbleActor,
        "match_end",
        `¡${this.teamLabel(winnerTeam)} ganó la partida con ${this.state.scores[winnerTeam]} piedras!`,
        winnerTeam === "nosotros" ? "¡GANAMOS LA PARTIDA!" : "¡GANAMOS!",
      );
      return true;
    }
    return false;
  }

  private resumePausedTrucoOrContinue(): void {
    const s = this.state;
    if (s.phase === "MATCH_OVER") return;

    if (s.pausedTruco) {
      const pt = s.pausedTruco;
      s.pausedTruco = undefined;
      s.phase = "AWAITING_TRUCO";
      s.truco.pendingLevel = pt.pendingLevel;
      s.truco.caller = pt.caller;
      s.truco.callerTeam = pt.callerTeam;
      s.truco.responder = pt.responder;
      s.truco.responderTeam = pt.responderTeam;
      s.turnBeforeCall = pt.turnBeforeCall;
      return;
    }

    s.phase = "PLAYING";
    if (s.turnBeforeCall) {
      s.turn = s.turnBeforeCall;
      s.turnBeforeCall = undefined;
    }
  }

  private handleCallALey(actor: PlayerId): void {
    const s = this.state;
    const hasRealFlor = this.actorHasFlor(actor);
    s.ley.active = true;
    if (!s.ley.declaredBy.includes(actor)) {
      s.ley.declaredBy = [...s.ley.declaredBy, actor];
    }
    if (hasRealFlor && !s.ley.hiddenFlorPlayers.includes(actor)) {
      s.ley.hiddenFlorPlayers = [...s.ley.hiddenFlorPlayers, actor];
    }

    const note = hasRealFlor
      ? " (Flor reservada hasta la 2.ª carta)"
      : " (con ley en la mesa)";
    this.emit(
      actor,
      "call",
      `${this.actorLabel(actor)} canta ¡A Ley!${note}`,
      "¡A LEY!",
    );
  }

  private forfeitDeferredFlorIfNeeded(actor: PlayerId, reason: string): void {
    const s = this.state;
    if (this.hasDeferredFlorALey(actor)) {
      s.ley.hiddenFlorPlayers = s.ley.hiddenFlorPlayers.filter((p) => p !== actor);
      if (!s.ley.forfeitedBy.includes(actor)) {
        s.ley.forfeitedBy = [...s.ley.forfeitedBy, actor];
      }
      if (s.ley.hiddenFlorPlayers.length === 0) {
        s.ley.active = false;
        if (s.trickIndex >= 1) {
          s.flor.resolved = true;
        }
      }
      this.emit(
        actor,
        "response",
        `${this.actorLabel(actor)} perdió la Flor (${reason}).`,
      );
    }
  }

  private handleCallFlor(actor: PlayerId): void {
    const s = this.state;
    const actorTeam = getPlayerTeam(actor);
    const oppTeam = getOppositeTeam(actorTeam);

    // Cada jugador canta únicamente SU propia Flor (nunca la de su compañero)
    const actualHolder = actor;

    s.ley.hiddenFlorPlayers = s.ley.hiddenFlorPlayers.filter((p) => p !== actualHolder);
    if (s.ley.hiddenFlorPlayers.length === 0) {
      s.ley.active = false;
    }

    // Si interrumpe Truco, pausarlo
    if (s.phase === "AWAITING_TRUCO" && s.truco.pendingLevel && s.truco.caller && s.truco.callerTeam) {
      s.pausedTruco = {
        pendingLevel: s.truco.pendingLevel,
        caller: s.truco.caller,
        callerTeam: s.truco.callerTeam,
        responder: actor,
        responderTeam: actorTeam,
        turnBeforeCall: s.turnBeforeCall ?? s.turn,
      };
      s.truco.pendingLevel = undefined;
      s.truco.caller = undefined;
      s.truco.callerTeam = undefined;
      s.truco.responder = undefined;
      s.truco.responderTeam = undefined;
    } else if (s.phase === "PLAYING") {
      s.turnBeforeCall = s.turn;
    }

    // Flor cancela cualquier Envido
    s.envido.resolved = true;
    s.envido.pendingSettlement = false;
    s.envido.stakedPoints = undefined;
    s.envido.chain = [];
    s.envido.caller = undefined;
    s.envido.callerTeam = undefined;
    s.envido.responder = undefined;
    s.envido.responderTeam = undefined;

    const actorFlor = evaluateFlor(s.initialHands[actualHolder] ?? [], s.vira);
    const oppFlorResponder = this.pickFlorResponder(oppTeam, true);

    // Ambos equipos tienen Flor -> responde únicamente el jugador rival que tiene Flor
    if (oppFlorResponder) {
      s.phase = "AWAITING_FLOR";
      s.flor = {
        resolved: false,
        stage: "flor",
        caller: actualHolder,
        callerTeam: actorTeam,
        responder: oppFlorResponder,
        responderTeam: oppTeam,
        pointsAwarded: 0,
      };
      this.emit(
        actualHolder,
        "call",
        `${this.actorLabel(actualHolder)} canta ¡Flor!`,
        "¡FLOR!",
      );
      return;
    }

    // Sin flor rival: si quien canta lleva Flor Reservada (Perico + Perica),
    // canta simplemente "¡Flor!" sin delatar las piezas y cobra las 5 piedras al mostrar al final de la mano
    if (actorFlor.isReservada) {
      s.flor = {
        resolved: true,
        stage: "flor",
        caller: actualHolder,
        callerTeam: actorTeam,
        winnerTeam: actorTeam,
        winnerPlayer: actualHolder,
        pendingSettlement: true,
        stakedPoints: 5,
        pointsAwarded: 0,
        isReservada: true,
      };
      this.emit(
        actualHolder,
        "flor_result",
        `${this.actorLabel(actualHolder)} canta ¡Flor! (Se presenta al final de la mano)`,
        "¡FLOR!",
      );
      this.resumePausedTrucoOrContinue();
      return;
    }

    // Flor común sin flor rival -> 3 piedras
    const pts = 3;
    s.flor = {
      resolved: true,
      stage: "flor",
      caller: actualHolder,
      callerTeam: actorTeam,
      winnerTeam: actorTeam,
      winnerPlayer: actualHolder,
      pointsAwarded: pts,
      resolutionText: `Flor de ${this.actorLabel(actualHolder)} (+${pts} piedras)`,
    };
    this.emit(
      actualHolder,
      "flor_result",
      `¡${this.actorLabel(actualHolder)} canta Flor! +${pts} piedras.`,
      "¡FLOR!",
    );
    if (this.addScore(actorTeam, pts)) return;
    this.resumePausedTrucoOrContinue();
  }

  private handleRespondFlor(
    actor: PlayerId,
    choice: "achico" | "contraflor" | "contraflor_resto" | "quiero" | "no_quiero",
  ): void {
    const s = this.state;
    const actorTeam = getPlayerTeam(actor);
    const oppTeam = getOppositeTeam(actorTeam);

    if (choice === "achico") {
      const pts = 4;
      s.flor.resolved = true;
      s.flor.winnerTeam = oppTeam;
      s.flor.winnerPlayer = s.flor.caller;
      s.flor.pointsAwarded = pts;
      s.flor.resolutionText = `${this.actorLabel(actor)} declina el envite con flor. ${this.teamLabel(oppTeam)} gana +${pts} piedras.`;
      this.emit(
        actor,
        "flor_result",
        `${this.actorLabel(actor)}: "¡Con flor no quiero!". ${this.teamLabel(oppTeam)} suma +${pts} piedras.`,
        "¡CON FLOR NO QUIERO!",
      );
      if (this.addScore(oppTeam, pts)) return;
      this.resumePausedTrucoOrContinue();
      return;
    }

    if (choice === "contraflor") {
      s.flor.stakedPoints = 5;
      s.flor.rejectPoints = 4;
      s.flor.stage = "contraflor";
      s.flor.caller = actor;
      s.flor.callerTeam = actorTeam;
      s.flor.responderTeam = oppTeam;
      s.flor.responder = this.pickFlorResponder(oppTeam, false) ?? this.pickResponder(oppTeam);
      this.emit(
        actor,
        "call",
        `${this.actorLabel(actor)} canta ¡Con flor envido! (5 piedras)`,
        "¡CON FLOR ENVIDO!",
      );
      return;
    }

    if (choice === "contraflor_resto") {
      s.flor.rejectPoints = s.flor.stage === "flor" ? 4 : s.flor.stakedPoints ?? 6;
      s.flor.stakedPoints = calculateFaltaEnvidoPoints(s.scores, s.config);
      s.flor.stage = "contraflor_resto";
      s.flor.caller = actor;
      s.flor.callerTeam = actorTeam;
      s.flor.responderTeam = oppTeam;
      s.flor.responder = this.pickFlorResponder(oppTeam, false) ?? this.pickResponder(oppTeam);
      this.emit(
        actor,
        "call",
        `${this.actorLabel(actor)} canta ¡Con flor envido la falta!`,
        "¡CON FLOR ENVIDO LA FALTA!",
      );
      return;
    }

    if (choice === "no_quiero") {
      const pts = s.flor.rejectPoints ?? (s.flor.stage === "contraflor_resto" ? 6 : 4);
      s.flor.resolved = true;
      s.flor.winnerTeam = oppTeam;
      s.flor.winnerPlayer = s.flor.caller;
      s.flor.pointsAwarded = pts;
      s.flor.resolutionText = `${this.actorLabel(actor)} no quiere el envite con flor. ${this.teamLabel(oppTeam)} suma +${pts} piedras.`;
      this.emit(
        actor,
        "flor_result",
        `${this.actorLabel(actor)}: "No quiero". ${this.teamLabel(oppTeam)} suma +${pts} piedras.`,
        "NO QUIERO",
      );
      if (this.addScore(oppTeam, pts)) return;
      this.resumePausedTrucoOrContinue();
      return;
    }

    // choice === "quiero" -> queda pactada y se descubre al final de la mano
    const pts = s.flor.stakedPoints ?? (
      s.flor.stage === "contraflor_resto"
        ? calculateFaltaEnvidoPoints(s.scores, s.config)
        : 6);

    s.flor.resolved = true;
    s.flor.pendingSettlement = true;
    s.flor.stakedPoints = pts;

    this.emit(
      actor,
      "response",
      `¡Con Flor Quiero! (${pts} piedras en juego — se descubre al final de la mano).`,
      "¡CON FLOR QUIERO!",
    );

    this.resumePausedTrucoOrContinue();
  }

  private handleCallEnvido(actor: PlayerId, call: EnvidoCallType): void {
    const s = this.state;
    const actorTeam = getPlayerTeam(actor);
    const oppTeam = getOppositeTeam(actorTeam);

    // "El Envido está primero" interrumpiendo Truco en 1.ª baza
    if (s.phase === "AWAITING_TRUCO" && s.truco.pendingLevel && s.truco.caller && s.truco.callerTeam) {
      s.pausedTruco = {
        pendingLevel: s.truco.pendingLevel,
        caller: s.truco.caller,
        callerTeam: s.truco.callerTeam,
        responder: actor,
        responderTeam: actorTeam,
        turnBeforeCall: s.turnBeforeCall ?? s.turn,
      };
      s.truco.pendingLevel = undefined;
      s.truco.caller = undefined;
      s.truco.callerTeam = undefined;
      s.truco.responder = undefined;
      s.truco.responderTeam = undefined;
    } else if (s.phase === "PLAYING") {
      s.turnBeforeCall = s.turn;
    }

    s.phase = "AWAITING_ENVIDO";
    s.envido.chain = [...s.envido.chain, call];
    s.envido.caller = actor;
    s.envido.callerTeam = actorTeam;
    s.envido.responderTeam = oppTeam;
    // Si alguien del equipo rival tiene Flor elegible, responde ESE jugador personalmente (nadie canta la Flor del compañero)
    const oppFlorHolder = !s.flor.resolved ? this.pickFlorResponder(oppTeam, true) : undefined;
    s.envido.responder = oppFlorHolder ?? this.pickResponder(oppTeam);

    const withLeyPrefix =
      s.ley.declaredBy.includes(actor) && s.envido.chain.length === 1;

    const canto = envidoLabel(call, s.envido.chain.length > 1);
    const baseLabel = `¡${withLeyPrefix ? "A LEY, " : ""}${canto.toUpperCase()}!`;

    this.emit(actor, "call", `${this.actorLabel(actor)} canta ${baseLabel}`, baseLabel);
  }

  private handleRespondEnvido(actor: PlayerId, accept: boolean): void {
    const s = this.state;
    const actorTeam = getPlayerTeam(actor);
    const oppTeam = getOppositeTeam(actorTeam);
    const stakes = this.getEnvidoStakes(s.envido.chain);
    const label = envidoResponseLabel(accept, s.ley.active);
    const bubble = `¡${label.toUpperCase()}!`;

    s.envido.resolved = true;
    s.envido.accepted = accept;
    s.envido.pendingSettlement = true;

    if (!accept) {
      s.envido.winnerTeam = oppTeam;
      s.envido.stakedPoints = stakes.reject;
      this.emit(
        actor,
        "response",
        `${this.actorLabel(actor)}: "${label}" al Envido (+${stakes.reject} piedra${stakes.reject > 1 ? "s" : ""} al final de la mano).`,
        bubble,
      );
      this.resumePausedTrucoOrContinue();
      return;
    }

    s.envido.stakedPoints = stakes.accept;
    this.emit(
      actor,
      "response",
      `${this.actorLabel(actor)}: "${label}" al Envido (${stakes.accept} piedras en juego — se resuelve al final de la mano).`,
      bubble,
    );

    this.resumePausedTrucoOrContinue();
  }

  private handleCallTruco(actor: PlayerId): void {
    const s = this.state;
    const actorTeam = getPlayerTeam(actor);
    const oppTeam = getOppositeTeam(actorTeam);

    // Si alguien del equipo tenía Flor guardada "a ley" y cantan Truco sin declararla, la pierde
    this.forfeitDeferredFlorIfNeeded(actor, "cantó Truco sin declarar su Flor primero");

    let nextLevel: TrucoLevel;
    if (s.phase === "AWAITING_TRUCO" && s.truco.pendingLevel) {
      s.truco.level = s.truco.pendingLevel;
      // Al subir a Retruco/Vale 9/Vale Juego queda aceptado el Truco y cerrada la ventana de Envido
      s.envido.resolved = true;
      nextLevel = Math.min(4, s.truco.pendingLevel + 1) as TrucoLevel;
    } else {
      s.turnBeforeCall = s.turn;
      nextLevel = Math.min(4, s.truco.level + 1) as TrucoLevel;
    }

    const label = trucoCallLabel(nextLevel, s.phase === "AWAITING_TRUCO");
    s.phase = "AWAITING_TRUCO";
    s.truco.pendingLevel = nextLevel;
    s.truco.caller = actor;
    s.truco.callerTeam = actorTeam;
    s.truco.responderTeam = oppTeam;
    s.truco.responder = this.pickResponder(oppTeam);

    this.emit(
      actor,
      "call",
      `${this.actorLabel(actor)} canta ¡${label}!`,
      `¡${label.toUpperCase()}!`,
    );
  }

  private handleRespondTruco(actor: PlayerId, accept: boolean): void {
    const s = this.state;
    const actorTeam = getPlayerTeam(actor);
    const oppTeam = getOppositeTeam(actorTeam);
    const pending = s.truco.pendingLevel ?? 1;

    this.forfeitDeferredFlorIfNeeded(actor, "respondió al Truco sin declarar su Flor primero");

    if (!accept) {
      const pts = getTrucoRejectPoints(pending);
      s.truco.pendingLevel = undefined;
      s.truco.caller = undefined;
      s.truco.callerTeam = undefined;
      s.truco.responder = undefined;
      s.truco.responderTeam = undefined;

      this.emit(
        actor,
        "response",
        `${this.actorLabel(actor)} no quiere el ${TRUCO_LEVEL_NAMES[pending]}.`,
        "NO QUIERO",
      );
      this.finishHand(
        oppTeam,
        pts,
        `${this.teamLabel(actorTeam)} no quiso el ${TRUCO_LEVEL_NAMES[pending]}`,
      );
      return;
    }

    // Accepted! Al aceptarse el Truco se cierra definitivamente la ventana de Envido
    s.truco.level = pending;
    s.truco.ownerTeam = actorTeam;
    s.envido.resolved = true;
    s.truco.pendingLevel = undefined;
    s.truco.caller = undefined;
    s.truco.callerTeam = undefined;
    s.truco.responder = undefined;
    s.truco.responderTeam = undefined;
    s.phase = "PLAYING";
    if (s.turnBeforeCall) {
      s.turn = s.turnBeforeCall;
      s.turnBeforeCall = undefined;
    }

    this.emit(
      actor,
      "response",
      `${this.actorLabel(actor)} acepta el ${TRUCO_LEVEL_NAMES[pending]}!`,
      "¡QUIERO!",
    );
  }

  private handleIrseAlMazo(actor: PlayerId): void {
    const s = this.state;
    const actorTeam = getPlayerTeam(actor);
    const oppTeam = getOppositeTeam(actorTeam);
    let pts = getTrucoAcceptPoints(s.truco.level, s.scores, s.config.targetScore);

    const oppHasUnplayedTrick0 = this.getTeamMembers(oppTeam).some(
      (m) => !this.hasPlayedInTrick(m, 0),
    );
    if (
      s.trickIndex === 0 &&
      !s.envido.resolved &&
      !s.flor.resolved &&
      s.truco.level === 0 &&
      oppHasUnplayedTrick0
    ) {
      pts += 1;
    }

    this.emit(
      actor,
      "response",
      `${this.actorLabel(actor)} se va al mazo.`,
      "¡ME VOY!",
    );
    this.finishHand(oppTeam, pts, `${this.teamLabel(actorTeam)} se fue al mazo`);
  }

  private handlePlayCard(actor: PlayerId, cardId: string, burned: boolean): void {
    const s = this.state;
    const hand = s.hands[actor];
    if (!hand) return;
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) return;

    const [card] = hand.splice(idx, 1);
    const trick = s.tricks[s.trickIndex];

    if (s.trickIndex === 1) {
      this.forfeitDeferredFlorIfNeeded(actor, "jugó la 2.ª carta sin cantarla");
    }

    const order = Object.keys(trick.played).length;
    trick.played[actor] = { card, burned, order };

    if (burned) {
      this.emit(
        actor,
        "burn_card",
        `${this.actorLabel(actor)} quema una carta (boca abajo).`,
      );
    } else {
      const aLeyNote =
        s.trickIndex === 0 && s.ley.declaredBy.includes(actor) ? " (a ley)" : "";
      this.emit(
        actor,
        "play_card",
        `${this.actorLabel(actor)} juega ${getCardName(card, s.vira)}${aLeyNote}.`,
      );
    }

    // ¿Todos los jugadores de la mesa ya tiraron en esta baza?
    if (Object.keys(trick.played).length >= s.seats.length) {
      const outcome = resolveTrickOutcome(trick.played, s.seats, s.vira);
      trick.winnerTeam = outcome.winnerTeam;
      trick.winnerPlayer = outcome.winnerPlayer;

      if (s.trickIndex === 0) {
        s.envido.resolved = true;
        if (s.ley.hiddenFlorPlayers.length === 0) {
          s.flor.resolved = true;
          s.ley.active = false;
        }
      } else if (s.trickIndex === 1) {
        s.flor.resolved = true;
        s.ley.active = false;
        s.ley.hiddenFlorPlayers = [];
      }

      const trickWinners = s.tricks
        .map((t) => t.winnerTeam)
        .filter((w): w is TrickWinner => Boolean(w));

      const handWinnerTeam = resolveHandWinnerFromTricks(
        trickWinners,
        getPlayerTeam(s.mano),
      );

      if (handWinnerTeam) {
        const pts = getTrucoAcceptPoints(s.truco.level, s.scores, s.config.targetScore);
        const reason =
          outcome.winnerTeam === "parda"
            ? `Empate en baza ${s.trickIndex + 1} — gana ${this.teamLabel(handWinnerTeam)}`
            : `${this.teamLabel(handWinnerTeam)} gana el lance del Truco`;
        this.finishHand(handWinnerTeam, pts, reason);
        return;
      }

      // Siguiente baza
      s.trickIndex += 1;
      const nextLead: PlayerId =
        outcome.winnerTeam === "parda"
          ? trick.lead
          : (outcome.winnerPlayer ?? trick.lead);
      s.tricks.push({ lead: nextLead, played: {} });
      s.turn = nextLead;

      if (outcome.winnerTeam === "parda") {
        this.emit(
          "system",
          "trick_win",
          `¡Baza ${s.trickIndex} parda! Vuelve a salir ${this.actorLabel(nextLead)}.`,
        );
      } else {
        this.emit(
          "system",
          "trick_win",
          `${this.teamLabel(outcome.winnerTeam)} gana la baza ${s.trickIndex} (sale ${this.actorLabel(nextLead)}).`,
        );
      }
      return;
    }

    // Turno del siguiente jugador en orden antihorario
    s.turn = this.getNextSeat(actor);
  }

  private finishHand(winnerTeam: TeamId, trucoPoints: number, reason: string): void {
    const s = this.state;

    // 1a) Flor Reservada (Perico + Perica) guardada en silencio sin haberse cantado durante la mano
    if (s.config.withFlor && s.flor.stage === "none") {
      const reservadaHolder = s.seats.find((seat) => this.actorHasFlorReservada(seat));
      if (reservadaHolder) {
        const holderTeam = getPlayerTeam(reservadaHolder);
        const pts = 5;
        // La Flor Reservada anula cualquier Envido pendiente de la mano
        s.envido.pendingSettlement = false;
        s.envido.accepted = false;
        s.envido.resolved = true;
        s.flor = {
          resolved: true,
          stage: "flor_reservada",
          caller: reservadaHolder,
          callerTeam: holderTeam,
          winnerTeam: holderTeam,
          winnerPlayer: reservadaHolder,
          pointsAwarded: pts,
          isReservada: true,
          resolutionText: `Flor Reservada de ${this.actorLabel(reservadaHolder)} (Perico y Perica) (+${pts} piedras)`,
        };
        if (this.addScore(holderTeam, pts)) {
          s.handSummary = {
            trickWinnerTeam: holderTeam,
            trucoPoints: 0,
            florText: s.flor.resolutionText,
            reason: `${this.teamLabel(holderTeam)} cierra la partida con Flor Reservada`,
          };
          return;
        }
      }
    }

    // 1b) Resolver Flor Reservada cantada como "¡Flor!" o Contraflor aceptada al final de la mano
    if (s.flor.pendingSettlement) {
      s.flor.pendingSettlement = false;

      if (s.flor.stage === "flor" && s.flor.isReservada && s.flor.winnerTeam) {
        const pts = s.flor.stakedPoints ?? 5;
        const holder = s.flor.winnerPlayer ?? s.flor.caller ?? "player";
        s.flor.stage = "flor_reservada";
        s.flor.pointsAwarded = pts;
        s.flor.resolutionText = `Flor Reservada de ${this.actorLabel(holder)} (Perico y Perica) (+${pts} piedras)`;

        if (this.addScore(s.flor.winnerTeam, pts)) {
          s.handSummary = {
            trickWinnerTeam: s.flor.winnerTeam,
            trucoPoints: 0,
            florText: s.flor.resolutionText,
            reason: `${this.teamLabel(s.flor.winnerTeam)} cierra la partida con Flor Reservada`,
          };
          return;
        }
      } else {
        const nFlor = this.getTeamBestFlor("nosotros");
        const eFlor = this.getTeamBestFlor("ellos");

        let florWinnerTeam: TeamId;
        if (nFlor.isReservada !== eFlor.isReservada) {
          florWinnerTeam = nFlor.isReservada ? "nosotros" : "ellos";
        } else if (nFlor.points > eFlor.points) {
          florWinnerTeam = "nosotros";
        } else if (eFlor.points > nFlor.points) {
          florWinnerTeam = "ellos";
        } else {
          const nDist = nFlor.player
            ? getSeatDistanceFromMano(nFlor.player, s.mano, s.seats)
            : 99;
          const eDist = eFlor.player
            ? getSeatDistanceFromMano(eFlor.player, s.mano, s.seats)
            : 99;
          florWinnerTeam = nDist <= eDist ? "nosotros" : "ellos";
        }

        const pts = s.flor.stakedPoints ?? 6;
        s.flor.winnerTeam = florWinnerTeam;
        s.flor.winnerPlayer =
          florWinnerTeam === "nosotros" ? nFlor.player : eFlor.player;
        s.flor.pointsAwarded = pts;
        s.flor.nosotrosPoints = nFlor.points;
        s.flor.nosotrosBestPlayer = nFlor.player;
        s.flor.ellosPoints = eFlor.points;
        s.flor.ellosBestPlayer = eFlor.player;
        s.flor.isReservada = nFlor.isReservada || eFlor.isReservada;

        const nDesc = nFlor.isReservada ? "Flor Reservada" : `${nFlor.points}`;
        const eDesc = eFlor.isReservada ? "Flor Reservada" : `${eFlor.points}`;
        const tieNote =
          !nFlor.isReservada && !eFlor.isReservada && nFlor.points === eFlor.points
            ? " (Mano)"
            : "";
        s.flor.resolutionText = `Envite con flor: ${this.teamLabel("nosotros")} ${nDesc} vs ${this.teamLabel("ellos")} ${eDesc}${tieNote} → ${this.teamLabel(florWinnerTeam)} (+${pts})`;

        if (this.addScore(florWinnerTeam, pts)) {
          s.handSummary = {
            trickWinnerTeam: florWinnerTeam,
            trucoPoints: 0,
            florText: s.flor.resolutionText,
            reason: `${this.teamLabel(florWinnerTeam)} cierra la partida con el envite de flor`,
          };
          return;
        }
      }
    }

    // 2) Resolver Envido al final de la mano (primero que el Truco)
    if (s.envido.pendingSettlement) {
      s.envido.pendingSettlement = false;
      if (s.envido.accepted) {
        const nEnv = this.getTeamBestEnvido("nosotros");
        const eEnv = this.getTeamBestEnvido("ellos");

        let envWinnerTeam: TeamId;
        if (nEnv.points > eEnv.points) {
          envWinnerTeam = "nosotros";
        } else if (eEnv.points > nEnv.points) {
          envWinnerTeam = "ellos";
        } else {
          const nDist = getSeatDistanceFromMano(nEnv.player, s.mano, s.seats);
          const eDist = getSeatDistanceFromMano(eEnv.player, s.mano, s.seats);
          envWinnerTeam = nDist <= eDist ? "nosotros" : "ellos";
        }

        const isFalta = s.envido.chain[s.envido.chain.length - 1] === "falta_envido";
        const pts = isFalta
          ? calculateFaltaEnvidoPoints(s.scores, s.config)
          : (s.envido.stakedPoints ?? 2);

        s.envido.winnerTeam = envWinnerTeam;
        s.envido.winnerPlayer =
          envWinnerTeam === "nosotros" ? nEnv.player : eEnv.player;
        s.envido.pointsAwarded = pts;
        s.envido.nosotrosPoints = nEnv.points;
        s.envido.nosotrosBestPlayer = nEnv.player;
        s.envido.ellosPoints = eEnv.points;
        s.envido.ellosBestPlayer = eEnv.player;

        const tieNote = nEnv.points === eEnv.points ? " (Mano)" : "";
        const envStr = `Envido: ${this.actorLabel(nEnv.player)} ${nEnv.points} vs ${this.actorLabel(eEnv.player)} ${eEnv.points}${tieNote} → ${this.teamLabel(envWinnerTeam)} (+${pts})`;

        if (this.addScore(envWinnerTeam, pts)) {
          s.handSummary = {
            trickWinnerTeam: envWinnerTeam,
            trucoPoints: 0,
            florText: s.flor.resolutionText,
            envidoText: envStr,
            reason: `${this.teamLabel(envWinnerTeam)} cierra la partida con el Envido`,
          };
          return;
        }
      } else if (s.envido.winnerTeam) {
        const pts = s.envido.stakedPoints ?? 1;
        s.envido.pointsAwarded = pts;
        if (this.addScore(s.envido.winnerTeam, pts)) {
          s.handSummary = {
            trickWinnerTeam: s.envido.winnerTeam,
            trucoPoints: 0,
            florText: s.flor.resolutionText,
            envidoText: `Envido no querido → ${this.teamLabel(s.envido.winnerTeam)} (+${pts})`,
            reason: `${this.teamLabel(s.envido.winnerTeam)} cierra la partida con el Envido`,
          };
          return;
        }
      }
    }

    const envidoText =
      s.envido.pointsAwarded > 0 && s.envido.winnerTeam
        ? s.envido.accepted &&
          s.envido.nosotrosBestPlayer &&
          s.envido.ellosBestPlayer
          ? `Envido: ${this.actorLabel(s.envido.nosotrosBestPlayer)} ${s.envido.nosotrosPoints} vs ${this.actorLabel(s.envido.ellosBestPlayer)} ${s.envido.ellosPoints}${s.envido.nosotrosPoints === s.envido.ellosPoints ? " (Mano)" : ""} → ${this.teamLabel(s.envido.winnerTeam)} (+${s.envido.pointsAwarded})`
          : `Envido no querido → ${this.teamLabel(s.envido.winnerTeam)} (+${s.envido.pointsAwarded})`
        : undefined;

    const florText = s.flor.resolutionText;

    s.handSummary = {
      trickWinnerTeam: winnerTeam,
      trucoPoints,
      envidoText,
      florText,
      reason,
    };

    const matchEnded = this.addScore(winnerTeam, trucoPoints);
    if (!matchEnded) {
      s.phase = "HAND_OVER";
      const eventActor: PlayerId = winnerTeam === "nosotros" ? "player" : "cpu";
      this.emit(
        eventActor,
        "hand_end",
        `${reason} (+${trucoPoints} piedra${trucoPoints > 1 ? "s" : ""}).`,
      );
    }
  }

  private startNextHand(): void {
    const s = this.state;
    const nextMano = this.getNextSeat(s.mano);
    const deal = this.deal(s.seats);

    const initialHands: Partial<Record<PlayerId, typeof deal.vira[]>> = {};
    const hands: Partial<Record<PlayerId, typeof deal.vira[]>> = {};
    for (const seat of s.seats) {
      const cards = deal.hands[seat] ?? [];
      initialHands[seat] = [...cards];
      hands[seat] = [...cards];
    }

    s.handNumber += 1;
    s.mano = nextMano;
    s.turn = nextMano;
    s.turnBeforeCall = undefined;
    s.phase = "PLAYING";
    s.vira = deal.vira;
    s.initialHands = initialHands;
    s.hands = hands;
    s.trickIndex = 0;
    s.tricks = [{ lead: nextMano, played: {} }];
    s.envido = { resolved: false, chain: [], pointsAwarded: 0 };
    s.flor = { resolved: false, stage: "none", pointsAwarded: 0 };
    s.truco = { level: 0 };
    s.ley = { active: false, declaredBy: [], hiddenFlorPlayers: [], forfeitedBy: [] };
    s.pausedTruco = undefined;
    s.handSummary = undefined;

    this.emit(
      "system",
      "deal",
      `Mano #${s.handNumber} — Vira: ${getCardName(s.vira)}. Sale ${this.actorLabel(nextMano)}.`,
    );
  }
}
