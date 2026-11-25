import {
  calculateEnvidoPoints,
  evaluateFlor,
  getCardTrucoPower,
  isPerica,
  isPerico,
} from "./evaluator.ts";
import { Card, GameState, getPlayerTeam, TRUCO_LEVEL_NAMES } from "./types.ts";

export type PartnerQueryType = "envido" | "senas" | "truco";

export type PartnerCommandType = "tengo_envido" | "mata_tu" | "tira_baja";

export type PartnerAdviceTone = "strong" | "medium" | "weak" | "flor" | "info";

export interface PartnerMessage {
  /** Mensaje corto para la nota de pareja sobre la mesa (sin emojis, lectura instantánea) */
  headline: string;
  /** Detalle adicional para el panel de comunicación */
  detail: string;
  tone: PartnerAdviceTone;
}

export interface PartnerTacticalHint {
  /** Orden puntual del jugador para la baza actual ("win" = matar/alta, "low" = ir por debajo) */
  trickDirective?: { trickIndex: number; mode: "win" | "low" };
  /** Aviso del jugador sobre su propio envido en esta mano */
  playerEnvidoClaim?: "high" | "low";
}

/**
 * Recopila todas las señas venezolanas relevantes que todavía tiene el compañero en mano.
 */
export function getAllPartnerSenas(hand: Card[], vira: Card, withFlor: boolean): string[] {
  const senas: string[] = [];
  if (withFlor) {
    const flor = evaluateFlor(hand, vira);
    if (flor.isReservada) senas.push("Perico y Perica");
    else if (flor.hasFlor) senas.push(`Flor (${flor.points})`);
  }
  if (hand.some((c) => isPerico(c, vira)) && !senas.includes("Perico y Perica")) {
    senas.push("Perico");
  }
  if (hand.some((c) => isPerica(c, vira)) && !senas.includes("Perico y Perica")) {
    senas.push("Perica");
  }
  if (hand.some((c) => c.rank === 1 && c.suit === "espadas")) senas.push("Espadilla");
  if (hand.some((c) => c.rank === 1 && c.suit === "bastos")) senas.push("Bastillo");
  if (hand.some((c) => c.rank === 7 && c.suit === "espadas")) senas.push("7 Espadas");
  if (hand.some((c) => c.rank === 7 && c.suit === "oros")) senas.push("7 Oros");
  if (hand.some((c) => c.rank === 3)) senas.push("Tres");
  if (hand.some((c) => c.rank === 2)) senas.push("Dos");

  if (senas.length === 0) {
    if (hand.length === 0) return ["Sin cartas"];
    const maxPow = Math.max(...hand.map((c) => getCardTrucoPower(c, vira)));
    return [maxPow <= 5 ? "Ciego (bajas)" : "Cartas medias"];
  }
  return senas;
}

/**
 * Consejo directo del compañero sobre el Envido (para decidir Quiero, subir o No quiero).
 */
export function buildPartnerEnvidoAdvice(state: GameState): PartnerMessage {
  const partnerInitial = state.initialHands.partner ?? [];
  const playerInitial = state.initialHands.player ?? [];
  const vira = state.vira;

  if (state.config.withFlor && !state.flor.resolved) {
    const pFlor = evaluateFlor(partnerInitial, vira);
    const partnerPlayedTrick0 = Boolean(state.tricks[0]?.played.partner);
    const partnerHasHiddenALey = state.ley.hiddenFlorPlayers.includes("partner");
    if (pFlor.hasFlor && !state.ley.forfeitedBy.includes("partner") && (!partnerPlayedTrick0 || partnerHasHiddenALey || pFlor.isReservada)) {
      if (pFlor.isReservada) {
        return {
          headline: "Perico y Perica · La reservo al final",
          detail: "Tu compañero lleva Flor Reservada: no hace falta cantarla, suma +5 al final.",
          tone: "flor",
        };
      }
      return {
        headline: `Tengo Flor (${pFlor.points}) · Yo la canto`,
        detail: `Tu compañero tiene Flor de ${pFlor.points} pts y la cantará él mismo.`,
        tone: "flor",
      };
    }
  }

  const pts = calculateEnvidoPoints(partnerInitial, vira);
  const playerPts = calculateEnvidoPoints(playerInitial, vira);
  const teamBest = Math.max(pts, playerPts);
  const isOurMano = getPlayerTeam(state.mano) === "nosotros";
  const manoTag = isOurMano ? " (somos Mano)" : "";

  const chain = state.envido.chain;
  const lastCall = chain[chain.length - 1];
  const isFalta = lastCall === "falta_envido";
  const isRaisedEnvido = lastCall === "envido_cinco" || lastCall === "real_envido" || chain.length >= 2;
  const awaitingEnvido = state.phase === "AWAITING_ENVIDO";

  if (state.envido.resolved && !awaitingEnvido) {
    return {
      headline: state.envido.accepted
        ? `Envido pactado · Tengo ${pts}`
        : `Envido cerrado · Tenía ${pts}`,
      detail: `Tu compañero tenía ${pts} de envido en esta mano.`,
      tone: "info",
    };
  }

  if (isFalta) {
    if (pts >= 33) {
      return {
        headline: `Tengo ${pts} · Quiero la Falta`,
        detail: `Tu compañero tiene ${pts} de envido${manoTag}. Mejor del equipo: ${teamBest}.`,
        tone: "strong",
      };
    }
    if (pts >= 30) {
      return {
        headline: `Tengo ${pts}${isOurMano ? " (Mano)" : ""} · Se puede querer`,
        detail: `Tu compañero tiene ${pts}${manoTag}. Competitivo para envidar la falta.`,
        tone: "strong",
      };
    }
    if (pts >= 27) {
      return {
        headline: `Tengo ${pts} · Justo para Falta`,
        detail: `Tu compañero tiene ${pts}${manoTag}. Si no pasas de 30, evalúa No quiero.`,
        tone: "medium",
      };
    }
    if (pts >= 20) {
      return {
        headline: `Solo ${pts} · Mejor No quiero`,
        detail: `Tu compañero solo tiene ${pts}. Ante Falta conviene achicarse salvo que tengas más.`,
        tone: "weak",
      };
    }
    return {
      headline: `No ligo (${pts}) · Mejor No quiero`,
      detail: `Tu compañero no liga envido (${pts} pts). Queda en tu mano (${playerPts} pts).`,
      tone: "weak",
    };
  }

  if (isRaisedEnvido) {
    if (pts >= 33) {
      return {
        headline: `Tengo ${pts} · Quiere o sube`,
        detail: `Tu compañero tiene ${pts} de envido${manoTag}. Puedes querer o subir.`,
        tone: "strong",
      };
    }
    if (pts >= 29) {
      return {
        headline: `Tengo ${pts}${isOurMano ? " (Mano)" : ""} · Dale Quiero`,
        detail: `Tu compañero tiene ${pts}${manoTag}. Muy bueno para aceptar.`,
        tone: "strong",
      };
    }
    if (pts >= 26) {
      return {
        headline: `Tengo ${pts} · Está peleado`,
        detail: `Tu compañero tiene ${pts}${manoTag}. Si llevas más, dale; si no, es arriesgado.`,
        tone: "medium",
      };
    }
    if (pts >= 20) {
      return {
        headline: `Solo ${pts} · Mejor No quiero`,
        detail: `Tu compañero tiene ${pts}. Solo conviene querer si llevas mejor puntaje.`,
        tone: "weak",
      };
    }
    return {
      headline: `No ligo (${pts}) · Queda en ti`,
      detail: `Tu compañero no liga (${pts} pts). Decide con tus ${playerPts} pts.`,
      tone: "weak",
    };
  }

  if (pts >= 33) {
    return {
      headline: awaitingEnvido
        ? `Tengo ${pts} · Quiere o sube`
        : `Tengo ${pts} de envido · Puedes envidar`,
      detail: `Tu compañero lleva ${pts} de envido${manoTag}. Excelente para querer o envidar.`,
      tone: "strong",
    };
  }
  if (pts >= 29) {
    return {
      headline: awaitingEnvido
        ? `Tengo ${pts} · Dale Quiero`
        : `Tengo ${pts} de envido · Puedes envidar`,
      detail: `Tu compañero tiene ${pts}${manoTag}. Puntaje sólido para aceptar o abrir envido.`,
      tone: "strong",
    };
  }
  if (pts >= 26) {
    return {
      headline: `Tengo ${pts}${isOurMano ? " (Mano)" : ""} · Se puede querer`,
      detail: `Tu compañero tiene ${pts}${manoTag}. Aceptable para un Envido simple.`,
      tone: "medium",
    };
  }
  if (pts >= 20) {
    return {
      headline: `Solo ${pts} · Si no tienes más, no`,
      detail: `Tu compañero tiene ${pts}. Conviene No quiero a menos que tengas mejor envido.`,
      tone: "weak",
    };
  }
  return {
    headline: `No ligo (${pts}) · Queda en ti`,
    detail: `Tu compañero no liga envido (${pts} pts). Decide con tu envido (${playerPts} pts).`,
    tone: "weak",
  };
}

/**
 * Señas venezolanas detalladas de las cartas que aún conserva el compañero.
 */
export function buildPartnerSenasAdvice(state: GameState): PartnerMessage {
  const remaining = state.hands.partner ?? [];
  const senas = getAllPartnerSenas(
    remaining,
    state.vira,
    state.config.withFlor && state.trickIndex === 0,
  );
  const envPts = calculateEnvidoPoints(state.initialHands.partner ?? [], state.vira);
  const envPart =
    state.trickIndex === 0 && !state.envido.resolved ? ` · Envido ${envPts}` : "";

  const topPower =
    remaining.length > 0
      ? Math.max(...remaining.map((c) => getCardTrucoPower(c, state.vira)))
      : 0;
  const tone: PartnerAdviceTone =
    senas.some((s) => s.includes("Flor") || s.includes("Perico y Perica"))
      ? "flor"
      : topPower >= 13
        ? "strong"
        : topPower >= 9
          ? "medium"
          : "weak";

  const shortSenas = senas.slice(0, 2).join(" · ");
  return {
    headline: `Señas: ${shortSenas}${envPart}`,
    detail: `En mano (${remaining.length}): ${senas.join(", ")}.${envPart ? ` Envido: ${envPts} pts.` : ""}`,
    tone,
  };
}

/**
 * Consejo del compañero sobre Truco / Retruco / Vale Nueve / Vale Juego.
 */
export function buildPartnerTrucoAdvice(state: GameState): PartnerMessage {
  const remaining = state.hands.partner ?? [];
  const vira = state.vira;
  const powers = remaining.map((c) => getCardTrucoPower(c, vira));
  const maxPow = powers.length > 0 ? Math.max(...powers) : 0;
  const avgPow = powers.length > 0 ? powers.reduce((a, b) => a + b, 0) / powers.length : 0;
  const senas = getAllPartnerSenas(remaining, vira, false);
  const senaPrefix =
    senas[0] &&
    !senas[0].includes("Ciego") &&
    !senas[0].includes("medias") &&
    !senas[0].includes("Sin cartas")
      ? `${senas[0]} · `
      : "";

  const t0 = state.tricks[0];
  let score = (maxPow / 16) * 0.6 + (avgPow / 16) * 0.4;
  if (t0?.winnerTeam === "nosotros") score += 0.2;
  else if (t0?.winnerTeam === "ellos") score -= 0.15;

  const awaitingTruco = state.phase === "AWAITING_TRUCO";
  const pendingLvl = state.truco.pendingLevel ?? 1;
  const pendingName = TRUCO_LEVEL_NAMES[pendingLvl];

  if (score >= 0.78) {
    return {
      headline: awaitingTruco
        ? `${senaPrefix}Quiero o sube`
        : `${senaPrefix}Fuerte para cantar Truco`,
      detail: `Tu compañero lleva mano fuerte (${senas.join(", ")}) para pelear el ${pendingName}.`,
      tone: "strong",
    };
  }
  if (score >= 0.5) {
    return {
      headline: awaitingTruco
        ? `${senaPrefix}Mano media · Si ayudas, quiero`
        : `${senaPrefix}Mano media · Si tienes alta, dale`,
      detail: `Tu compañero lleva mano intermedia (${senas.join(", ")}).`,
      tone: "medium",
    };
  }
  return {
    headline: awaitingTruco
      ? `Voy flojo (${senas[0]}) · Mejor No quiero`
      : `Voy flojo (${senas[0]}) · Mejor aguantar`,
    detail: `Tu compañero no tiene matas fuertes (${senas.join(", ")}).`,
    tone: "weak",
  };
}

/**
 * Consejo automático del compañero cuando toca responder a Flor / Contraflor.
 */
export function buildPartnerFlorAdvice(state: GameState): PartnerMessage {
  const partnerHand = state.initialHands.partner ?? [];
  const playerHand = state.initialHands.player ?? [];
  const pFlor = evaluateFlor(partnerHand, state.vira);
  const myFlor = evaluateFlor(playerHand, state.vira);

  if (pFlor.hasFlor) {
    if (pFlor.isReservada) {
      return {
        headline: "Perico y Perica · Con flor envido la falta",
        detail: "Tu compañero lleva Flor Reservada: imbatible, dale Con flor envido la falta.",
        tone: "flor",
      };
    }
    if (pFlor.points >= 34) {
      return {
        headline: `Tengo Flor de ${pFlor.points} · Con flor envido`,
        detail: `Tu compañero lleva una Flor muy alta (${pFlor.points} pts).`,
        tone: "flor",
      };
    }
    if (pFlor.points >= 29) {
      return {
        headline: `Tengo Flor de ${pFlor.points} · Se puede pelear`,
        detail: `Tu compañero tiene Flor de ${pFlor.points} pts.`,
        tone: "medium",
      };
    }
    return {
      headline: `Mi Flor es baja (${pFlor.points}) · Evalúa achicarte`,
      detail: `Tu compañero tiene Flor de ${pFlor.points} pts (baja para envidar con flor).`,
      tone: "weak",
    };
  }

  return {
    headline: myFlor.hasFlor
      ? `Tu Flor (${myFlor.points}) manda · Decide tú`
      : "No tengo Flor · Decide tú",
    detail: "Tu compañero no tiene Flor en esta mano.",
    tone: "info",
  };
}

/**
 * Dispara automáticamente la recomendación pertinente del compañero
 * cuando al jugador humano le toca responder un canto rival en 2 vs 2.
 */
export function buildAutoPartnerCallout(state: GameState): PartnerMessage | null {
  if (state.config.mode !== "2v2") return null;
  if (state.phase === "AWAITING_ENVIDO" && state.envido.responder === "player") {
    return buildPartnerEnvidoAdvice(state);
  }
  if (state.phase === "AWAITING_TRUCO" && state.truco.responder === "player") {
    return buildPartnerTrucoAdvice(state);
  }
  if (state.phase === "AWAITING_FLOR" && state.flor.responder === "player") {
    return buildPartnerFlorAdvice(state);
  }
  return null;
}

/**
 * Procesa una consulta directa del jugador hacia el compañero.
 */
export function answerPartnerQuery(state: GameState, query: PartnerQueryType): PartnerMessage {
  switch (query) {
    case "envido":
      return buildPartnerEnvidoAdvice(state);
    case "senas":
      return buildPartnerSenasAdvice(state);
    case "truco":
      return buildPartnerTrucoAdvice(state);
  }
}

/**
 * Procesa una señal / orden táctica enviada por el jugador al compañero.
 */
export function handlePartnerCommand(
  state: GameState,
  command: PartnerCommandType,
): { message: PartnerMessage; hintUpdate: Partial<PartnerTacticalHint> } {
  if (command === "tengo_envido") {
    const pPts = calculateEnvidoPoints(state.initialHands.player ?? [], state.vira);
    if (pPts >= 28) {
      return {
        message: {
          headline: `Copiado (${pPts}) · Te respaldo en el envido`,
          detail: `Avisaste envido alto (${pPts} pts). Tu compañero te apoyará.`,
          tone: "strong",
        },
        hintUpdate: { playerEnvidoClaim: "high" },
      };
    }
    return {
      message: {
        headline: "Entendido · No me tiro solo al envido",
        detail: `Avisaste envido bajo (${pPts} pts). Tu compañero jugará cauto.`,
        tone: "info",
      },
      hintUpdate: { playerEnvidoClaim: "low" },
    };
  }

  if (command === "mata_tu") {
    const rem = state.hands.partner ?? [];
    const maxPow =
      rem.length > 0 ? Math.max(...rem.map((c) => getCardTrucoPower(c, state.vira))) : 0;
    const ok = maxPow >= 9;
    return {
      message: {
        headline: ok
          ? "Copiado · Voy con mi mejor carta"
          : "Copiado · Tiro lo más alto que tengo",
        detail: `Tu compañero intentará ganar la baza ${state.trickIndex + 1} con su carta más fuerte.`,
        tone: ok ? "strong" : "medium",
      },
      hintUpdate: { trickDirective: { trickIndex: state.trickIndex, mode: "win" } },
    };
  }

  return {
    message: {
      headline: "Copiado · Me voy por debajo en esta baza",
      detail: `Tu compañero guardará sus matas y tirará su carta más baja en la baza ${state.trickIndex + 1}.`,
      tone: "info",
    },
    hintUpdate: { trickDirective: { trickIndex: state.trickIndex, mode: "low" } },
  };
}
