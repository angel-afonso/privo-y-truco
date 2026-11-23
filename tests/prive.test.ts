import { expect, test } from "bun:test";
import { decideBotAction } from "../src/engine/ai";
import { TrucoEngine } from "../src/engine/gameEngine";
import { Card, GameMode, getActiveActor, Rank, Suit } from "../src/engine/types";
import { buildSafeViewerState, isHiddenCardId } from "../src/multiplayer/perspective";
import { tableChoices } from "../src/ui/tableBids";

const card = (rank: Rank, suit: Suit): Card => ({ id: `${rank}_${suit}`, rank, suit });

function dealAt(nosotros: number, ellos: number, targetScore: 12 | 24 = 24, mode: GameMode = "1v1") {
  const engine = new TrucoEngine({ mode, targetScore, withFlor: false }, {
    customDeal: () => ({
      vira: card(1, "bastos"),
      hands: {
        player: [card(7, "oros"), card(4, "oros"), card(1, "copas")],
        cpu: [card(7, "espadas"), card(6, "espadas"), card(1, "oros")],
        partner: [card(11, "bastos"), card(7, "copas"), card(2, "oros")],
        cpu2: [card(2, "bastos"), card(6, "oros"), card(5, "copas")],
      },
    }),
  });
  const s = engine.getState();
  s.scores = { nosotros, ellos };
  s.phase = "HAND_OVER";
  engine.dispatch("player", { type: "NEXT_HAND" });
  return engine;
}

test("A 12 y a 24, solo el rival puede abrir el prive y nadie puede adelantarse a la pregunta", () => {
  for (const target of [12, 24] as const) {
    const engine = dealAt(5, target - 1, target);
    const s = engine.getState();
    expect(getActiveActor(s)).toBe("player");
    expect(tableChoices(engine, false).map(c => c.label)).toEqual(["¿Cuánto privas?"]);
    const before = s.lastEvent?.id;
    engine.dispatch("cpu", { type: "DECLARE_PRIVE" });
    engine.dispatch("cpu", { type: "ASK_PRIVE" });
    engine.dispatch("player", { type: "PLAY_CARD", cardId: s.hands.player![0].id });
    expect(s.lastEvent?.id).toBe(before);
    expect(s.prive?.declaredPoints).toBeUndefined();
    engine.dispatch("player", { type: "ASK_PRIVE" });
    expect(getActiveActor(s)).toBe("cpu");
    expect(tableChoices(engine, false)).toEqual([]);
    expect(s.prive?.declaredPoints).toBeUndefined();
    engine.dispatch("cpu", { type: "DECLARE_PRIVE" });
    expect(s.prive?.declaredPoints).toBe(33);
    expect(tableChoices(engine, false)[0].label).toBe("Son buenas");
    engine.dispatch("player", { type: "ANSWER_PRIVE" });
    expect(s.phase).toBe("MATCH_OVER");
    expect(s.scores).toEqual({ nosotros: 5, ellos: target });
  }
  expect(dealAt(22, 22).getState().phase).toBe("PLAYING");
});

test("Privo y truco anota el prive una vez y deja al declarante aceptar o rechazar el truco", () => {
  for (const accept of [true, false]) {
    const engine = dealAt(23, 18);
    const s = engine.getState();
    engine.dispatch("cpu", { type: "ASK_PRIVE" });
    expect(tableChoices(engine, false)[0].label).toBe("Privo 31");
    engine.dispatch("player", { type: "DECLARE_PRIVE" });
    engine.dispatch("cpu", { type: "ANSWER_PRIVE" });
    expect(s.lastEvent?.bubble).toBe("¡PRIVO Y TRUCO!");
    expect(s.scores.ellos).toBe(19);
    expect(s.phase).toBe("AWAITING_TRUCO");
    expect(engine.getLegalActions("player").envidoCalls).toEqual([]);
    engine.dispatch("cpu", { type: "ANSWER_PRIVE" });
    expect(s.scores.ellos).toBe(19);
    engine.dispatch("player", { type: "RESPOND_TRUCO", accept });
    expect(s.phase).toBe(accept ? "PLAYING" : "HAND_OVER");
    expect(s.scores.ellos).toBe(accept ? 19 : 20);
    if (accept) expect(s.turn).toBe(s.mano);
    else {
      engine.dispatch("player", { type: "NEXT_HAND" });
      expect(s.prive?.next).toBe("ASK_PRIVE");
      expect(s.prive?.declaredPoints).toBeUndefined();
    }
  }
});

test("Si ambos están a una, se pregunta a la mano y el prive decide incluso si empatan", () => {
  for (const tie of [true, false]) {
    const engine = dealAt(23, 23);
    const s = engine.getState();
    if (tie) s.initialHands.player = [card(7, "oros"), card(6, "oros"), card(1, "copas")];
    else s.initialHands.player = [card(11, "bastos"), card(7, "oros"), card(1, "copas")];
    expect(s.prive?.declarer).toBe(s.mano);
    for (let i = 0; i < 3; i++) {
      const actor = getActiveActor(s)!;
      engine.dispatch(actor, decideBotAction(engine, actor)!);
    }
    expect(s.phase).toBe("MATCH_OVER");
    expect(s.matchWinner).toBe(tie ? "ellos" : "nosotros");
    expect(s.truco.pendingLevel).toBeUndefined();
  }
});

test("La pareja declara su mejor envite y los asientos online se rotan sin publicar cartas ni tantos anticipados", () => {
  const engine = dealAt(23, 18, 24, "2v2");
  const s = engine.getState();
  // En esta mano declara el compañero, pero el mejor envite lo tiene el otro asiento.
  [s.initialHands.partner, s.initialHands.player] = [s.initialHands.player!, s.initialHands.partner!];
  [s.hands.partner, s.hands.player] = [s.hands.player!, s.hands.partner!];
  const view = () => buildSafeViewerState(s, "cpu");
  expect(getActiveActor(view())).toBe("player");
  expect(view().prive?.declaredPoints).toBeUndefined();
  engine.dispatch("cpu", { type: "ASK_PRIVE" });
  expect(view().prive?.declaredPoints).toBeUndefined();
  expect(getActiveActor(buildSafeViewerState(s, "partner"))).toBe("player");
  const resumed = new TrucoEngine();
  resumed.loadExternalState(JSON.parse(JSON.stringify(s)));
  resumed.dispatch("partner", { type: "DECLARE_PRIVE" });
  const guest = buildSafeViewerState(resumed.getState(), "cpu");
  expect(guest.prive?.declaredPoints).toBe(37);
  expect(guest.initialHands.cpu!.some(c => isHiddenCardId(c.id))).toBe(true);
  resumed.dispatch("cpu", { type: "ANSWER_PRIVE" });
  expect(buildSafeViewerState(resumed.getState(), "cpu").prive?.winnerTeam).toBe("ellos");
});
