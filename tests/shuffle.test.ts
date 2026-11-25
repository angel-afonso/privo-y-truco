import { describe, expect, it } from "bun:test";
import { createDeck, dealHandForSeats, shuffleDeck } from "../src/engine/deck.ts";
import { isPerica, isPerico } from "../src/engine/evaluator.ts";
import type { PlayerId } from "../src/engine/types.ts";

describe("Barajado y aleatoriedad de la baraja española (40 cartas)", () => {
  it("conserva exactamente las 40 cartas únicas sin duplicados ni huecos en 1v1 y 2v2", () => {
    const baseIds = new Set(createDeck().map((c) => c.id));
    expect(baseIds.size).toBe(40);

    for (let i = 0; i < 500; i++) {
      const shuffled = shuffleDeck(createDeck());
      expect(shuffled.length).toBe(40);
      expect(new Set(shuffled.map((c) => c.id)).size).toBe(40);
    }

    const modes: PlayerId[][] = [
      ["player", "cpu"],
      ["player", "cpu", "partner", "cpu2"],
    ];
    for (const seats of modes) {
      for (let i = 0; i < 300; i++) {
        const deal = dealHandForSeats(seats);
        const seen = new Set<string>([deal.vira.id]);
        for (const seat of seats) {
          const hand = deal.hands[seat] ?? [];
          expect(hand.length).toBe(3);
          for (const card of hand) {
            expect(baseIds.has(card.id)).toBe(true);
            expect(seen.has(card.id)).toBe(false);
            seen.add(card.id);
          }
        }
        expect(seen.size).toBe(seats.length * 3 + 1);
      }
    }
  });

  it("resiste valores extremos de un rng personalizado sin salirse de rango", () => {
    const deck = createDeck();
    for (const constant of [0, 0.5, 0.999999999, 1]) {
      const shuffled = shuffleDeck(deck, () => constant);
      expect(shuffled.length).toBe(40);
      expect(shuffled.every((c) => c !== undefined)).toBe(true);
      expect(new Set(shuffled.map((c) => c.id)).size).toBe(40);
    }
  });

  it("distribuye uniformemente las 40 cartas en manos, vira y piezas (prueba chi-cuadrado)", () => {
    const trials = 20_000;
    const baseDeck = createDeck();
    const idToIndex = new Map(baseDeck.map((c, idx) => [c.id, idx]));

    const viraCounts = new Int32Array(40);
    const handCounts = new Int32Array(40);
    let pericoHits = 0;
    let pericaHits = 0;

    for (let t = 0; t < trials; t++) {
      const deal = dealHandForSeats(["player", "cpu"]);
      viraCounts[idToIndex.get(deal.vira.id)!]++;

      const playerHand = deal.hands.player!;
      for (const card of playerHand) {
        handCounts[idToIndex.get(card.id)!]++;
        if (isPerico(card, deal.vira)) pericoHits++;
        if (isPerica(card, deal.vira)) pericaHits++;
      }
    }

    // Chi-cuadrado con 39 grados de libertad (esperado ≈ 39; umbral conservador < 90 equivale a p > 1e-5)
    const expectedVira = trials / 40;
    let chiVira = 0;
    for (let i = 0; i < 40; i++) {
      const diff = viraCounts[i] - expectedVira;
      chiVira += (diff * diff) / expectedVira;
    }
    expect(chiVira).toBeLessThan(90);

    const expectedHand = (trials * 3) / 40;
    let chiHand = 0;
    for (let i = 0; i < 40; i++) {
      const diff = handCounts[i] - expectedHand;
      chiHand += (diff * diff) / expectedHand;
    }
    expect(chiHand).toBeLessThan(90);

    // Probabilidad teórica exacta de recibir Perico o Perica en una mano de 3 cartas: 3/39 ≈ 7.692%
    const expectedPieceRate = 3 / 39;
    expect(Math.abs(pericoHits / trials - expectedPieceRate)).toBeLessThan(0.01);
    expect(Math.abs(pericaHits / trials - expectedPieceRate)).toBeLessThan(0.01);
  });

  it("no presenta sesgo posicional en las 40 posiciones del mazo barajado", () => {
    const trials = 12_000;
    const baseDeck = createDeck();
    const idToIndex = new Map(baseDeck.map((c, idx) => [c.id, idx]));

    // Matriz 40x40: cuántas veces cada carta cae en cada posición
    const matrix = Array.from({ length: 40 }, () => new Int32Array(40));
    for (let t = 0; t < trials; t++) {
      const shuffled = shuffleDeck(baseDeck);
      for (let pos = 0; pos < 40; pos++) {
        matrix[idToIndex.get(shuffled[pos].id)!][pos]++;
      }
    }

    // Suma de chi-cuadrado total sobre 39*39 = 1521 grados de libertad (esperado ≈ 1521, sigma ≈ 55)
    const expected = trials / 40;
    let totalChi = 0;
    for (let card = 0; card < 40; card++) {
      for (let pos = 0; pos < 40; pos++) {
        const diff = matrix[card][pos] - expected;
        totalChi += (diff * diff) / expected;
      }
    }
    expect(totalChi).toBeGreaterThan(1200);
    expect(totalChi).toBeLessThan(1900);
  });
});
