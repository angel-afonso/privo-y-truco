import { describe, expect, test } from "bun:test";
import { decideBotAction, decideCpuAction } from "../src/engine/ai";
import { createDeck } from "../src/engine/deck";
import {
  calculateEnvidoPoints,
  evaluateFlor,
  getCardTrucoPower,
  getEnvidoCards,
  getPericaSpec,
  getPericoSpec,
  hasFlor,
  isFlorReservada,
  isPerica,
  isPerico,
  resolveHandWinnerFromTricks,
} from "../src/engine/evaluator";
import { TrucoEngine } from "../src/engine/gameEngine";
import {
  answerPartnerQuery,
  buildAutoPartnerCallout,
  handlePartnerCommand,
} from "../src/engine/partnerComms";
import { Card, Rank, Suit } from "../src/engine/types";
import {
  buildSafeViewerState,
  formatOnlineSummaryText,
  isHiddenCardId,
  mapSeatToViewer,
  mapViewerToCanonicalSeat,
  projectStateForViewer,
} from "../src/multiplayer/perspective";

function card(rank: Rank, suit: Suit): Card {
  return { id: `${rank}_${suit}`, rank, suit };
}

describe("Baraja Española y Vira / Piezas", () => {
  test("La baraja tiene exactamente 40 cartas sin 8 ni 9", () => {
    const deck = createDeck();
    expect(deck.length).toBe(40);
    expect(deck.some((c) => (c.rank as number) === 8 || (c.rank as number) === 9)).toBe(false);
  });

  test("Perico es 11 de la Vira y Perica es 10 de la Vira", () => {
    const vira = card(5, "oros");
    expect(getPericoSpec(vira)).toEqual({ suit: "oros", rank: 11 });
    expect(getPericaSpec(vira)).toEqual({ suit: "oros", rank: 10 });
    expect(isPerico(card(11, "oros"), vira)).toBe(true);
    expect(isPerica(card(10, "oros"), vira)).toBe(true);
  });

  test("Si la Vira es 11 (Caballo), el Rey (12) pasa a ser el Perico", () => {
    const vira = card(11, "espadas");
    expect(getPericoSpec(vira)).toEqual({ suit: "espadas", rank: 12 });
    expect(getPericaSpec(vira)).toEqual({ suit: "espadas", rank: 10 });
    expect(isPerico(card(12, "espadas"), vira)).toBe(true);
  });

  test("Si la Vira es 10 (Sota), el Rey (12) pasa a ser la Perica", () => {
    const vira = card(10, "copas");
    expect(getPericoSpec(vira)).toEqual({ suit: "copas", rank: 11 });
    expect(getPericaSpec(vira)).toEqual({ suit: "copas", rank: 12 });
    expect(isPerica(card(12, "copas"), vira)).toBe(true);
  });

  test("Jerarquía oficial del Truco Venezolano", () => {
    const vira = card(4, "copas");
    const ordered: Card[] = [
      card(11, "copas"),
      card(10, "copas"),
      card(1, "espadas"),
      card(1, "bastos"),
      card(7, "espadas"),
      card(7, "oros"),
      card(3, "oros"),
      card(2, "bastos"),
      card(1, "oros"),
      card(12, "espadas"),
      card(11, "bastos"),
      card(10, "oros"),
      card(7, "bastos"),
      card(6, "espadas"),
      card(5, "copas"),
      card(4, "oros"),
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(getCardTrucoPower(ordered[i], vira)).toBeGreaterThan(
        getCardTrucoPower(ordered[i + 1], vira),
      );
    }
    expect(getCardTrucoPower(card(3, "oros"), vira)).toBe(
      getCardTrucoPower(card(3, "espadas"), vira),
    );
    expect(getCardTrucoPower(card(1, "copas"), vira)).toBe(
      getCardTrucoPower(card(1, "oros"), vira),
    );
  });
});

describe("Envido y Flor", () => {
  test("Envido estándar (2 del mismo palo + 20, figuras valen 0)", () => {
    const vira = card(4, "bastos");
    expect(
      calculateEnvidoPoints([card(7, "oros"), card(6, "oros"), card(2, "espadas")], vira),
    ).toBe(33);
    expect(
      calculateEnvidoPoints([card(12, "copas"), card(10, "copas"), card(5, "oros")], vira),
    ).toBe(20);
    expect(
      calculateEnvidoPoints([card(7, "oros"), card(5, "copas"), card(2, "espadas")], vira),
    ).toBe(7);
  });

  test("Envido con Perico (30) y Perica (29) como comodines de palo", () => {
    const vira = card(2, "espadas");
    expect(
      calculateEnvidoPoints([card(11, "espadas"), card(7, "oros"), card(3, "copas")], vira),
    ).toBe(37);
    expect(
      calculateEnvidoPoints([card(10, "espadas"), card(6, "bastos"), card(12, "oros")], vira),
    ).toBe(35);
    expect(
      calculateEnvidoPoints([card(11, "espadas"), card(12, "oros"), card(10, "copas")], vira),
    ).toBe(30);

    const pairCards = getEnvidoCards([card(7, "oros"), card(6, "oros"), card(2, "copas")], vira);
    expect(pairCards.map((c) => c.id)).toEqual(["7_oros", "6_oros"]);

    const pericoCards = getEnvidoCards([card(11, "espadas"), card(7, "oros"), card(3, "copas")], vira);
    expect(pericoCards.map((c) => c.id)).toEqual(["11_espadas", "7_oros"]);
  });

  test("Flor común, Flor con pieza y Flor Reservada", () => {
    const vira = card(3, "bastos");

    const florComun = [card(7, "oros"), card(6, "oros"), card(5, "oros")];
    expect(hasFlor(florComun, vira)).toBe(true);
    expect(evaluateFlor(florComun, vira)).toEqual({
      hasFlor: true,
      isReservada: false,
      points: 38,
    });

    const florConPerico = [card(11, "bastos"), card(7, "copas"), card(5, "copas")];
    expect(hasFlor(florConPerico, vira)).toBe(true);
    expect(evaluateFlor(florConPerico, vira)).toEqual({
      hasFlor: true,
      isReservada: false,
      points: 42,
    });

    const reservada = [card(11, "bastos"), card(10, "bastos"), card(4, "oros")];
    expect(isFlorReservada(reservada, vira)).toBe(true);
    expect(evaluateFlor(reservada, vira).isReservada).toBe(true);
  });
});

describe("Reglas de Baza Parda", () => {
  test("Todos los casos de empate en bazas", () => {
    expect(resolveHandWinnerFromTricks(["parda", "nosotros"], "ellos")).toBe("nosotros");
    expect(resolveHandWinnerFromTricks(["ellos", "parda"], "nosotros")).toBe("ellos");
    expect(resolveHandWinnerFromTricks(["nosotros", "ellos", "parda"], "ellos")).toBe("nosotros");
    expect(resolveHandWinnerFromTricks(["parda", "parda", "ellos"], "nosotros")).toBe("ellos");
    expect(resolveHandWinnerFromTricks(["parda", "parda", "parda"], "nosotros")).toBe("nosotros");
    expect(resolveHandWinnerFromTricks(["parda", "parda", "parda"], "ellos")).toBe("ellos");
  });
});

describe("Flujo de Juego 1 vs 1, Cantos y Escaladas", () => {
  test("Escalada Truco -> Retruco -> Vale Nueve -> Vale Juego (y No Quiero)", () => {
    const engine = new TrucoEngine(
      { mode: "1v1", targetScore: 24, withFlor: false },
      {
        customDeal: () => ({
          hands: {
            player: [card(1, "espadas"), card(1, "bastos"), card(7, "espadas")],
            cpu: [card(4, "oros"), card(5, "copas"), card(6, "bastos")],
          },
          vira: card(2, "oros"),
        }),
      },
    );

    engine.dispatch("player", { type: "CALL_TRUCO" });
    expect(engine.getState().phase).toBe("AWAITING_TRUCO");
    expect(engine.getState().truco.pendingLevel).toBe(1);

    engine.dispatch("cpu", { type: "CALL_TRUCO" });
    expect(engine.getState().truco.pendingLevel).toBe(2);
    expect(engine.getState().truco.level).toBe(1);

    engine.dispatch("player", { type: "CALL_TRUCO" });
    expect(engine.getState().truco.pendingLevel).toBe(3);

    engine.dispatch("cpu", { type: "RESPOND_TRUCO", accept: false });
    expect(engine.getState().phase).toBe("HAND_OVER");
    expect(engine.getState().scores.nosotros).toBe(6);
  });

  test("El Envido está primero: interrumpe Truco, no revela tantos y se resuelve al final", () => {
    const engine = new TrucoEngine(
      { mode: "1v1", targetScore: 24, withFlor: true },
      {
        customDeal: () => ({
          hands: {
            player: [card(7, "oros"), card(6, "oros"), card(4, "espadas")], // Envido 33
            cpu: [card(5, "copas"), card(4, "copas"), card(1, "espadas")], // Envido 29
          },
          vira: card(2, "bastos"),
        }),
      },
    );

    engine.dispatch("player", { type: "CALL_TRUCO" });
    expect(engine.getState().phase).toBe("AWAITING_TRUCO");

    expect(engine.getLegalActions("cpu").envidoCalls).toContain("envido");
    engine.dispatch("cpu", { type: "CALL_ENVIDO", call: "envido" });
    expect(engine.getState().phase).toBe("AWAITING_ENVIDO");
    expect(engine.getState().pausedTruco).toBeDefined();

    engine.dispatch("player", { type: "RESPOND_ENVIDO", accept: true });
    expect(engine.getState().scores.nosotros).toBe(0);
    expect(engine.getState().envido.pendingSettlement).toBe(true);
    expect(engine.getState().envido.nosotrosPoints).toBeUndefined();
    expect(engine.getState().envido.ellosPoints).toBeUndefined();
    expect(engine.getState().lastEvent?.bubble).toBe("¡QUIERO!");

    expect(engine.getState().phase).toBe("AWAITING_TRUCO");
    expect(engine.getState().truco.responder).toBe("cpu");

    engine.dispatch("cpu", { type: "RESPOND_TRUCO", accept: false });
    expect(engine.getState().phase).toBe("HAND_OVER");
    expect(engine.getState().envido.nosotrosPoints).toBe(33);
    expect(engine.getState().envido.ellosPoints).toBe(29);
    expect(engine.getState().scores.nosotros).toBe(3);
  });

  test("Una vez aceptado el Truco (¡Quiero!) en 1.ª baza, ya NO es legal cantar Envido", () => {
    const engine = new TrucoEngine(
      { mode: "1v1", targetScore: 24, withFlor: false },
      {
        customDeal: () => ({
          hands: {
            player: [card(7, "oros"), card(6, "oros"), card(1, "espadas")],
            cpu: [card(5, "copas"), card(4, "copas"), card(2, "bastos")],
          },
          vira: card(2, "oros"),
        }),
      },
    );

    engine.dispatch("player", { type: "CALL_TRUCO" });
    engine.dispatch("cpu", { type: "RESPOND_TRUCO", accept: true });

    // Truco aceptado -> la ventana de Envido quedó cerrada para ambos jugadores
    expect(engine.getState().envido.resolved).toBe(true);
    expect(engine.getLegalActions("player").envidoCalls).toEqual([]);

    engine.dispatch("player", { type: "PLAY_CARD", cardId: "1_espadas" });
    expect(engine.getLegalActions("cpu").envidoCalls).toEqual([]);
  });

  test("Envido no querido tampoco suma hasta el final de la mano ni revela tantos", () => {
    const engine = new TrucoEngine(
      { mode: "1v1", targetScore: 24, withFlor: false },
      {
        customDeal: () => ({
          hands: {
            player: [card(7, "oros"), card(6, "oros"), card(4, "espadas")],
            cpu: [card(1, "espadas"), card(1, "bastos"), card(3, "copas")],
          },
          vira: card(2, "bastos"),
        }),
      },
    );

    engine.dispatch("player", { type: "CALL_ENVIDO", call: "envido" });
    engine.dispatch("cpu", { type: "RESPOND_ENVIDO", accept: false });

    expect(engine.getState().scores.nosotros).toBe(0);
    expect(engine.getState().envido.pendingSettlement).toBe(true);
    expect(engine.getState().envido.nosotrosPoints).toBeUndefined();

    engine.dispatch("player", { type: "IRSE_AL_MAZO" });
    expect(engine.getState().phase).toBe("HAND_OVER");
    expect(engine.getState().scores.nosotros).toBe(1);
    expect(engine.getState().scores.ellos).toBe(1);
    expect(engine.getState().envido.nosotrosPoints).toBeUndefined();
  });

  test("Prioridad al final de la mano: Envido se anota antes que el Truco", () => {
    const engine = new TrucoEngine(
      { mode: "1v1", targetScore: 12, withFlor: false },
      {
        customDeal: () => ({
          hands: {
            player: [card(7, "oros"), card(6, "oros"), card(4, "espadas")],
            cpu: [card(1, "espadas"), card(1, "bastos"), card(3, "copas")],
          },
          vira: card(2, "bastos"),
        }),
      },
    );

    engine.getState().scores.nosotros = 10;
    engine.getState().scores.ellos = 10;

    engine.dispatch("player", { type: "CALL_ENVIDO", call: "envido" });
    engine.dispatch("cpu", { type: "RESPOND_ENVIDO", accept: true });
    expect(engine.getState().phase).toBe("PLAYING");

    engine.dispatch("player", { type: "CALL_TRUCO" });
    engine.dispatch("cpu", { type: "RESPOND_TRUCO", accept: true });
    engine.dispatch("player", { type: "PLAY_CARD", cardId: "4_espadas" });
    engine.dispatch("cpu", { type: "PLAY_CARD", cardId: "1_espadas" });
    engine.dispatch("cpu", { type: "PLAY_CARD", cardId: "1_bastos" });
    engine.dispatch("player", { type: "PLAY_CARD", cardId: "6_oros" });

    expect(engine.getState().phase).toBe("MATCH_OVER");
    expect(engine.getState().matchWinner).toBe("nosotros");
    expect(engine.getState().scores.nosotros).toBe(12);
    expect(engine.getState().scores.ellos).toBe(10);
  });

  test("Flor Reservada NO se canta como '¡Flor Reservada!': si se canta dice '¡FLOR!', no delata piezas y suma 5 al final", () => {
    const engine = new TrucoEngine(
      { mode: "1v1", targetScore: 24, withFlor: true },
      {
        customDeal: () => ({
          hands: {
            player: [card(11, "copas"), card(10, "copas"), card(4, "oros")],
            cpu: [card(7, "espadas"), card(6, "espadas"), card(3, "bastos")],
          },
          vira: card(5, "copas"),
        }),
      },
    );

    expect(engine.getLegalActions("player").canCallALey).toBe(false);
    expect(engine.getLegalActions("player").canCallFlor).toBe(true);
    engine.dispatch("player", { type: "CALL_FLOR" });
    // Nunca canta "¡FLOR RESERVADA!" ni suma los 5 puntos a mitad de mano delatando las piezas
    expect(engine.getState().lastEvent?.bubble).toBe("¡FLOR!");
    expect(engine.getState().scores.nosotros).toBe(0);
    expect(engine.getState().flor.isReservada).toBe(true);
    expect(engine.getState().flor.pendingSettlement).toBe(true);
    expect(engine.getState().envido.resolved).toBe(true);
    expect(engine.getState().phase).toBe("PLAYING");

    // Al cerrar la mano, se presenta la Flor Reservada y suma +5 piedras
    engine.dispatch("player", { type: "IRSE_AL_MAZO" });
    expect(engine.getState().scores.nosotros).toBe(5);
    expect(engine.getState().flor.stage).toBe("flor_reservada");
  });

  test("Flor Reservada guardada en silencio (sin cantar Flor) cobra 5 piedras automáticamente al final de la mano", () => {
    const engine = new TrucoEngine(
      { mode: "1v1", targetScore: 24, withFlor: true },
      {
        customDeal: () => ({
          hands: {
            player: [card(11, "copas"), card(10, "copas"), card(4, "oros")], // Perico + Perica
            cpu: [card(7, "espadas"), card(6, "espadas"), card(3, "bastos")],
          },
          vira: card(5, "copas"),
        }),
      },
    );

    // El jugador NO canta Flor — juega sus cartas normalmente reservándola callado
    engine.dispatch("player", { type: "PLAY_CARD", cardId: "11_copas" });
    engine.dispatch("cpu", { type: "PLAY_CARD", cardId: "3_bastos" });
    engine.dispatch("player", { type: "PLAY_CARD", cardId: "10_copas" });
    engine.dispatch("cpu", { type: "PLAY_CARD", cardId: "7_espadas" });

    // Ganó 2 bazas (+1 de truco) + Flor Reservada presentada al final (+5 piedras) = 6
    expect(engine.getState().phase).toBe("HAND_OVER");
    expect(engine.getState().flor.stage).toBe("flor_reservada");
    expect(engine.getState().flor.pointsAwarded).toBe(5);
    expect(engine.getState().scores.nosotros).toBe(6);
  });

  test("Con Flor Reservada ante rival con Flor, el canto dice '¡FLOR!' y permite envidar con flor", () => {
    const engine = new TrucoEngine(
      { mode: "1v1", targetScore: 24, withFlor: true },
      {
        customDeal: () => ({
          hands: {
            player: [card(11, "copas"), card(10, "copas"), card(4, "oros")], // Flor Reservada
            cpu: [card(7, "espadas"), card(6, "espadas"), card(5, "espadas")], // Flor de 38
          },
          vira: card(5, "copas"),
        }),
      },
    );

    engine.dispatch("player", { type: "CALL_FLOR" });
    expect(engine.getState().lastEvent?.bubble).toBe("¡FLOR!");
    expect(engine.getState().phase).toBe("AWAITING_FLOR");

    // El rival envida con flor y el jugador acepta
    engine.dispatch("cpu", { type: "RESPOND_FLOR", choice: "contraflor" });
    engine.dispatch("player", { type: "RESPOND_FLOR", choice: "quiero" });
    expect(engine.getState().flor.pendingSettlement).toBe(true);

    expect(engine.getState().flor.stakedPoints).toBe(5);
    engine.dispatch("player", { type: "IRSE_AL_MAZO" });
    expect(engine.getState().flor.winnerTeam).toBe("nosotros");
    expect(engine.getState().scores.nosotros).toBe(5);
    expect(engine.getState().log.filter(e => e.bubble === "Son buenas").map(e => e.actor)).toEqual(["cpu"]);
  });

  test("Partida completa simulada 1 vs 1 termina sin bloqueos", () => {
    let seed = 42;
    const seededRng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    const engine = new TrucoEngine(
      { mode: "1v1", targetScore: 24, withFlor: true },
      { rng: seededRng },
    );
    let steps = 0;

    while (engine.getState().phase !== "MATCH_OVER" && steps < 500) {
      steps++;
      const s = engine.getState();

      if (s.phase === "HAND_OVER") {
        engine.dispatch("player", { type: "NEXT_HAND" });
        continue;
      }

      const cpuAction = decideCpuAction(engine, seededRng);
      if (cpuAction) {
        engine.dispatch("cpu", cpuAction);
        continue;
      }

      const pAction = decideBotAction(engine, "player", seededRng);
      if (!pAction) throw new Error(`Estado bloqueado en fase ${s.phase}`);
      engine.dispatch("player", pAction);
    }

    expect(engine.getState().phase).toBe("MATCH_OVER");
    expect(engine.getState().matchWinner).toBeDefined();
    expect(steps).toBeLessThan(500);
  });
});

describe("Cantos de A Ley / Con Ley / Sin Ley", () => {
  test("Solo quien no es Pie puede declarar ¡A Ley! en 1.ª baza", () => {
    const engine = new TrucoEngine(
      { mode: "1v1", targetScore: 24, withFlor: true },
      {
        customDeal: () => ({
          hands: {
            player: [card(7, "oros"), card(6, "oros"), card(5, "oros")],
            cpu: [card(4, "copas"), card(5, "espadas"), card(6, "bastos")],
          },
          vira: card(2, "espadas"),
        }),
      },
    );

    expect(engine.getLegalActions("player").canCallALey).toBe(true);
    engine.dispatch("player", { type: "PLAY_CARD", cardId: "5_oros" });
    expect(engine.getLegalActions("cpu").canCallALey).toBe(false);
  });

  test("Mano con Flor sale A Ley, juega 1.ª carta y cobra su Flor en la 2.ª baza", () => {
    const engine = new TrucoEngine(
      { mode: "1v1", targetScore: 24, withFlor: true },
      {
        customDeal: () => ({
          hands: {
            player: [card(7, "oros"), card(6, "oros"), card(5, "oros")],
            cpu: [card(4, "copas"), card(2, "espadas"), card(3, "bastos")],
          },
          vira: card(2, "copas"),
        }),
      },
    );

    engine.dispatch("player", { type: "CALL_A_LEY" });
    expect(engine.getState().ley.active).toBe(true);
    expect(engine.getState().ley.hiddenFlorPlayers).toContain("player");

    engine.dispatch("player", { type: "PLAY_CARD", cardId: "7_oros" });
    engine.dispatch("cpu", { type: "PLAY_CARD", cardId: "4_copas" });

    expect(engine.getState().trickIndex).toBe(1);
    const legal2 = engine.getLegalActions("player");
    expect(legal2.canCallFlor).toBe(true);
    expect(legal2.mustCallFlorALey).toBe(true);

    engine.dispatch("player", { type: "CALL_FLOR" });
    expect(engine.getState().scores.nosotros).toBe(3);
    expect(engine.getState().flor.resolved).toBe(true);
    expect(engine.getState().lastEvent?.bubble).toBe("¡FLOR!");
    expect(engine.getState().ley.active).toBe(false);
  });

  test("Si la Mano salió a ley con flor y juega la 2.ª carta sin cantarla, pierde la Flor", () => {
    const engine = new TrucoEngine(
      { mode: "1v1", targetScore: 24, withFlor: true },
      {
        customDeal: () => ({
          hands: {
            player: [card(7, "oros"), card(6, "oros"), card(5, "oros")],
            cpu: [card(4, "copas"), card(5, "espadas"), card(6, "bastos")],
          },
          vira: card(2, "copas"),
        }),
      },
    );

    engine.dispatch("player", { type: "CALL_A_LEY" });
    engine.dispatch("player", { type: "PLAY_CARD", cardId: "7_oros" });
    engine.dispatch("cpu", { type: "PLAY_CARD", cardId: "4_copas" });

    engine.dispatch("player", { type: "PLAY_CARD", cardId: "6_oros" });
    expect(engine.getState().ley.forfeitedBy).toContain("player");
    expect(engine.getState().flor.resolved).toBe(true);
    expect(engine.getState().scores.nosotros).toBe(0);
  });

  test("Tras salir a ley, la Mano interrumpe el Envido del Pie cantando ¡Flor!", () => {
    const engine = new TrucoEngine(
      { mode: "1v1", targetScore: 24, withFlor: true },
      {
        customDeal: () => ({
          hands: {
            player: [card(7, "oros"), card(6, "oros"), card(5, "oros")],
            cpu: [card(7, "copas"), card(6, "copas"), card(1, "espadas")],
          },
          vira: card(2, "bastos"),
        }),
      },
    );

    engine.dispatch("player", { type: "CALL_A_LEY" });
    engine.dispatch("player", { type: "PLAY_CARD", cardId: "5_oros" });

    engine.dispatch("cpu", { type: "CALL_ENVIDO", call: "envido" });
    expect(engine.getState().phase).toBe("AWAITING_ENVIDO");

    expect(engine.getLegalActions("player").canCallFlor).toBe(true);
    expect(engine.getLegalActions("player").mustCallFlorALey).toBe(true);
    engine.dispatch("player", { type: "CALL_FLOR" });
    expect(engine.getState().scores.nosotros).toBe(3);
    expect(engine.getState().envido.resolved).toBe(true);
    expect(engine.getState().phase).toBe("PLAYING");
  });

  test.each([true, false])("El rival sin Flor responde al Envido a ley (acepta: %s)", (accept) => {
    const engine = new TrucoEngine(
      { mode: "1v1", targetScore: 24, withFlor: true },
      {
        customDeal: () => ({
          hands: {
            player: [card(7, "oros"), card(6, "oros"), card(4, "espadas")],
            cpu: [card(5, "copas"), card(4, "copas"), card(1, "bastos")],
          },
          vira: card(2, "bastos"),
        }),
      },
    );

    engine.dispatch("player", { type: "CALL_A_LEY" });
    expect(engine.getState().ley.active).toBe(true);
    expect(engine.getState().ley.hiddenFlorPlayers.length).toBe(0);

    engine.dispatch("player", { type: "CALL_ENVIDO", call: "envido" });
    expect(engine.getState().lastEvent?.bubble).toBe("¡A LEY, ENVIDO!");

    engine.dispatch("cpu", { type: "RESPOND_ENVIDO", accept });
    expect(engine.getState().lastEvent?.bubble).toBe(accept ? "¡SIN LEY, QUIERO!" : "¡SIN LEY, NO QUIERO!");
    expect(engine.getState().scores.nosotros).toBe(0);
    expect(engine.getState().envido.pendingSettlement).toBe(true);

    engine.dispatch("player", { type: "PLAY_CARD", cardId: "7_oros" });
    engine.dispatch("cpu", { type: "IRSE_AL_MAZO" });
    expect(engine.getState().scores.nosotros).toBe(accept ? 3 : 2);
  });
});

describe("Modo 4 Jugadores (2 vs 2 Parejas)", () => {
  test("Orden de turnos antihorario (Tú -> Rival Der -> Compañero -> Rival Izq) y resolución por equipo", () => {
    const engine = new TrucoEngine(
      { mode: "2v2", targetScore: 24, withFlor: false },
      {
        customDeal: () => ({
          hands: {
            player: [card(4, "oros"), card(5, "oros"), card(6, "oros")],
            cpu: [card(7, "espadas"), card(2, "bastos"), card(4, "copas")],
            partner: [card(1, "espadas"), card(1, "bastos"), card(3, "oros")], // Compañero gana baza 1 y 2
            cpu2: [card(6, "bastos"), card(5, "copas"), card(4, "bastos")],
          },
          vira: card(2, "copas"),
        }),
      },
    );

    expect(engine.getState().seats).toEqual(["player", "cpu", "partner", "cpu2"]);
    expect(engine.getState().turn).toBe("player");

    engine.dispatch("player", { type: "PLAY_CARD", cardId: "4_oros" });
    expect(engine.getState().turn).toBe("cpu");

    engine.dispatch("cpu", { type: "PLAY_CARD", cardId: "7_espadas" });
    expect(engine.getState().turn).toBe("partner");

    engine.dispatch("partner", { type: "PLAY_CARD", cardId: "1_espadas" });
    expect(engine.getState().turn).toBe("cpu2");

    engine.dispatch("cpu2", { type: "PLAY_CARD", cardId: "4_bastos" });

    // Compañero ganó baza 1 -> sale Compañero en baza 2
    expect(engine.getState().trickIndex).toBe(1);
    expect(engine.getState().tricks[0].winnerTeam).toBe("nosotros");
    expect(engine.getState().tricks[0].winnerPlayer).toBe("partner");
    expect(engine.getState().turn).toBe("partner");
  });

  test("Envido en 2 vs 2 compara el mejor puntaje de cada pareja al final de la mano", () => {
    const engine = new TrucoEngine(
      { mode: "2v2", targetScore: 24, withFlor: false },
      {
        customDeal: () => ({
          hands: {
            player: [card(4, "oros"), card(5, "copas"), card(6, "bastos")], // Envido 6
            cpu: [card(7, "copas"), card(5, "copas"), card(2, "espadas")], // Envido 32
            partner: [card(7, "oros"), card(6, "oros"), card(1, "espadas")], // Envido 33 (mejor de Nosotros!)
            cpu2: [card(3, "bastos"), card(2, "oros"), card(10, "espadas")], // Envido 3
          },
          vira: card(4, "espadas"),
        }),
      },
    );

    engine.dispatch("player", { type: "CALL_ENVIDO", call: "envido" });
    engine.dispatch("cpu", { type: "RESPOND_ENVIDO", accept: true });

    // Se resuelve al final de la mano
    expect(engine.getState().scores.nosotros).toBe(0);
    engine.dispatch("player", { type: "IRSE_AL_MAZO" });

    // Compañero (33) vence a Rival Der (32) -> Nosotros +2 de Envido, Ellos +1 de Truco
    expect(engine.getState().envido.nosotrosBestPlayer).toBe("partner");
    expect(engine.getState().envido.nosotrosPoints).toBe(33);
    expect(engine.getState().envido.ellosBestPlayer).toBe("cpu");
    expect(engine.getState().envido.ellosPoints).toBe(32);
    expect(engine.getState().scores.nosotros).toBe(2);
    expect(engine.getState().scores.ellos).toBe(1);
  });

  test("Partida completa simulada 2 vs 2 (4 jugadores) termina sin bloqueos y rota la Mano por los 4 asientos", () => {
    let seed = 1337;
    const seededRng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    const engine = new TrucoEngine(
      { mode: "2v2", targetScore: 24, withFlor: true },
      { rng: seededRng },
    );
    const seenManos = new Set<string>();
    let steps = 0;

    while (engine.getState().phase !== "MATCH_OVER" && steps < 900) {
      steps++;
      const s = engine.getState();
      seenManos.add(s.mano);

      if (s.phase === "HAND_OVER") {
        engine.dispatch("player", { type: "NEXT_HAND" });
        continue;
      }

      let acted = false;
      for (const seat of s.seats) {
        const action = decideBotAction(engine, seat, seededRng);
        if (action) {
          engine.dispatch(seat, action);
          acted = true;
          break;
        }
      }
      if (!acted) {
        throw new Error(`Estado 2v2 bloqueado en fase ${s.phase} (turno ${s.turn})`);
      }
    }

    expect(engine.getState().phase).toBe("MATCH_OVER");
    expect(engine.getState().matchWinner).toBeDefined();
    expect(seenManos.size).toBeGreaterThanOrEqual(3);
    expect(steps).toBeLessThan(900);
  });
});

describe("Comunicación con el Compañero (2 vs 2)", () => {
  test("Al gritar Envido un rival, el compañero avisa su puntaje exacto y si conviene querer", () => {
    const engine = new TrucoEngine(
      { mode: "2v2", targetScore: 24, withFlor: false },
      {
        customDeal: () => ({
          hands: {
            player: [card(4, "oros"), card(5, "copas"), card(6, "bastos")], // 6 pts
            cpu: [card(7, "copas"), card(6, "copas"), card(2, "espadas")],
            partner: [card(7, "oros"), card(5, "oros"), card(1, "bastos")], // 32 pts
            cpu2: [card(3, "bastos"), card(2, "oros"), card(10, "espadas")],
          },
          vira: card(4, "espadas"),
        }),
      },
    );

    engine.dispatch("player", { type: "PLAY_CARD", cardId: "4_oros" });
    engine.dispatch("cpu", { type: "CALL_ENVIDO", call: "envido" });

    expect(engine.getState().phase).toBe("AWAITING_ENVIDO");
    expect(engine.getState().envido.responder).toBe("player");

    const callout = buildAutoPartnerCallout(engine.getState());
    expect(callout).not.toBeNull();
    expect(callout!.tone).toBe("strong");
    expect(callout!.headline).toContain("32");
    expect(callout!.headline).toContain("Quiero");
  });

  test("Si el compañero no liga envido, avisa claramente para decir No Quiero", () => {
    const engine = new TrucoEngine(
      { mode: "2v2", targetScore: 24, withFlor: false },
      {
        customDeal: () => ({
          hands: {
            player: [card(4, "oros"), card(5, "copas"), card(6, "bastos")], // 6 pts
            cpu: [card(7, "copas"), card(6, "copas"), card(2, "espadas")],
            partner: [card(1, "oros"), card(3, "copas"), card(6, "espadas")], // 6 pts (no liga)
            cpu2: [card(3, "bastos"), card(2, "oros"), card(10, "espadas")],
          },
          vira: card(4, "bastos"),
        }),
      },
    );

    engine.dispatch("player", { type: "PLAY_CARD", cardId: "4_oros" });
    engine.dispatch("cpu", { type: "CALL_ENVIDO", call: "envido" });

    const callout = buildAutoPartnerCallout(engine.getState());
    expect(callout).not.toBeNull();
    expect(callout!.tone).toBe("weak");
    expect(callout!.headline).toContain("No ligo");
  });

  test("Nadie puede cantar la Flor de su compañero: si solo el Compañero tiene Flor, responde y canta el Compañero", () => {
    const engine = new TrucoEngine(
      { mode: "2v2", targetScore: 24, withFlor: true },
      {
        customDeal: () => ({
          hands: {
            player: [card(4, "oros"), card(5, "copas"), card(6, "bastos")],
            cpu: [card(7, "copas"), card(6, "copas"), card(2, "espadas")],
            partner: [card(7, "oros"), card(5, "oros"), card(2, "oros")], // Flor de 34
            cpu2: [card(3, "bastos"), card(1, "espadas"), card(10, "espadas")],
          },
          vira: card(4, "espadas"),
        }),
      },
    );

    // Consulta proactiva: compañero avisa que ÉL la canta
    const advice = answerPartnerQuery(engine.getState(), "envido");
    expect(advice.tone).toBe("flor");
    expect(advice.headline).toContain("Flor");

    engine.dispatch("player", { type: "PLAY_CARD", cardId: "4_oros" });
    engine.dispatch("cpu", { type: "CALL_ENVIDO", call: "envido" });

    // El jugador humano NO puede cantar la Flor del compañero; responde el propio Compañero
    expect(engine.getState().envido.responder).toBe("partner");
    expect(engine.getLegalActions("player").canCallFlor).toBe(false);
    expect(engine.getLegalActions("partner").canCallFlor).toBe(true);

    // Compañero canta su propia Flor
    const partnerAction = decideBotAction(engine, "partner", () => 0.5);
    expect(partnerAction).toEqual({ type: "CALL_FLOR" });
    engine.dispatch("partner", partnerAction!);
    expect(engine.getState().flor.caller).toBe("partner");
    expect(engine.getState().scores.nosotros).toBe(3);
  });

  test("Viceversa: si solo Tú tienes Flor, tu compañero NO puede cantarla ni responder Flor por ti", () => {
    const engine = new TrucoEngine(
      { mode: "2v2", targetScore: 24, withFlor: true },
      {
        customDeal: () => ({
          hands: {
            player: [card(7, "oros"), card(5, "oros"), card(2, "oros")], // Flor de 34 (solo Tú)
            cpu: [card(7, "copas"), card(6, "copas"), card(2, "copas")], // Rival Der también tiene Flor
            partner: [card(4, "bastos"), card(5, "copas"), card(6, "espadas")], // Sin Flor
            cpu2: [card(3, "bastos"), card(1, "espadas"), card(10, "espadas")],
          },
          vira: card(4, "espadas"),
        }),
      },
    );
    engine.startNewMatch(undefined, "cpu");

    // Rival Der canta Flor -> debe responder TÚ (dueño de la Flor), jamás el Compañero
    engine.dispatch("cpu", { type: "CALL_FLOR" });
    expect(engine.getState().phase).toBe("AWAITING_FLOR");
    expect(engine.getState().flor.responder).toBe("player");
    expect(engine.getLegalActions("partner").florResponses.length).toBe(0);
    expect(engine.getLegalActions("player").florResponses).toContain("contraflor");
  });

  test("En 1 vs 1 no genera avisos automáticos de compañero", () => {
    const engine = new TrucoEngine(
      { mode: "1v1", targetScore: 24, withFlor: false },
      {
        customDeal: () => ({
          hands: {
            player: [card(4, "oros"), card(5, "copas"), card(6, "bastos")],
            cpu: [card(7, "copas"), card(6, "copas"), card(2, "espadas")],
          },
          vira: card(4, "espadas"),
        }),
      },
    );
    engine.dispatch("player", { type: "PLAY_CARD", cardId: "4_oros" });
    engine.dispatch("cpu", { type: "CALL_ENVIDO", call: "envido" });
    expect(buildAutoPartnerCallout(engine.getState())).toBeNull();
  });

  test("Consultas de señas y órdenes tácticas ('tira_baja' / 'mata_tu') influyen en la IA del compañero", () => {
    const engine = new TrucoEngine(
      { mode: "2v2", targetScore: 24, withFlor: false },
      {
        customDeal: () => ({
          hands: {
            player: [card(4, "oros"), card(5, "copas"), card(6, "bastos")],
            cpu: [card(7, "copas"), card(6, "copas"), card(2, "espadas")],
            partner: [card(11, "espadas"), card(1, "espadas"), card(4, "copas")], // Perico + Espadilla + 4
            cpu2: [card(3, "bastos"), card(2, "oros"), card(10, "bastos")],
          },
          vira: card(5, "espadas"),
        }),
      },
    );

    const senas = answerPartnerQuery(engine.getState(), "senas");
    expect(senas.headline).toContain("Perico");
    expect(senas.headline).toContain("Espadilla");

    engine.dispatch("player", { type: "PLAY_CARD", cardId: "4_oros" });
    engine.dispatch("cpu", { type: "CALL_ENVIDO", call: "envido" });
    engine.dispatch("player", { type: "RESPOND_ENVIDO", accept: true });
    engine.dispatch("cpu", { type: "PLAY_CARD", cardId: "7_copas" });
    expect(engine.getState().turn).toBe("partner");

    // Orden: Tira baja -> compañero debe sacrificar el 4 de copas
    const lowCmd = handlePartnerCommand(engine.getState(), "tira_baja");
    const lowAction = decideBotAction(engine, "partner", () => 0.99, lowCmd.hintUpdate);
    expect(lowAction).toEqual({ type: "PLAY_CARD", cardId: "4_copas", burned: false });

    // Orden: Mata tú -> compañero debe lanzar su carta más alta (Perico: 11_espadas)
    const winCmd = handlePartnerCommand(engine.getState(), "mata_tu");
    const winAction = decideBotAction(engine, "partner", () => 0.99, winCmd.hintUpdate);
    expect(winAction).toEqual({ type: "PLAY_CARD", cardId: "11_espadas", burned: false });
  });
});

describe("Multijugador Online (Proyección de Perspectiva y Sincronización)", () => {
  test("Proyecta correctamente los 4 asientos en 2 vs 2 para que cada jugador se vea en Sur ('player')", () => {
    const seats = ["player", "cpu", "partner", "cpu2"] as const;
    for (const viewer of seats) {
      expect(mapSeatToViewer(viewer, viewer, [...seats])).toBe("player");
      for (const s of seats) {
        const rel = mapSeatToViewer(s, viewer, [...seats]);
        expect(mapViewerToCanonicalSeat(rel, viewer, [...seats])).toBe(s);
      }
    }

    const hostEngine = new TrucoEngine(
      { mode: "2v2", targetScore: 24, withFlor: true },
      {
        customDeal: () => ({
          hands: {
            player: [card(4, "oros"), card(5, "copas"), card(6, "bastos")],
            cpu: [card(7, "copas"), card(6, "copas"), card(2, "espadas")],
            partner: [card(1, "espadas"), card(3, "oros"), card(2, "bastos")],
            cpu2: [card(12, "bastos"), card(11, "bastos"), card(10, "bastos")],
          },
          vira: card(4, "espadas"),
        }),
      },
    );

    hostEngine.dispatch("player", { type: "PLAY_CARD", cardId: "4_oros" });
    hostEngine.dispatch("cpu", { type: "CALL_ENVIDO", call: "envido" });

    // Desde la perspectiva de "cpu" (equipo "ellos"), "cpu" es "player", su compañero "cpu2" es "partner",
    // y el llamador del envido es él mismo ("player") esperando respuesta de "cpu2"->"partner" o rival "cpu"
    const cpuView = projectStateForViewer(hostEngine.getState(), "cpu");
    expect(cpuView.hands.player?.map((c) => c.id)).toEqual(["7_copas", "6_copas", "2_espadas"]);
    expect(cpuView.hands.partner?.map((c) => c.id)).toEqual(["12_bastos", "11_bastos", "10_bastos"]);
    expect(cpuView.envido.caller).toBe("player");
    expect(cpuView.envido.callerTeam).toBe("nosotros");
    expect(cpuView.envido.responderTeam).toBe("ellos");

    // Desde la perspectiva de "partner", "partner" es "player" y "player" (anfitrión) es su "partner"
    const partnerView = projectStateForViewer(hostEngine.getState(), "partner");
    expect(partnerView.hands.player?.map((c) => c.id)).toEqual(["1_espadas", "3_oros", "2_bastos"]);
    expect(partnerView.hands.partner?.map((c) => c.id)).toEqual(["5_copas", "6_bastos"]);

    // Hidratar un TrucoEngine de invitado con loadExternalState permite consultar getLegalActions("player")
    const guestEngine = new TrucoEngine({ mode: "2v2", targetScore: 24, withFlor: true });
    guestEngine.loadExternalState(cpuView);
    expect(guestEngine.getLegalActions("player").canRespondEnvido).toBe(false); // él cantó el envido
  });

  test("Anti-trampa: buildSafeViewerState oculta cartas no reveladas, quemadas y puntajes secretos", () => {
    const hostEngine = new TrucoEngine(
      { mode: "1v1", targetScore: 24, withFlor: true },
      {
        customDeal: () => ({
          hands: {
            player: [card(1, "espadas"), card(7, "oros"), card(5, "oros")], // 32 envido
            cpu: [card(1, "bastos"), card(7, "copas"), card(6, "copas")], // 33 envido
          },
          vira: card(4, "espadas"),
        }),
      },
    );

    // 1) Inicio de mano: "cpu" no debe ver ninguna carta real de "player" en el JSON serializado
    const cpuStartView = buildSafeViewerState(hostEngine.getState(), "cpu");
    const serializedStart = JSON.stringify(cpuStartView);
    expect(serializedStart).not.toContain("1_espadas");
    expect(serializedStart).not.toContain("7_oros");
    expect(serializedStart).not.toContain("5_oros");
    expect(cpuStartView.hands.player?.map((c) => c.id)).toEqual(["1_bastos", "7_copas", "6_copas"]);
    expect(cpuStartView.hands.cpu?.every((c) => isHiddenCardId(c.id))).toBe(true);

    // 2) "player" canta Envido y juega 1_espadas boca arriba; "cpu" acepta y quema 6_copas boca abajo
    hostEngine.dispatch("player", { type: "CALL_ENVIDO", call: "envido" });
    hostEngine.dispatch("cpu", { type: "RESPOND_ENVIDO", accept: true });
    hostEngine.dispatch("player", { type: "PLAY_CARD", cardId: "1_espadas" });
    hostEngine.dispatch("cpu", { type: "PLAY_CARD", cardId: "6_copas", burned: true });

    // Para "player": ve su mano, NO ve 6_copas quemada ni las restantes de cpu, ni puntajes de envido antes de HAND_OVER
    const playerMidView = buildSafeViewerState(hostEngine.getState(), "player");
    const playerMidJson = JSON.stringify(playerMidView);
    expect(playerMidJson).not.toContain("1_bastos");
    expect(playerMidJson).not.toContain("7_copas");
    expect(playerMidJson).not.toContain("6_copas");
    expect(playerMidView.envido.nosotrosPoints).toBeUndefined();
    expect(playerMidView.envido.ellosPoints).toBeUndefined();
    expect(isHiddenCardId(playerMidView.tricks[0].played.cpu!.card.id)).toBe(true);

    // Para "cpu": sí ve 1_espadas (jugada boca arriba), pero NO 7_oros ni 5_oros
    const cpuMidView = buildSafeViewerState(hostEngine.getState(), "cpu");
    expect(cpuMidView.tricks[0].played.cpu?.card.id).toBe("1_espadas");
    expect(JSON.stringify(cpuMidView)).not.toContain("7_oros");
    expect(JSON.stringify(cpuMidView)).not.toContain("5_oros");

    // 3) Acciones legales en la vista sanitizada coinciden exactamente con el motor canónico
    const viewerEngine = new TrucoEngine({ mode: "1v1", targetScore: 24, withFlor: true });
    viewerEngine.loadExternalState(playerMidView);
    expect(viewerEngine.getLegalActions("player")).toEqual(hostEngine.getLegalActions("player"));

    // 4) Cerrar mano (player se va al mazo) -> al tener Envido aceptado, HAND_OVER revela las cartas del oponente
    hostEngine.dispatch("player", { type: "IRSE_AL_MAZO" });
    expect(hostEngine.getState().phase).toBe("HAND_OVER");
    const playerEndView = buildSafeViewerState(hostEngine.getState(), "player");
    expect(playerEndView.initialHands.cpu?.map((c) => c.id)).toEqual([
      "1_bastos",
      "7_copas",
      "6_copas",
    ]);
    expect(playerEndView.envido.nosotrosPoints).toBe(32);
    expect(playerEndView.envido.ellosPoints).toBe(33);
  });

  test("Anti-trampa 2v2: respeta las cartas vistas del ritual venezolano (antepie -> mano, repartidor -> trasmano)", () => {
    const hostEngine = new TrucoEngine(
      { mode: "2v2", targetScore: 24, withFlor: false },
      {
        customDeal: () => ({
          hands: {
            player: [card(1, "espadas"), card(4, "oros"), card(5, "copas")], // mano
            cpu: [card(1, "bastos"), card(6, "oros"), card(7, "copas")], // trasmano
            partner: [card(3, "espadas"), card(2, "oros"), card(10, "copas")], // antepie
            cpu2: [card(12, "bastos"), card(11, "oros"), card(2, "espadas")], // dealer
          },
          vira: card(4, "espadas"),
        }),
      },
    );
    const canonical = hostEngine.getState();

    // antepie ("partner") ve la 1.ª carta del mano ("player": 1_espadas), pero NO las otras 2 ni las de rivales
    const partnerView = buildSafeViewerState(canonical, "partner");
    const partnerJson = JSON.stringify(partnerView);
    expect(partnerJson).toContain("1_espadas");
    expect(partnerJson).not.toContain("4_oros");
    expect(partnerJson).not.toContain("1_bastos");
    expect(partnerJson).not.toContain("12_bastos");

    // repartidor ("cpu2") ve la 1.ª carta del trasmano ("cpu": 1_bastos), pero NO las de "player" ni "partner"
    const dealerView = buildSafeViewerState(canonical, "cpu2");
    const dealerJson = JSON.stringify(dealerView);
    expect(dealerJson).toContain("1_bastos");
    expect(dealerJson).not.toContain("6_oros");
    expect(dealerJson).not.toContain("1_espadas");
    expect(dealerJson).not.toContain("3_espadas");
  });
});

describe("Nombres en resúmenes online", () => {
  test("Un invitado 1v1 ve los nombres correctos incluso cuando el apodo contiene CPU", () => {
    const label = (seat: string) => seat === "player" ? "Ana" : "CPU Junior";
    const text = "Envido: Tú 28 vs CPU 31 → CPU (+2)";
    expect(formatOnlineSummaryText(text, "1v1", "cpu", label))
      .toBe("Envido: CPU Junior 28 vs Ana 31 → Ana (+2)");
  });

  test("La contraflor y las parejas se leen desde la posición del invitado", () => {
    const names = { player: "Ana", cpu: "Luis", partner: "José", cpu2: "Marta" };
    const text = "Compañero no quiere la Contraflor. Ellos suma +6 piedras.";
    expect(formatOnlineSummaryText(text, "2v2", "cpu", seat => names[seat]))
      .toBe("Luis no quiere la Contraflor. Nuestro equipo suma +6 piedras.");
    expect(formatOnlineSummaryText("Nosotros gana el lance del Truco", "2v2", "cpu", seat => names[seat]))
      .toBe("El equipo rival gana el lance del Truco");
  });
});

describe("Jugadas de parejas y cierre de apuestas", () => {
  function mesa(conFlor = true) {
    return new TrucoEngine({ mode: "2v2", withFlor: conFlor }, {
      customDeal: () => ({
        vira: card(4, "espadas"),
        hands: {
          player: [card(7, "copas"), card(6, "copas"), card(5, "copas")],
          cpu: [card(4, "bastos"), card(3, "bastos"), card(2, "bastos")],
          partner: [card(1, "oros"), card(2, "oros"), card(3, "oros")],
          cpu2: [card(1, "copas"), card(2, "copas"), card(3, "espadas")],
        },
      }),
    });
  }

  test("Una Flor perdida al cantar Truco tampoco puede interrumpir un Envido", () => {
    const e = mesa();
    e.dispatch("player", { type: "CALL_A_LEY" });
    e.dispatch("player", { type: "CALL_TRUCO" });
    e.dispatch("cpu2", { type: "CALL_ENVIDO", call: "envido" });
    expect(e.getState().ley.forfeitedBy).toContain("player");
    expect(e.getLegalActions("player").canCallFlor).toBe(false);
    e.dispatch("player", { type: "CALL_FLOR" });
    expect(e.getState().phase).toBe("AWAITING_ENVIDO");
    expect(e.getState().scores.nosotros).toBe(0);
    expect(e.getLegalActions("partner").canCallFlor).toBe(true);
  });

  test("La Flor de 29 gana a la de 26 aunque el compañero haya dejado pasar una de 38", () => {
    const e = mesa();
    e.dispatch("player", { type: "PLAY_CARD", cardId: "7_copas" });
    e.dispatch("cpu", { type: "CALL_FLOR" });
    e.dispatch("partner", { type: "RESPOND_FLOR", choice: "contraflor" });
    e.dispatch("cpu", { type: "RESPOND_FLOR", choice: "quiero" });
    e.dispatch("cpu", { type: "IRSE_AL_MAZO" });
    expect(e.getState().flor).toMatchObject({ winnerPlayer: "cpu", pointsAwarded: 5,
      nosotrosBestPlayer: "partner", nosotrosPoints: 26, ellosPoints: 29 });
  });

  test("Envido sobre Truco exige tres cartas propias y la primera respuesta al envite compromete a la pareja", () => {
    const e = mesa(false);
    e.dispatch("player", { type: "PLAY_CARD", cardId: "7_copas" });
    e.dispatch("cpu", { type: "CALL_TRUCO" });
    expect(e.getLegalActions("player").envidoCalls).toEqual([]);
    expect(e.getLegalActions("partner").envidoCalls).toContain("envido_cinco");
    e.dispatch("partner", { type: "CALL_ENVIDO", call: "envido_cinco" });
    for (const seat of ["cpu", "cpu2"] as const) expect(e.getLegalActions(seat).canRespondEnvido).toBe(true);
    e.dispatch("cpu2", { type: "RESPOND_ENVIDO", accept: true });
    e.dispatch("cpu", { type: "RESPOND_ENVIDO", accept: false });
    expect(e.getState().envido).toMatchObject({ accepted: true, stakedPoints: 5 });
    expect(e.getState().phase).toBe("AWAITING_TRUCO");
  });

  test("El canto público A ley es idéntico con Flor y sin ella", () => {
    const con = mesa(), sin = mesa();
    const cards = sin.getState().initialHands;
    [cards.player![0], cards.cpu2![2]] = [cards.cpu2![2], cards.player![0]];
    sin.getState().hands.player = [...cards.player!];
    sin.getState().hands.cpu2 = [...cards.cpu2!];
    for (const e of [con, sin]) e.dispatch("player", { type: "CALL_A_LEY" });
    expect(con.getState().ley.hiddenFlorPlayers).toEqual(["player"]);
    expect(sin.getState().ley.hiddenFlorPlayers).toEqual([]);
    expect(buildSafeViewerState(con.getState(), "cpu").lastEvent)
      .toEqual(buildSafeViewerState(sin.getState(), "cpu").lastEvent);
  });

  test("A ley corresponde a los tres primeros asientos, en su primera carta", () => {
    const e = mesa();
    for (const seat of e.getState().seats) {
      expect(e.getLegalActions(seat).canCallALey).toBe(seat !== "cpu2");
      e.dispatch(seat, { type: "PLAY_CARD", cardId: e.getState().hands[seat]![0].id });
    }
  });

  test("Al ganar Vale Juego de 17 a 24, el resumen acredita siete piedras", () => {
    const e = new TrucoEngine({ withFlor: false, targetScore: 24 });
    e.getState().scores = { nosotros: 20, ellos: 17 };
    for (const seat of ["player", "cpu", "player", "cpu"] as const) e.dispatch(seat, { type: "CALL_TRUCO" });
    e.dispatch("player", { type: "RESPOND_TRUCO", accept: true });
    e.dispatch("player", { type: "IRSE_AL_MAZO" });
    expect(e.getState().scores.ellos).toBe(24);
    expect(e.getState().handSummary?.trucoPoints).toBe(7);
  });

  test("En 2v2, el Pie con Flor (2 cartas del mismo palo + pieza) puede cantar Flor y anular un Envido querido incluso si hubo Truco pendiente o aceptado", () => {
    function crearMesaPieConFlor() {
      const e = new TrucoEngine(
        { mode: "2v2", targetScore: 24, withFlor: true },
        {
          customDeal: () => ({
            vira: card(3, "bastos"), // Perico = 11 bastos, Perica = 10 bastos
            hands: {
              cpu: [card(7, "oros"), card(6, "oros"), card(4, "espadas")], // Mano (33 envido)
              partner: [card(7, "espadas"), card(5, "espadas"), card(2, "copas")], // Trasmano (32 envido)
              cpu2: [card(1, "espadas"), card(3, "oros"), card(4, "copas")], // Antepié
              player: [card(11, "bastos"), card(6, "copas"), card(5, "copas")], // Pie: Perico + 2 copas = Flor (41)
            },
          }),
        },
      );
      e.startNewMatch({ mode: "2v2", targetScore: 24, withFlor: true }, "cpu");
      return e;
    }

    // Caso 1: Trasmano envida, rival quiere, y el rival canta Truco antes del turno del Pie -> Pie puede interrumpir con Flor
    {
      const e = crearMesaPieConFlor();
      e.dispatch("cpu", { type: "PLAY_CARD", cardId: "4_espadas" });
      e.dispatch("partner", { type: "CALL_ENVIDO", call: "envido" });
      e.dispatch("cpu2", { type: "RESPOND_ENVIDO", accept: true });
      e.dispatch("partner", { type: "PLAY_CARD", cardId: "2_copas" });
      e.dispatch("cpu2", { type: "CALL_TRUCO" });

      expect(e.getState().phase).toBe("AWAITING_TRUCO");
      expect(e.getState().truco.responder).toBe("player");
      expect(e.getLegalActions("player").canCallFlor).toBe(true);

      e.dispatch("player", { type: "CALL_FLOR" });
      expect(e.getState().scores.nosotros).toBe(3);
      expect(e.getState().envido.accepted).toBe(false);
      expect(e.getState().envido.pendingSettlement).toBe(false);
      expect(e.getState().phase).toBe("AWAITING_TRUCO");

      // Al terminar la mano no debe pagarse el Envido anulado
      e.dispatch("player", { type: "RESPOND_TRUCO", accept: false });
      expect(e.getState().scores).toEqual({ nosotros: 3, ellos: 1 });
      expect(e.getState().handSummary?.envidoText).toBeUndefined();
    }

    // Caso 2: Trasmano envida, rival quiere, y además se canta y acepta Truco antes del turno del Pie -> Pie sigue pudiendo cantar Flor en su turno
    {
      const e = crearMesaPieConFlor();
      e.dispatch("cpu", { type: "PLAY_CARD", cardId: "4_espadas" });
      e.dispatch("partner", { type: "CALL_ENVIDO", call: "envido" });
      e.dispatch("cpu", { type: "RESPOND_ENVIDO", accept: true });
      e.dispatch("partner", { type: "CALL_TRUCO" });
      e.dispatch(e.getState().truco.responder!, { type: "RESPOND_TRUCO", accept: true });
      e.dispatch("partner", { type: "PLAY_CARD", cardId: "2_copas" });
      e.dispatch("cpu2", { type: "PLAY_CARD", cardId: "4_copas" });

      expect(e.getState().phase).toBe("PLAYING");
      expect(e.getState().turn).toBe("player");
      expect(e.getState().truco.level).toBe(1);
      expect(e.getLegalActions("player").canCallFlor).toBe(true);

      e.dispatch("player", { type: "CALL_FLOR" });
      expect(e.getState().scores.nosotros).toBe(3);
      expect(e.getState().envido.accepted).toBe(false);
      expect(e.getState().envido.pendingSettlement).toBe(false);
      expect(e.getState().phase).toBe("PLAYING");
      expect(e.getState().turn).toBe("player");
      expect(e.getState().truco.level).toBe(1);

      // Si el Pie se va al mazo luego, solo se pagan las 3 del Truco a Ellos (el Envido quedó anulado)
      e.dispatch("player", { type: "IRSE_AL_MAZO" });
      expect(e.getState().scores).toEqual({ nosotros: 3, ellos: 3 });
      expect(e.getState().handSummary?.envidoText).toBeUndefined();
    }
  });
});
