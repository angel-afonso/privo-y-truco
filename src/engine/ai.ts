import {
  calculateEnvidoPoints,
  evaluateFlor,
  getCardTrucoPower,
} from "./evaluator.ts";
import { TrucoEngine } from "./gameEngine.ts";
import { PartnerTacticalHint } from "./partnerComms.ts";
import { Card, getPlayerTeam, PlayerAction, PlayerId } from "./types.ts";

/**
 * IA estratégica para Truco Venezolano (1 vs 1 y 2 vs 2).
 * Conduce cualquier asiento bot ("cpu", "partner", "cpu2") teniendo en cuenta
 * cartas jugadas por el compañero, rivales en la baza actual y órdenes del jugador.
 */
export function decideBotAction(
  engine: TrucoEngine,
  actor: PlayerId,
  rng: () => number = Math.random,
  partnerHint?: PartnerTacticalHint,
): PlayerAction | null {
  const state = engine.getState();
  const legal = engine.getLegalActions(actor);
  const myTeam = getPlayerTeam(actor);

  const hand = state.hands[actor] ?? [];
  const fullHand = state.initialHands[actor] ?? [];
  const vira = state.vira;

  // 1) Si tiene Flor guardada "a ley" obligatoria (2.ª baza o ante Envido/Truco), cantarla siempre
  if (legal.mustCallFlorALey && legal.canCallFlor) {
    return { type: "CALL_FLOR" };
  }

  // 1b) Si tiene Flor en 1.ª baza:
  // - Con Flor Reservada (Perico + Perica) NO se canta en jugada normal: se reserva callado
  //   y solo se canta "¡Flor!" si toca pisar un Envido rival.
  // - Con Flor común: si puede declarar A Ley, a veces (35%) la guarda para sorprender.
  if (legal.canCallFlor) {
    const myFlor = evaluateFlor(fullHand, vira);
    if (myFlor.isReservada && state.phase === "PLAYING") {
      // Flor Reservada: se reserva en silencio hasta el final de la mano
    } else if (legal.canCallALey && state.trickIndex === 0 && rng() < 0.35) {
      return { type: "CALL_A_LEY" };
    } else if (
      state.ley.hiddenFlorPlayers.includes(actor) &&
      state.trickIndex === 0 &&
      state.phase === "PLAYING"
    ) {
      // Continúa a jugar su 1.ª carta manteniendo la Flor guardada
    } else {
      return { type: "CALL_FLOR" };
    }
  }

  // 1c) Engaño ocasional ("paquete"): bot sin Flor que no es Pie canta "¡A Ley!" (~10%)
  if (legal.canCallALey && !legal.canCallFlor && rng() < 0.1) {
    return { type: "CALL_A_LEY" };
  }

  // 2) Responder a Flor
  if (state.phase === "AWAITING_FLOR" && legal.florResponses.length > 0) {
    const flor = evaluateFlor(fullHand, vira);
    if (legal.florResponses.includes("contraflor")) {
      if (flor.isReservada || flor.points >= 36) {
        return { type: "RESPOND_FLOR", choice: "contraflor_resto" };
      }
      if (flor.points >= 30 || rng() < 0.25) {
        return { type: "RESPOND_FLOR", choice: "contraflor" };
      }
      return { type: "RESPOND_FLOR", choice: "achico" };
    }

    if (flor.isReservada || flor.points >= 34) {
      if (
        legal.florResponses.includes("contraflor_resto") &&
        (flor.isReservada || flor.points >= 38)
      ) {
        return { type: "RESPOND_FLOR", choice: "contraflor_resto" };
      }
      return { type: "RESPOND_FLOR", choice: "quiero" };
    }
    if (flor.points >= 29 && state.flor.stage === "contraflor") {
      return { type: "RESPOND_FLOR", choice: "quiero" };
    }
    return { type: "RESPOND_FLOR", choice: "no_quiero" };
  }

  // 3) Responder a Envido
  if (state.phase === "AWAITING_ENVIDO" && legal.canRespondEnvido) {
    // Evaluar mejor envido del equipo del bot
    const teamMembers = state.seats.filter((p) => getPlayerTeam(p) === myTeam);
    const pts = Math.max(
      ...teamMembers.map((m) => calculateEnvidoPoints(state.initialHands[m] ?? [], vira)),
    );
    const chain = state.envido.chain;
    const isFalta = chain[chain.length - 1] === "falta_envido";
    const isReal = chain[chain.length - 1] === "real_envido";

    if (pts >= 34 && legal.envidoCalls.includes("falta_envido") && rng() < 0.65) {
      return { type: "CALL_ENVIDO", call: "falta_envido" };
    }
    if (pts >= 31 && legal.envidoCalls.includes("envido") && rng() < 0.6) {
      return { type: "CALL_ENVIDO", call: "envido" };
    }
    if (pts >= 32 && legal.envidoCalls.includes("real_envido") && rng() < 0.45) {
      return { type: "CALL_ENVIDO", call: "real_envido" };
    }

    const threshold = isFalta ? 31 : isReal ? 29 : chain.length >= 2 ? 29 : 26;
    const manoBonus = getPlayerTeam(state.mano) === myTeam ? -1 : 0;
    const accept = pts >= threshold + manoBonus || (pts >= 24 && !isFalta && rng() < 0.18);
    return { type: "RESPOND_ENVIDO", accept };
  }

  // 4) Responder a Truco / Retruco / Vale Nueve / Vale Juego
  if (state.phase === "AWAITING_TRUCO" && legal.canRespondTruco) {
    if (legal.envidoCalls.length > 0) {
      const teamMembers = state.seats.filter((p) => getPlayerTeam(p) === myTeam);
      const envPts = Math.max(
        ...teamMembers.map((m) => calculateEnvidoPoints(state.initialHands[m] ?? [], vira)),
      );
      if (envPts >= 29) {
        return {
          type: "CALL_ENVIDO",
          call: envPts >= 34 && rng() < 0.4 ? "falta_envido" : "envido",
        };
      }
    }

    const strength = estimateTrucoHandStrength(state, actor, hand, vira);
    const pending = state.truco.pendingLevel ?? 1;

    if (legal.canCallTruco) {
      const raiseThreshold = pending === 1 ? 0.78 : pending === 2 ? 0.86 : 0.93;
      if (strength >= raiseThreshold || (pending === 1 && strength >= 0.62 && rng() < 0.15)) {
        return { type: "CALL_TRUCO" };
      }
    }

    const acceptThreshold =
      pending === 1 ? 0.44 : pending === 2 ? 0.56 : pending === 3 ? 0.68 : 0.78;
    const bluffAccept = pending <= 2 && rng() < 0.12;
    return { type: "RESPOND_TRUCO", accept: strength >= acceptThreshold || bluffAccept };
  }

  // 5) Fase PLAYING (turno del bot)
  if (state.phase === "PLAYING" && state.turn === actor) {
    const hasActiveTrickDirective =
      actor === "partner" &&
      partnerHint?.trickDirective?.trickIndex === state.trickIndex;

    // ¿Cantar Envido en primera baza?
    if (legal.envidoCalls.length > 0 && !hasActiveTrickDirective) {
      const envPts = calculateEnvidoPoints(fullHand, vira);
      const hintClaim = actor === "partner" ? partnerHint?.playerEnvidoClaim : undefined;
      if (envPts >= 34 && rng() < 0.45) {
        return { type: "CALL_ENVIDO", call: "real_envido" };
      }
      if (hintClaim === "high") {
        return { type: "CALL_ENVIDO", call: "envido" };
      }
      if (
        envPts >= 28 ||
        (hintClaim !== "low" && envPts >= 25 && state.mano === actor && rng() < 0.45)
      ) {
        return { type: "CALL_ENVIDO", call: "envido" };
      }
    }

    // ¿Cantar Truco / Retruco / Vale Nueve / Vale Juego?
    if (legal.canCallTruco && !hasActiveTrickDirective) {
      const strength = estimateTrucoHandStrength(state, actor, hand, vira);
      const nextLvl = legal.nextTrucoLevel ?? 1;
      const callThreshold =
        nextLvl === 1 ? 0.7 : nextLvl === 2 ? 0.8 : nextLvl === 3 ? 0.88 : 0.94;
      const bluffChance = nextLvl === 1 && state.trickIndex >= 1 ? 0.11 : 0.04;

      if (strength >= callThreshold || rng() < bluffChance) {
        return { type: "CALL_TRUCO" };
      }
    }

    // En 1v1, irse al mazo si la 3.ª baza está perdida sin remedio
    const currentTrick = state.tricks[state.trickIndex];
    if (
      state.config.mode === "1v1" &&
      state.trickIndex === 2 &&
      currentTrick.played.player &&
      !currentTrick.played.player.burned &&
      hand.length === 1
    ) {
      const playerPower = getCardTrucoPower(currentTrick.played.player.card, vira);
      const botPower = getCardTrucoPower(hand[0], vira);
      if (botPower < playerPower && state.truco.level === 0 && rng() < 0.35) {
        return { type: "IRSE_AL_MAZO" };
      }
    }

    if (hand.length === 0) return null;
    const chosen = chooseCardToPlay(state, actor, hand, vira, partnerHint);
    return { type: "PLAY_CARD", cardId: chosen.id, burned: false };
  }

  return null;
}

/** Compatibilidad directa para 1v1 */
export function decideCpuAction(
  engine: TrucoEngine,
  rng: () => number = Math.random,
): PlayerAction | null {
  return decideBotAction(engine, "cpu", rng);
}

function getTrickPowersByTeam(
  state: ReturnType<TrucoEngine["getState"]>,
  actor: PlayerId,
  vira: Card,
): { myTeamBest: number; oppTeamBest: number; oppRemaining: number } {
  const myTeam = getPlayerTeam(actor);
  const trick = state.tricks[state.trickIndex];
  let myTeamBest = -1;
  let oppTeamBest = -1;
  let oppRemaining = 0;

  for (const seat of state.seats) {
    const entry = trick?.played[seat];
    const team = getPlayerTeam(seat);
    if (!entry) {
      if (team !== myTeam) oppRemaining++;
      continue;
    }
    const power = entry.burned ? 0 : getCardTrucoPower(entry.card, vira);
    if (team === myTeam) {
      myTeamBest = Math.max(myTeamBest, power);
    } else {
      oppTeamBest = Math.max(oppTeamBest, power);
    }
  }

  return { myTeamBest, oppTeamBest, oppRemaining };
}

function estimateTrucoHandStrength(
  state: ReturnType<TrucoEngine["getState"]>,
  actor: PlayerId,
  remainingHand: Card[],
  vira: Card,
): number {
  const myTeam = getPlayerTeam(actor);
  const powers = remainingHand.map((c) => getCardTrucoPower(c, vira));
  const avg = powers.length > 0 ? powers.reduce((a, b) => a + b, 0) / (powers.length * 16) : 0;
  const max = powers.length > 0 ? Math.max(...powers) / 16 : 0;

  const t0 = state.tricks[0];
  let momentum = 0;
  if (t0?.winnerTeam === myTeam) momentum += 0.22;
  else if (t0?.winnerTeam && t0.winnerTeam !== "parda") momentum -= 0.16;
  else if (t0?.winnerTeam === "parda") momentum += 0.04;

  const { myTeamBest, oppTeamBest } = getTrickPowersByTeam(state, actor, vira);
  if (myTeamBest > oppTeamBest && myTeamBest > 0) {
    momentum += 0.16;
  } else if (oppTeamBest > 0 && remainingHand.length > 0) {
    const canBeat = powers.some((p) => p > oppTeamBest);
    const canTie = powers.some((p) => p === oppTeamBest);
    if (canBeat) momentum += 0.14;
    else if (canTie && t0?.winnerTeam === myTeam) momentum += 0.12;
    else momentum -= 0.18;
  }

  return Math.max(0, Math.min(1, avg * 0.45 + max * 0.55 + momentum));
}

function chooseCardToPlay(
  state: ReturnType<TrucoEngine["getState"]>,
  actor: PlayerId,
  hand: Card[],
  vira: Card,
  partnerHint?: PartnerTacticalHint,
): Card {
  const sorted = [...hand].sort(
    (a, b) => getCardTrucoPower(a, vira) - getCardTrucoPower(b, vira),
  );
  if (sorted.length === 1) return sorted[0];

  const myTeam = getPlayerTeam(actor);
  const t0 = state.tricks[0];
  const { myTeamBest, oppTeamBest, oppRemaining } = getTrickPowersByTeam(state, actor, vira);

  // Respetar orden táctica directa del jugador humano para la baza actual
  if (actor === "partner" && partnerHint?.trickDirective?.trickIndex === state.trickIndex) {
    if (partnerHint.trickDirective.mode === "low") {
      return sorted[0];
    }
    if (partnerHint.trickDirective.mode === "win") {
      const strongest = sorted[sorted.length - 1];
      if (oppTeamBest < 0 || getCardTrucoPower(strongest, vira) > oppTeamBest) {
        return strongest;
      }
      return sorted[0];
    }
  }

  // En 2v2: si mi compañero ya está ganando la baza cómodamente (o ya no quedan rivales por tirar),
  // jugar la carta más baja para no malgastar matas ("ir por debajo")
  if (myTeamBest > oppTeamBest && (oppRemaining === 0 || myTeamBest >= 12)) {
    return sorted[0];
  }

  // Si hay carta rival que superar en esta baza:
  if (oppTeamBest >= 0) {
    // Buscar la carta más baja que supere al rival ("matar justo")
    const winningCard = sorted.find((c) => getCardTrucoPower(c, vira) > oppTeamBest);
    if (winningCard) return winningCard;

    // Si ganamos la 1.ª baza, empatar la 2.ª nos da la mano
    if (state.trickIndex === 1 && t0?.winnerTeam === myTeam) {
      const tyingCard = sorted.find((c) => getCardTrucoPower(c, vira) === oppTeamBest);
      if (tyingCard) return tyingCard;
    }

    // No puede superar: sacrificar la carta más baja
    return sorted[0];
  }

  // Salida libre:
  if (state.trickIndex === 0) {
    if (sorted.length === 3) {
      const midPower = getCardTrucoPower(sorted[1], vira);
      return midPower >= 9 ? sorted[1] : sorted[2];
    }
    return sorted[sorted.length - 1];
  }

  if (state.trickIndex === 1 && t0?.winnerTeam === "parda") {
    return sorted[sorted.length - 1];
  }

  return sorted[sorted.length - 1];
}
