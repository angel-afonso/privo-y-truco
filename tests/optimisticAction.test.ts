import { describe, expect, test } from "bun:test";
import { TrucoEngine } from "../src/engine/gameEngine";
import { buildSafeViewerState } from "../src/multiplayer/perspective";
import { previewPlayerAction, optimisticFeedback } from "../src/multiplayer/optimisticAction";
import { buildInboxTopic, computeInboxToken } from "../src/multiplayer/inboxToken";

describe("Vista optimista de la mesa", () => {
  for (const burned of [false, true]) {
    test(`Mueve únicamente la carta propia, quemada=${burned}`, () => {
      const engine = new TrucoEngine({ mode: "2v2", withFlor: false });
      const state = engine.startNewMatch(undefined, "cpu");
      const view = buildSafeViewerState(state, "cpu");
      const card = view.hands.player![0];
      const action = { type: "PLAY_CARD" as const, cardId: card.id, burned };
      const preview = previewPlayerAction(view, action);

      expect(preview.hands.player).toHaveLength(2);
      expect(view.hands.player).toHaveLength(3);
      expect(view.tricks[0].played.player).toBeUndefined();
      expect(preview.initialHands).toBe(view.initialHands);
      expect(preview.hands.cpu).toBe(view.hands.cpu);
      expect(preview.scores).toBe(view.scores);
      expect(preview.lastEvent).toBe(view.lastEvent);
      engine.dispatch("cpu", action);
      const confirmed = buildSafeViewerState(engine.getState(), "cpu");
      expect(preview.tricks[0].played.player).toEqual(confirmed.tricks[0].played.player);
      expect(preview.hands.player).toEqual(confirmed.hands.player);
    });
  }

  test("La última carta de una baza espera el resultado oficial", () => {
    const engine = new TrucoEngine({ withFlor: false });
    const state = engine.startNewMatch(undefined, "cpu");
    engine.dispatch("cpu", { type: "PLAY_CARD", cardId: state.hands.cpu![0].id });
    const view = buildSafeViewerState(state, "player");
    const preview = previewPlayerAction(view, { type: "PLAY_CARD", cardId: view.hands.player![0].id });
    expect(preview.tricks[0].played.player?.order).toBe(1);
    expect(preview.trickIndex).toBe(0);
    expect(preview.tricks[0].winnerTeam).toBeUndefined();
    expect(preview.scores).toEqual(view.scores);
    expect(previewPlayerAction(view, { type: "NEXT_HAND" })).toBe(view);
    expect(previewPlayerAction(view, { type: "PLAY_CARD", cardId: "ausente" })).toBe(view);
  });

  test("Feedback optimista genera globo y sonido inmediato para cantos y respuestas", () => {
    const engine = new TrucoEngine({ withFlor: true });
    const state = engine.startNewMatch(undefined, "player");
    const view = buildSafeViewerState(state, "player");

    expect(optimisticFeedback({ type: "PLAY_CARD", cardId: view.hands.player![0].id }, view)).toEqual({
      sound: "card",
    });
    expect(optimisticFeedback({ type: "CALL_TRUCO" }, view, 1)).toEqual({
      bubble: "Truco",
      accent: "truco",
      sound: "call",
    });
    expect(optimisticFeedback({ type: "RESPOND_TRUCO", accept: true }, view)).toEqual({
      bubble: "¡Quiero!",
      accent: "default",
      sound: "response",
    });
    expect(optimisticFeedback({ type: "CALL_FLOR" }, view)).toEqual({
      bubble: "¡FLOR!",
      accent: "flor",
      sound: "call",
    });
  });

  test("El canal privado de bandeja es determinístico y no expone el secreto", async () => {
    const tokenA = await computeInboxToken("ABC123", "client-a", "super-secret-a");
    const tokenA2 = await computeInboxToken("ABC123", "client-a", "super-secret-a");
    const tokenB = await computeInboxToken("ABC123", "client-b", "super-secret-b");
    expect(tokenA).toBe(tokenA2);
    expect(tokenA).not.toBe(tokenB);
    expect(tokenA).toHaveLength(32);
    expect(buildInboxTopic("ABC123", tokenA)).toBe(`truco-inbox:ABC123:${tokenA}`);
    expect(buildInboxTopic("ABC123", tokenA)).not.toContain("super-secret-a");
  });
});
