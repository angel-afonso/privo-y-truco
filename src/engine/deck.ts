import { Card, PlayerId, RANKS, SUITS } from "./types.ts";

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        id: `${rank}_${suit}`,
        suit,
        rank,
      });
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[], rng: () => number = Math.random): Card[] {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

export interface DealResult {
  hands: Partial<Record<PlayerId, Card[]>>;
  vira: Card;
}

export function dealHandForSeats(
  seats: PlayerId[],
  rng: () => number = Math.random,
): DealResult {
  const deck = shuffleDeck(createDeck(), rng);
  const hands: Partial<Record<PlayerId, Card[]>> = {};
  for (const seat of seats) {
    hands[seat] = [];
  }
  // Reparto real de 1 en 1 en ronda (3 cartas por jugador)
  let cursor = 0;
  for (let round = 0; round < 3; round++) {
    for (const seat of seats) {
      hands[seat]!.push(deck[cursor++]);
    }
  }
  const vira = deck[cursor];
  return { hands, vira };
}
