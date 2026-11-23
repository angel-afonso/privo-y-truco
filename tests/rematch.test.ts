import { expect, test } from "bun:test";
import { TrucoEngine } from "../src/engine/gameEngine";
import type { PlayerId } from "../src/engine/types";
import { confirmRematch, startRoomMatch } from "../src/multiplayer/rematch";
import { buildSafeViewerState } from "../src/multiplayer/perspective";

const two: PlayerId[] = ["player", "cpu"];

function finishedRoom(players: PlayerId[] = two, pairs = false) {
  const engine = new TrucoEngine({ mode: pairs ? "2v2" : "1v1", targetScore: 12, withFlor: false });
  const state = startRoomMatch(engine, players, 7);
  state.scores.ellos = 11;
  engine.dispatch("player", { type: "IRSE_AL_MAZO" });
  expect(state.phase).toBe("MATCH_OVER");
  return engine;
}

test("La sala conserva el resultado hasta que ambos jugadores confirman la revancha", () => {
  const engine = finishedRoom();
  const result = engine.getState();
  expect(confirmRematch(engine, "cpu", 7, two, two)).toBe(true);
  expect(result.phase).toBe("MATCH_OVER");
  expect(result.scores.ellos).toBe(12);
  expect(buildSafeViewerState(result, "cpu").rematch?.confirmed).toEqual(["player"]);
  expect(confirmRematch(engine, "cpu", 7, two, two)).toBe(false);
  expect(confirmRematch(engine, "player", 7, two, two)).toBe(true);
  const next = engine.getState();
  expect(next.phase).toBe("PLAYING");
  expect(next.handNumber).toBe(1);
  expect(next.scores).toEqual({ nosotros: 0, ellos: 0 });
  expect(next.config).toEqual(result.config);
  expect(next.rematch).toEqual({ matchId: 8, players: two, confirmed: [] });
  expect(confirmRematch(engine, "player", 7, two, two)).toBe(false);
  next.scores.ellos = 11;
  engine.dispatch("player", { type: "IRSE_AL_MAZO" });
  expect(confirmRematch(engine, "player", 7, two, two)).toBe(false);
});

test("Una salida no convierte el asiento humano en CPU y una reconexión conserva el voto", () => {
  const engine = finishedRoom();
  confirmRematch(engine, "cpu", 7, two, two);
  const recovered = new TrucoEngine();
  recovered.loadExternalState(JSON.parse(JSON.stringify(engine.getState())));
  expect(confirmRematch(recovered, "player", 7, ["player"], ["player"])).toBe(false);
  expect(recovered.getState().rematch?.confirmed).toEqual(["cpu"]);
  expect(recovered.getState().phase).toBe("MATCH_OVER");
  expect(confirmRematch(recovered, "player", 7, two, two)).toBe(true);
});

test("En parejas solo cuentan los ocupantes humanos originales", () => {
  const humans: PlayerId[] = ["player", "partner", "cpu2"];
  const engine = finishedRoom(humans, true);
  expect(confirmRematch(engine, "cpu", 7, humans, humans)).toBe(false);
  for (const seat of humans) {
    expect(engine.getState().phase).toBe("MATCH_OVER");
    expect(confirmRematch(engine, seat, 7, humans, humans)).toBe(true);
  }
  expect(engine.getState().rematch?.players).toEqual(humans);
  expect(engine.getState().config.mode).toBe("2v2");
});

test("Una sala guardada en la versión anterior también puede confirmar", () => {
  const engine = finishedRoom();
  delete engine.getState().rematch;
  expect(confirmRematch(engine, "player", 0, two, two)).toBe(true);
  expect(engine.getState().rematch?.players).toEqual(two);
  expect(confirmRematch(engine, "cpu", 0, two, two)).toBe(true);
  expect(engine.getState().phase).toBe("PLAYING");
});
