import {
  Card,
  GameConfig,
  getPlayerTeam,
  PlayedCard,
  PlayerId,
  Rank,
  Suit,
  SUIT_NAMES,
  TeamId,
  TrickWinner,
  TrucoLevel,
} from "./types.ts";

export interface PieceSpec {
  suit: Suit;
  rank: Rank;
}

/**
 * Perico = Caballo (11) del palo de la Vira.
 * Si la Vira es el 11, el Rey (12) del mismo palo pasa a ser el Perico.
 */
export function getPericoSpec(vira: Card): PieceSpec {
  return {
    suit: vira.suit,
    rank: vira.rank === 11 ? 12 : 11,
  };
}

/**
 * Perica = Sota (10) del palo de la Vira.
 * Si la Vira es el 10, el Rey (12) del mismo palo pasa a ser la Perica.
 */
export function getPericaSpec(vira: Card): PieceSpec {
  return {
    suit: vira.suit,
    rank: vira.rank === 10 ? 12 : 10,
  };
}

export function isPerico(card: Card, vira: Card): boolean {
  const spec = getPericoSpec(vira);
  return card.suit === spec.suit && card.rank === spec.rank;
}

export function isPerica(card: Card, vira: Card): boolean {
  const spec = getPericaSpec(vira);
  return card.suit === spec.suit && card.rank === spec.rank;
}

export function isPiece(card: Card, vira: Card): boolean {
  return isPerico(card, vira) || isPerica(card, vira);
}

/**
 * Fuerza de la carta en el lance de Truco Venezolano (16 = máxima, 1 = mínima).
 * Cartas con el mismo valor empatan (baza parda).
 */
export function getCardTrucoPower(card: Card, vira: Card): number {
  if (isPerico(card, vira)) return 16;
  if (isPerica(card, vira)) return 15;
  if (card.rank === 1 && card.suit === "espadas") return 14; // Espadilla
  if (card.rank === 1 && card.suit === "bastos") return 13; // Bastillo
  if (card.rank === 7 && card.suit === "espadas") return 12;
  if (card.rank === 7 && card.suit === "oros") return 11;
  if (card.rank === 3) return 10;
  if (card.rank === 2) return 9;
  if (card.rank === 1) return 8; // Ases falsos (copas y oros)
  if (card.rank === 12) return 7;
  if (card.rank === 11) return 6;
  if (card.rank === 10) return 5;
  if (card.rank === 7) return 4; // 7 de copas y 7 de bastos
  if (card.rank === 6) return 3;
  if (card.rank === 5) return 2;
  return 1; // 4
}

export function getCardName(card: Card, vira?: Card): string {
  if (vira && isPerico(card, vira)) {
    return `Perico (${card.rank} de ${SUIT_NAMES[card.suit]})`;
  }
  if (vira && isPerica(card, vira)) {
    return `Perica (${card.rank} de ${SUIT_NAMES[card.suit]})`;
  }
  if (card.rank === 1 && card.suit === "espadas") return "Espadilla (1 de Espadas)";
  if (card.rank === 1 && card.suit === "bastos") return "Bastillo (1 de Bastos)";
  const rankLabel =
    card.rank === 1
      ? "As"
      : card.rank === 10
        ? "Sota"
        : card.rank === 11
          ? "Caballo"
          : card.rank === 12
            ? "Rey"
            : String(card.rank);
  return `${rankLabel} de ${SUIT_NAMES[card.suit]}`;
}

/** Valor numérico de una carta normal (no pieza) para Envido y Flor */
export function getCardPointValue(card: Card): number {
  return card.rank >= 10 ? 0 : card.rank;
}

export function isFlorReservada(hand: Card[], vira: Card): boolean {
  const hasP = hand.some((c) => isPerico(c, vira));
  const hasPa = hand.some((c) => isPerica(c, vira));
  return hasP && hasPa;
}

export function hasFlor(hand: Card[], vira: Card): boolean {
  if (hand.length < 3) return false;
  if (isFlorReservada(hand, vira)) return true;

  const pieces = hand.filter((c) => isPiece(c, vira));
  const regulars = hand.filter((c) => !isPiece(c, vira));

  // 1 pieza + 2 cartas del mismo palo
  if (pieces.length === 1 && regulars.length === 2) {
    return regulars[0].suit === regulars[1].suit;
  }

  // 3 cartas del mismo palo sin piezas
  if (pieces.length === 0) {
    return hand[0].suit === hand[1].suit && hand[1].suit === hand[2].suit;
  }

  return false;
}

export interface FlorEvaluation {
  hasFlor: boolean;
  isReservada: boolean;
  points: number;
}

export function evaluateFlor(hand: Card[], vira: Card): FlorEvaluation {
  if (!hasFlor(hand, vira)) {
    return { hasFlor: false, isReservada: false, points: 0 };
  }

  if (isFlorReservada(hand, vira)) {
    const third = hand.find((c) => !isPiece(c, vira));
    const bonus = third ? getCardPointValue(third) : 0;
    return { hasFlor: true, isReservada: true, points: 59 + bonus };
  }

  const perico = hand.find((c) => isPerico(c, vira));
  const perica = hand.find((c) => isPerica(c, vira));
  const regulars = hand.filter((c) => !isPiece(c, vira));

  if (perico) {
    const sum = regulars.reduce((acc, c) => acc + getCardPointValue(c), 0);
    return { hasFlor: true, isReservada: false, points: 30 + sum };
  }

  if (perica) {
    const sum = regulars.reduce((acc, c) => acc + getCardPointValue(c), 0);
    return { hasFlor: true, isReservada: false, points: 29 + sum };
  }

  const sum = hand.reduce((acc, c) => acc + getCardPointValue(c), 0);
  return { hasFlor: true, isReservada: false, points: 20 + sum };
}

/**
 * Calcula el puntaje exacto de Envido en Truco Venezolano:
 * - Perico = 30 (comodín de palo)
 * - Perica = 29 (comodín de palo)
 * - Dos cartas del mismo palo = 20 + valor(c1) + valor(c2)
 * - Tres palos distintos sin piezas = valor máximo individual (0..7)
 */
export function calculateEnvidoPoints(hand: Card[], vira: Card): number {
  const perico = hand.find((c) => isPerico(c, vira));
  const perica = hand.find((c) => isPerica(c, vira));

  if (perico && perica) {
    const third = hand.find((c) => !isPiece(c, vira));
    return 30 + (third ? getCardPointValue(third) : 0);
  }

  if (perico) {
    const others = hand.filter((c) => c.id !== perico.id);
    const bestOther = Math.max(...others.map(getCardPointValue));
    return 30 + bestOther;
  }

  if (perica) {
    const others = hand.filter((c) => c.id !== perica.id);
    const bestOther = Math.max(...others.map(getCardPointValue));
    return 29 + bestOther;
  }

  let best = 0;
  for (let i = 0; i < hand.length; i++) {
    best = Math.max(best, getCardPointValue(hand[i]));
    for (let j = i + 1; j < hand.length; j++) {
      if (hand[i].suit === hand[j].suit) {
        const pairScore = 20 + getCardPointValue(hand[i]) + getCardPointValue(hand[j]);
        best = Math.max(best, pairScore);
      }
    }
  }
  return best;
}

/**
 * Devuelve las cartas exactas (1 o 2) que componen el puntaje de Envido para presentarlas al final de la mano.
 */
export function getEnvidoCards(hand: Card[], vira: Card): Card[] {
  const perico = hand.find((c) => isPerico(c, vira));
  const perica = hand.find((c) => isPerica(c, vira));

  if (perico && perica) {
    const third = hand.find((c) => !isPiece(c, vira));
    return third ? [perico, third] : [perico, perica];
  }

  const piece = perico ?? perica;
  if (piece) {
    const others = hand
      .filter((c) => c.id !== piece.id)
      .sort((a, b) => getCardPointValue(b) - getCardPointValue(a));
    return others.length > 0 ? [piece, others[0]] : [piece];
  }

  let bestScore = -1;
  let bestCards: Card[] = [];

  for (let i = 0; i < hand.length; i++) {
    const v = getCardPointValue(hand[i]);
    if (v > bestScore) {
      bestScore = v;
      bestCards = [hand[i]];
    }
    for (let j = i + 1; j < hand.length; j++) {
      if (hand[i].suit === hand[j].suit) {
        const pairScore = 20 + getCardPointValue(hand[i]) + getCardPointValue(hand[j]);
        if (pairScore > bestScore) {
          bestScore = pairScore;
          bestCards = [hand[i], hand[j]];
        }
      }
    }
  }

  return bestCards;
}

/**
 * Sugiere la seña tradicional venezolana más relevante de una mano (para el Compañero en 2 vs 2).
 */
export function getPartnerSignal(hand: Card[], vira: Card, withFlor: boolean): string | null {
  if (withFlor && isFlorReservada(hand, vira)) return "Perico y Perica";
  if (withFlor && hasFlor(hand, vira)) return "Flor";
  if (hand.some((c) => isPerico(c, vira))) return "Perico";
  if (hand.some((c) => isPerica(c, vira))) return "Perica";
  if (hand.some((c) => c.rank === 1 && c.suit === "espadas")) return "Espadilla";
  if (hand.some((c) => c.rank === 1 && c.suit === "bastos")) return "Bastillo";
  if (hand.some((c) => c.rank === 7 && c.suit === "espadas")) return "7 Espadas";
  if (hand.some((c) => c.rank === 7 && c.suit === "oros")) return "7 Oros";
  if (hand.some((c) => c.rank === 3)) return "Tres";
  if (hand.some((c) => c.rank === 2)) return "Dos";
  const maxPow = Math.max(...hand.map((c) => getCardTrucoPower(c, vira)));
  if (maxPow <= 5) return "Ciego";
  return null;
}

/**
 * Resuelve el ganador de una baza para 2 o 4 jugadores.
 * Gana el equipo cuya carta más alta supere a la más alta del equipo contrario.
 */
export function resolveTrickOutcome(
  played: Partial<Record<PlayerId, PlayedCard>>,
  seats: PlayerId[],
  vira: Card,
): { winnerTeam: TrickWinner; winnerPlayer?: PlayerId } {
  let bestNosotros = -1;
  let bestNosotrosPlayer: PlayerId | undefined;
  let bestNosotrosOrder = Infinity;

  let bestEllos = -1;
  let bestEllosPlayer: PlayerId | undefined;
  let bestEllosOrder = Infinity;

  for (const seat of seats) {
    const entry = played[seat];
    if (!entry) continue;
    const power = entry.burned ? 0 : getCardTrucoPower(entry.card, vira);
    const team = getPlayerTeam(seat);
    if (team === "nosotros") {
      if (power > bestNosotros || (power === bestNosotros && entry.order < bestNosotrosOrder)) {
        bestNosotros = power;
        bestNosotrosPlayer = seat;
        bestNosotrosOrder = entry.order;
      }
    } else {
      if (power > bestEllos || (power === bestEllos && entry.order < bestEllosOrder)) {
        bestEllos = power;
        bestEllosPlayer = seat;
        bestEllosOrder = entry.order;
      }
    }
  }

  if (bestNosotros > bestEllos) {
    return { winnerTeam: "nosotros", winnerPlayer: bestNosotrosPlayer };
  }
  if (bestEllos > bestNosotros) {
    return { winnerTeam: "ellos", winnerPlayer: bestEllosPlayer };
  }
  return { winnerTeam: "parda" };
}

/**
 * Determina si la mano ya tiene equipo ganador de bazas según todas las reglas de parda.
 * Retorna null si todavía faltan bazas por jugar.
 */
export function resolveHandWinnerFromTricks(
  winners: TrickWinner[],
  manoTeam: TeamId,
): TeamId | null {
  const count = winners.length;
  if (count < 2) return null;

  const [t1, t2, t3] = winners;

  if (count === 2) {
    if (t1 !== "parda" && t1 === t2) return t1;
    if (t1 === "parda" && t2 !== "parda") return t2;
    if (t1 !== "parda" && t2 === "parda") return t1;
    return null;
  }

  if (t3 !== "parda") return t3;
  if (t1 !== "parda") return t1;
  return manoTeam;
}

export function getTrucoAcceptPoints(
  level: TrucoLevel,
  scores: Record<TeamId, number>,
  targetScore: number,
): number {
  switch (level) {
    case 0:
      return 1;
    case 1:
      return 3;
    case 2:
      return 6;
    case 3:
      return 9;
    case 4: {
      const minScore = Math.min(scores.nosotros, scores.ellos);
      return Math.max(12, targetScore - minScore);
    }
  }
}

export function getTrucoRejectPoints(pendingLevel: TrucoLevel): number {
  switch (pendingLevel) {
    case 1:
      return 1;
    case 2:
      return 3;
    case 3:
      return 6;
    case 4:
      return 9;
    default:
      return 1;
  }
}

export function calculateFaltaEnvidoPoints(
  scores: Record<TeamId, number>,
  config: GameConfig,
): number {
  const leader = Math.max(scores.nosotros, scores.ellos);
  return Math.max(1, config.targetScore - leader);
}

/** Posición relativa desde la Mano en orden de turno (0 = Mano, 1 = segundo, ..., n-1 = Pie) */
export function getSeatDistanceFromMano(
  seat: PlayerId,
  mano: PlayerId,
  seats: PlayerId[],
): number {
  const mIdx = seats.indexOf(mano);
  const sIdx = seats.indexOf(seat);
  if (mIdx === -1 || sIdx === -1) return 99;
  return (sIdx - mIdx + seats.length) % seats.length;
}
