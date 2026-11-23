import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { TrucoEngine } from "../src/engine/gameEngine";
import { buildSafeViewerState } from "../src/multiplayer/perspective";
import { soundFX } from "../src/ui/sound";

afterEach(() => mock.restore());

test("Suena la carta del rival aunque el último evento sea el resultado de la baza", () => {
  const engine = new TrucoEngine({ withFlor: false });
  const s = engine.startNewMatch(undefined, "player");
  engine.dispatch("player", { type: "PLAY_CARD", cardId: s.hands.player![0].id });
  const previous = buildSafeViewerState(s, "player");
  engine.dispatch("cpu", { type: "PLAY_CARD", cardId: s.hands.cpu![0].id });
  const current = buildSafeViewerState(s, "player");
  expect(current.lastEvent?.type).toBe("trick_win");
  const slap = spyOn(soundFX, "playCardSlap").mockImplementation(() => {});
  soundFX.playOnlineUpdate(previous, current, false);
  soundFX.playOnlineUpdate(current, current, false);
  soundFX.playOnlineUpdate(undefined, current, false);
  expect(slap).toHaveBeenCalledTimes(1);
});

test("El invitado oye el canto del anfitrión y el anfitrión oye la respuesta", () => {
  const engine = new TrucoEngine({ withFlor: false });
  const s = engine.startNewMatch(undefined, "player");
  const guest = buildSafeViewerState(s, "cpu");
  engine.dispatch("player", { type: "CALL_TRUCO" });
  const host = buildSafeViewerState(s, "player");
  const call = spyOn(soundFX, "playCall").mockImplementation(() => {});
  soundFX.playOnlineUpdate(guest, buildSafeViewerState(s, "cpu"), true);
  engine.dispatch("cpu", { type: "RESPOND_TRUCO", accept: true });
  soundFX.playOnlineUpdate(host, buildSafeViewerState(s, "player"), true);
  expect(call.mock.calls).toEqual([[], [true]]);
});
