import { describe, expect, it } from "bun:test";
import { TrucoEngine } from "../src/engine/gameEngine.ts";
import type { Card, Rank, Suit } from "../src/engine/types.ts";
import { describeEnvidoBreakdown } from "../src/ui/envidoBoard.ts";

const c = (rank: Rank, suit: Suit): Card => ({ id: `${rank}_${suit}`, rank, suit });

function makeState(playerHand: Card[], vira: Card, withFlor = true) {
  const engine = new TrucoEngine(
    { mode: "1v1", targetScore: 24, withFlor },
    {
      customDeal: () => ({
        vira,
        hands: {
          player: playerHand,
          cpu: [c(4, "bastos"), c(5, "copas"), c(6, "espadas")],
        },
      }),
    },
  );
  return { engine, state: engine.getState() };
}

describe("Calculadora visual de Envido y Flor (describeEnvidoBreakdown)", () => {
  it("desglosa un par del mismo palo incluyendo figuras como 0", () => {
    const { state } = makeState(
      [c(7, "oros"), c(12, "oros"), c(4, "copas")],
      c(2, "espadas"),
    );
    const b = describeEnvidoBreakdown(state);
    expect(b.title).toBe("ENVIDO");
    expect(b.points).toBe(27);
    expect(b.formula).toBe("20 + 7 + 0");
    expect(b.suitIcon).toBe("oros");
    expect(b.useCrownIcon).toBe(false);
    expect(b.highlightCardIds).toEqual(["7_oros", "12_oros"]);
    expect(b.statusLabel).toBe("BUENO");
  });

  it("desglosa Envido con Perico o Perica y marca las cartas exactas", () => {
    // Vira 2 de espadas -> Perico = 11 de espadas (30), Perica = 10 de espadas (29)
    const { state } = makeState(
      [c(11, "espadas"), c(7, "copas"), c(3, "oros")],
      c(2, "espadas"),
    );
    const b = describeEnvidoBreakdown(state);
    expect(b.title).toBe("ENVIDO");
    expect(b.points).toBe(37);
    expect(b.formula).toBe("Perico 30 + 7");
    expect(b.useCrownIcon).toBe(true);
    expect(b.highlightCardIds).toEqual(["11_espadas", "7_copas"]);
    expect(b.statusLabel).toBe("FUERTE");
  });

  it("indica claramente una mano sin liga (tres palos distintos sin piezas)", () => {
    const { state } = makeState(
      [c(6, "oros"), c(3, "copas"), c(12, "bastos")],
      c(2, "espadas"),
    );
    const b = describeEnvidoBreakdown(state);
    expect(b.points).toBe(6);
    expect(b.formula).toBe("Carta alta · 6");
    expect(b.suitIcon).toBe("oros");
    expect(b.highlightCardIds).toEqual(["6_oros"]);
    expect(b.statusLabel).toBe("SIN LIGA");
  });

  it("desglosa Flor normal, Flor con pieza y Flor Reservada", () => {
    const { state: sFlor } = makeState(
      [c(7, "copas"), c(5, "copas"), c(2, "copas")],
      c(3, "espadas"),
    );
    const bFlor = describeEnvidoBreakdown(sFlor);
    expect(bFlor.title).toBe("FLOR");
    expect(bFlor.points).toBe(34);
    expect(bFlor.formula).toBe("20 + 7 + 5 + 2");
    expect(bFlor.suitIcon).toBe("copas");
    expect(bFlor.highlightCardIds).toHaveLength(3);

    const { state: sRes } = makeState(
      [c(11, "espadas"), c(10, "espadas"), c(6, "oros")],
      c(3, "espadas"),
    );
    const bRes = describeEnvidoBreakdown(sRes);
    expect(bRes.title).toBe("FLOR RESERVADA");
    expect(bRes.points).toBe(65);
    expect(bRes.formula).toBe("Perico + Perica + 6");
    expect(bRes.statusLabel).toBe("5 PIEDRAS");
    expect(bRes.useCrownIcon).toBe(true);
  });

  it("refleja el estado vivo del envite (EN JUEGO, AL CIERRE, CERRADO)", () => {
    const { engine } = makeState(
      [c(7, "oros"), c(6, "oros"), c(4, "copas")],
      c(2, "espadas"),
    );
    engine.dispatch("player", { type: "CALL_ENVIDO", call: "envido" });
    const awaiting = describeEnvidoBreakdown(engine.getState());
    expect(awaiting.statusLabel).toBe("EN JUEGO");
    expect(awaiting.statusUrgent).toBe(true);

    engine.dispatch("cpu", { type: "RESPOND_ENVIDO", accept: true });
    const accepted = describeEnvidoBreakdown(engine.getState());
    expect(accepted.statusLabel).toBe("AL CIERRE");
    expect(accepted.dimmed).toBe(false);

    const { engine: eng2 } = makeState(
      [c(7, "oros"), c(6, "oros"), c(4, "copas")],
      c(2, "espadas"),
    );
    eng2.dispatch("player", { type: "CALL_ENVIDO", call: "envido" });
    eng2.dispatch("cpu", { type: "RESPOND_ENVIDO", accept: false });
    const closed = describeEnvidoBreakdown(eng2.getState());
    expect(closed.statusLabel).toBe("CERRADO");
    expect(closed.dimmed).toBe(true);
  });
});
