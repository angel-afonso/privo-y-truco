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

const UINT32_RANGE = 0x1_0000_0000;
const cryptoBuf = new Uint32Array(1);

/**
 * Genera un entero uniforme en [0, maxExclusive) usando CSPRNG (crypto.getRandomValues)
 * con muestreo por rechazo para eliminar por completo el sesgo de módulo.
 */
function cryptoRandomInt(maxExclusive: number): number {
  const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
  let value: number;
  do {
    globalThis.crypto.getRandomValues(cryptoBuf);
    value = cryptoBuf[0];
  } while (value >= limit);
  return value % maxExclusive;
}

function randomInt(maxExclusive: number, rng?: () => number): number {
  if (!rng && typeof globalThis.crypto?.getRandomValues === "function") {
    return cryptoRandomInt(maxExclusive);
  }
  const r = (rng ?? Math.random)();
  return Math.min(maxExclusive - 1, Math.max(0, Math.floor(r * maxExclusive)));
}

/**
 * Baraja Fisher-Yates (Durstenfeld) insesgada.
 * Por defecto usa CSPRNG del sistema (entropía suficiente para cubrir las 40! ≈ 2^159 permutaciones).
 * Acepta un `rng` determinístico opcional para pruebas reproducibles.
 */
export function shuffleDeck(deck: Card[], rng?: () => number): Card[] {
  const copy = [...deck];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, rng);
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
  rng?: () => number,
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
