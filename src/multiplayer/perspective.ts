import {
  Card,
  GameEvent,
  GameMode,
  GameState,
  getOppositeTeam,
  getPlayerLabel,
  getPlayerTeam,
  getSeatsForMode,
  PlayerId,
  TeamId,
  TrickState,
  TrickWinner,
} from "../engine/types.ts";

export const HIDDEN_CARD_PREFIX = "hidden_";

export function isHiddenCardId(cardId: string): boolean {
  return cardId.startsWith(HIDDEN_CARD_PREFIX);
}

function makeHiddenCard(seat: PlayerId, index: number): Card {
  return {
    id: `${HIDDEN_CARD_PREFIX}${seat}_${index}`,
    suit: "oros",
    rank: 4,
  };
}

/**
 * Rota un asiento canónico del anfitrión a la perspectiva local de `viewerSeat`,
 * de modo que `viewerSeat` siempre ocupe "player" (Sur) en su propia pantalla.
 */
export function mapSeatToViewer(
  seat: PlayerId,
  viewerSeat: PlayerId,
  seats: PlayerId[],
): PlayerId {
  const sIdx = seats.indexOf(seat);
  const vIdx = seats.indexOf(viewerSeat);
  if (sIdx === -1 || vIdx === -1) return seat;
  const relIdx = (sIdx - vIdx + seats.length) % seats.length;
  return seats[relIdx];
}

/**
 * Inversa de `mapSeatToViewer`: convierte un asiento relativo de pantalla al asiento canónico.
 */
export function mapViewerToCanonicalSeat(
  relSeat: PlayerId,
  viewerSeat: PlayerId,
  seats: PlayerId[],
): PlayerId {
  const rIdx = seats.indexOf(relSeat);
  const vIdx = seats.indexOf(viewerSeat);
  if (rIdx === -1 || vIdx === -1) return relSeat;
  return seats[(rIdx + vIdx) % seats.length];
}

export function mapTeamToViewer(team: TeamId, viewerSeat: PlayerId): TeamId {
  return getPlayerTeam(viewerSeat) === "nosotros" ? team : getOppositeTeam(team);
}

// Los resúmenes persistidos contienen las etiquetas del motor en el orden canónico.
export function formatOnlineSummaryText(
  text: string,
  mode: GameMode,
  viewerSeat: PlayerId,
  seatLabel: (seat: PlayerId) => string,
): string {
  const seats = getSeatsForMode(mode);
  const labels = new Map<string, string>();
  for (const seat of seats) {
    labels.set(getPlayerLabel(seat, mode), seatLabel(mapSeatToViewer(seat, viewerSeat, seats)));
  }
  if (mode === "2v2") {
    const sameTeam = getPlayerTeam(viewerSeat) === "nosotros";
    labels.set("Nosotros", sameTeam ? "Nuestro equipo" : "El equipo rival");
    labels.set("Ellos", sameTeam ? "El equipo rival" : "Nuestro equipo");
  }
  // Una sola pasada conserva incluso un apodo que contiene otra etiqueta, como “CPU Junior”.
  return text.replace(new RegExp([...labels.keys()].join("|"), "gu"), (label) => labels.get(label)!);
}

function mapTrickWinner(
  winner: TrickWinner | undefined,
  viewerSeat: PlayerId,
): TrickWinner | undefined {
  if (!winner || winner === "parda") return winner;
  return mapTeamToViewer(winner, viewerSeat);
}

export function projectSeatRecordForViewer<T>(
  record: Partial<Record<PlayerId, T>>,
  viewerSeat: PlayerId,
  seats: PlayerId[],
): Partial<Record<PlayerId, T>> {
  const out: Partial<Record<PlayerId, T>> = {};
  for (const seat of seats) {
    if (record[seat] !== undefined) {
      out[mapSeatToViewer(seat, viewerSeat, seats)] = record[seat];
    }
  }
  return out;
}

function projectEvent(ev: GameEvent, viewerSeat: PlayerId, seats: PlayerId[]): GameEvent {
  return {
    ...ev,
    actor: ev.actor === "system" ? "system" : mapSeatToViewer(ev.actor, viewerSeat, seats),
  };
}

function shouldRevealSeatCardsAtHandEnd(state: GameState, seat: PlayerId): boolean {
  if (state.phase !== "HAND_OVER" && state.phase !== "MATCH_OVER") return false;
  if (state.envido.accepted) {
    if (state.config.mode === "1v1") return true;
    return (
      seat === state.envido.nosotrosBestPlayer ||
      seat === state.envido.ellosBestPlayer
    );
  }
  if (state.flor.stage !== "none" && state.flor.resolved) {
    return (
      seat === state.flor.caller ||
      seat === state.flor.winnerPlayer ||
      seat === state.flor.nosotrosBestPlayer ||
      seat === state.flor.ellosBestPlayer
    );
  }
  return false;
}

/**
 * Determina qué cartas de otros asientos son visibles legalmente para `viewerSeat`:
 * - Siempre sus propias cartas.
 * - Siempre cartas jugadas boca arriba sobre la mesa.
 * - En 2v2 al iniciar la mano (ritual venezolano):
 *   - El antepie puede ver la 1.ª carta que pasa al Mano.
 *   - El repartidor puede ver la 1.ª carta que pasa a su compañero (trasmano).
 * - Al finalizar la mano (`HAND_OVER` / `MATCH_OVER`): las cartas presentadas por Envido o Flor.
 * Todas las demás cartas se reemplazan por placeholders `hidden_*` antes de salir por la red (Anti-trampa).
 */
export function sanitizeCanonicalStateForViewer(
  state: GameState,
  viewerSeat: PlayerId,
): GameState {
  const seats = state.seats;
  const visibleCardIdsBySeat = new Map<PlayerId, Set<string>>();

  for (const seat of seats) {
    const visibleIds = new Set<string>();
    const initial = state.initialHands[seat] ?? [];

    if (seat === viewerSeat || shouldRevealSeatCardsAtHandEnd(state, seat)) {
      for (const c of initial) visibleIds.add(c.id);
    } else {
      // Cartas jugadas boca arriba en cualquier baza son públicas
      for (const tr of state.tricks) {
        const entry = tr.played[seat];
        if (entry && !entry.burned) {
          visibleIds.add(entry.card.id);
        }
      }

      // Ritual venezolano 2v2: carta vista por antepie o repartidor al repartir
      if (seats.length === 4 && initial.length > 0) {
        const manoIdx = seats.indexOf(state.mano);
        const dealerIdx = (manoIdx - 1 + 4) % 4;
        const trasmanoSeat = seats[(manoIdx + 1) % 4];
        const antepieSeat = seats[(manoIdx + 2) % 4];
        const dealerSeat = seats[dealerIdx];

        if (viewerSeat === antepieSeat && seat === state.mano) {
          visibleIds.add(initial[0].id);
        }
        if (viewerSeat === dealerSeat && seat === trasmanoSeat) {
          visibleIds.add(initial[0].id);
        }
      }
    }

    visibleCardIdsBySeat.set(seat, visibleIds);
  }

  // Construir mapa estable cardId -> carta sanitizada por asiento
  const cardSlotMap = new Map<string, Card>();
  const sanitizedInitialHands: Partial<Record<PlayerId, Card[]>> = {};
  const sanitizedHands: Partial<Record<PlayerId, Card[]>> = {};

  for (const seat of seats) {
    const visibleIds = visibleCardIdsBySeat.get(seat) ?? new Set<string>();
    const initial = state.initialHands[seat] ?? [];
    const maskedInitial = initial.map((c, idx) => {
      const resolved = visibleIds.has(c.id) ? c : makeHiddenCard(seat, idx);
      cardSlotMap.set(`${seat}_${c.id}`, resolved);
      return resolved;
    });
    sanitizedInitialHands[seat] = maskedInitial;

    const currentHand = state.hands[seat] ?? [];
    sanitizedHands[seat] = currentHand.map(
      (c, idx) => cardSlotMap.get(`${seat}_${c.id}`) ?? makeHiddenCard(seat, idx),
    );
  }

  const sanitizedTricks: TrickState[] = state.tricks.map((tr) => {
    const played: TrickState["played"] = {};
    for (const seat of seats) {
      const entry = tr.played[seat];
      if (!entry) continue;
      const sanitizedCard =
        cardSlotMap.get(`${seat}_${entry.card.id}`) ?? entry.card;
      played[seat] = {
        ...entry,
        card: sanitizedCard,
      };
    }
    return {
      ...tr,
      played,
    };
  });

  // Ocultar listas internas de Flor guardada "a ley" de otros jugadores durante la mano
  const isHandDone = state.phase === "HAND_OVER" || state.phase === "MATCH_OVER";
  const sanitizedLey = isHandDone
    ? state.ley
    : {
        ...state.ley,
        hiddenFlorPlayers: state.ley.hiddenFlorPlayers.filter((p) => p === viewerSeat),
      };

  // No filtrar puntajes internos de Envido/Flor antes de terminar la mano
  const sanitizedEnvido = isHandDone
    ? state.envido
    : {
        ...state.envido,
        nosotrosPoints: undefined,
        ellosPoints: undefined,
        nosotrosBestPlayer: undefined,
        ellosBestPlayer: undefined,
      };

  const sanitizedFlor = isHandDone
    ? state.flor
    : {
        ...state.flor,
        nosotrosPoints: undefined,
        ellosPoints: undefined,
        nosotrosBestPlayer: undefined,
        ellosBestPlayer: undefined,
        // No delatar Flor Reservada antes del cierre de mano
        isReservada:
          state.flor.winnerPlayer === viewerSeat ? state.flor.isReservada : undefined,
      };

  return {
    ...state,
    initialHands: sanitizedInitialHands,
    hands: sanitizedHands,
    tricks: sanitizedTricks,
    ley: sanitizedLey,
    envido: sanitizedEnvido,
    flor: sanitizedFlor,
  };
}

/**
 * Proyecta un `GameState` canónico hacia la perspectiva de cualquier asiento conectado.
 * Si `viewerSeat === "player"`, devuelve el estado sin rotación.
 */
export function projectStateForViewer(state: GameState, viewerSeat: PlayerId): GameState {
  const seats = state.seats;
  if (viewerSeat === "player") {
    return state;
  }

  const swapTeams = getPlayerTeam(viewerSeat) === "ellos";
  const mSeat = (p: PlayerId | undefined): PlayerId | undefined =>
    p ? mapSeatToViewer(p, viewerSeat, seats) : undefined;
  const mTeam = (t: TeamId | undefined): TeamId | undefined =>
    t ? mapTeamToViewer(t, viewerSeat) : undefined;

  const projectedTricks: TrickState[] = state.tricks.map((tr) => ({
    lead: mapSeatToViewer(tr.lead, viewerSeat, seats),
    played: projectSeatRecordForViewer(tr.played, viewerSeat, seats),
    winnerTeam: mapTrickWinner(tr.winnerTeam, viewerSeat),
    winnerPlayer: mSeat(tr.winnerPlayer),
  }));

  const envNosotrosPts = swapTeams ? state.envido.ellosPoints : state.envido.nosotrosPoints;
  const envEllosPts = swapTeams ? state.envido.nosotrosPoints : state.envido.ellosPoints;
  const envNosotrosBest = mSeat(
    swapTeams ? state.envido.ellosBestPlayer : state.envido.nosotrosBestPlayer,
  );
  const envEllosBest = mSeat(
    swapTeams ? state.envido.nosotrosBestPlayer : state.envido.ellosBestPlayer,
  );

  const florNosotrosPts = swapTeams ? state.flor.ellosPoints : state.flor.nosotrosPoints;
  const florEllosPts = swapTeams ? state.flor.nosotrosPoints : state.flor.ellosPoints;
  const florNosotrosBest = mSeat(
    swapTeams ? state.flor.ellosBestPlayer : state.flor.nosotrosBestPlayer,
  );
  const florEllosBest = mSeat(
    swapTeams ? state.flor.nosotrosBestPlayer : state.flor.ellosBestPlayer,
  );

  return {
    ...state,
    scores: swapTeams
      ? { nosotros: state.scores.ellos, ellos: state.scores.nosotros }
      : { ...state.scores },
    mano: mapSeatToViewer(state.mano, viewerSeat, seats),
    turn: mapSeatToViewer(state.turn, viewerSeat, seats),
    turnBeforeCall: mSeat(state.turnBeforeCall),
    initialHands: projectSeatRecordForViewer(state.initialHands, viewerSeat, seats),
    hands: projectSeatRecordForViewer(state.hands, viewerSeat, seats),
    tricks: projectedTricks,
    rematch: state.rematch ? {
      matchId: state.rematch.matchId,
      players: state.rematch.players.map(p => mapSeatToViewer(p, viewerSeat, seats)),
      confirmed: state.rematch.confirmed.map(p => mapSeatToViewer(p, viewerSeat, seats)),
    } : undefined,
    prive: state.prive ? {
      ...state.prive,
      asker: mapSeatToViewer(state.prive.asker, viewerSeat, seats),
      declarer: mapSeatToViewer(state.prive.declarer, viewerSeat, seats),
      winnerTeam: mTeam(state.prive.winnerTeam),
    } : undefined,
    envido: {
      ...state.envido,
      caller: mSeat(state.envido.caller),
      callerTeam: mTeam(state.envido.callerTeam),
      responder: mSeat(state.envido.responder),
      responderTeam: mTeam(state.envido.responderTeam),
      winnerTeam: mTeam(state.envido.winnerTeam),
      winnerPlayer: mSeat(state.envido.winnerPlayer),
      nosotrosPoints: envNosotrosPts,
      nosotrosBestPlayer: envNosotrosBest,
      ellosPoints: envEllosPts,
      ellosBestPlayer: envEllosBest,
    },
    flor: {
      ...state.flor,
      caller: mSeat(state.flor.caller),
      callerTeam: mTeam(state.flor.callerTeam),
      responder: mSeat(state.flor.responder),
      responderTeam: mTeam(state.flor.responderTeam),
      winnerTeam: mTeam(state.flor.winnerTeam),
      winnerPlayer: mSeat(state.flor.winnerPlayer),
      nosotrosPoints: florNosotrosPts,
      nosotrosBestPlayer: florNosotrosBest,
      ellosPoints: florEllosPts,
      ellosBestPlayer: florEllosBest,
    },
    truco: {
      ...state.truco,
      ownerTeam: mTeam(state.truco.ownerTeam),
      caller: mSeat(state.truco.caller),
      callerTeam: mTeam(state.truco.callerTeam),
      responder: mSeat(state.truco.responder),
      responderTeam: mTeam(state.truco.responderTeam),
    },
    ley: {
      ...state.ley,
      declaredBy: state.ley.declaredBy.map((p) => mapSeatToViewer(p, viewerSeat, seats)),
      hiddenFlorPlayers: state.ley.hiddenFlorPlayers.map((p) =>
        mapSeatToViewer(p, viewerSeat, seats),
      ),
      forfeitedBy: state.ley.forfeitedBy.map((p) => mapSeatToViewer(p, viewerSeat, seats)),
    },
    pausedTruco: state.pausedTruco
      ? {
          ...state.pausedTruco,
          caller: mapSeatToViewer(state.pausedTruco.caller, viewerSeat, seats),
          callerTeam: mapTeamToViewer(state.pausedTruco.callerTeam, viewerSeat),
          responder: mapSeatToViewer(state.pausedTruco.responder, viewerSeat, seats),
          responderTeam: mapTeamToViewer(state.pausedTruco.responderTeam, viewerSeat),
          turnBeforeCall: mapSeatToViewer(state.pausedTruco.turnBeforeCall, viewerSeat, seats),
        }
      : undefined,
    handSummary: state.handSummary
      ? {
          ...state.handSummary,
          trickWinnerTeam: mapTeamToViewer(state.handSummary.trickWinnerTeam, viewerSeat),
        }
      : undefined,
    matchWinner: mTeam(state.matchWinner),
    lastEvent: state.lastEvent ? projectEvent(state.lastEvent, viewerSeat, seats) : undefined,
    log: state.log.map((ev) => projectEvent(ev, viewerSeat, seats)),
  };
}

/**
 * Sanitiza primero (anti-trampa) y luego proyecta a la perspectiva de `viewerSeat`.
 */
export function buildSafeViewerState(
  canonicalState: GameState,
  viewerSeat: PlayerId,
): GameState {
  const sanitized = sanitizeCanonicalStateForViewer(canonicalState, viewerSeat);
  return projectStateForViewer(sanitized, viewerSeat);
}
