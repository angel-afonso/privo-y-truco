import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { TrucoEngine } from "../src/engine/gameEngine";
import { buildSafeViewerState } from "../src/multiplayer/perspective";
import { soundFX } from "../src/ui/sound";
import { cantos, cantoTakes, cantoAudioPath, eventCanto, nextCantoTake } from "../src/ui/cantos";

afterEach(() => mock.restore());

test("El envite querido se concede con «Son buenas» al comparar los tantos, incluso si decide la partida", () => {
  for (const call of ["envido", "envido_cinco", "falta_envido"] as const) {
    const engine = new TrucoEngine({ withFlor: false });
    const s = engine.startNewMatch();
    engine.dispatch("player", { type: "CALL_ENVIDO", call });
    engine.dispatch("cpu", { type: "RESPOND_ENVIDO", accept: true });
    expect(s.log.map(eventCanto)).not.toContain("son-buenas");
    const before = buildSafeViewerState(s, "cpu");
    engine.dispatch("player", { type: "IRSE_AL_MAZO" });
    const concessions = s.log.filter(event => eventCanto(event) === "son-buenas");
    expect(concessions.map(event => event.actor)).toEqual([s.envido.winnerTeam === "nosotros" ? "cpu" : "player"]);
    if (call === "falta_envido") expect(s.phase).toBe("MATCH_OVER");
    const after = buildSafeViewerState(s, "cpu");
    const voice = spyOn(soundFX, "playCanto").mockImplementation(() => {});
    soundFX.playOnlineUpdate(before, after, false);
    soundFX.playOnlineUpdate(after, after, false);
    expect(voice.mock.calls.flat()).toEqual(["me-voy", "son-buenas"]);
    voice.mockRestore();
  }
});

test("El prive usa la misma voz para cualquier tanto y preserva el canto de truco", () => {
  const event = { id: 1, actor: "player", type: "response", text: "" } as const;
  for (const value of [0, 5, 31, 37]) {
    expect(eventCanto({ ...event, bubble: `Privo ${value}` })).toBe("privo");
  }
  expect(eventCanto({ ...event, type: "call", bubble: "¿Cuánto privas?" })).toBe("cuanto-privas");
  expect(eventCanto({ ...event, type: "call", bubble: "¡PRIVO Y TRUCO!" })).toBe("privo-y-truco");
  expect(eventCanto({ ...event, bubble: "Son buenas" })).toBe("son-buenas");
});

test("La subida dice «quiero y» solo al responder directamente al truco", () => {
  const raises = [
    ["retruco-solo", "quiero-y-retruco"],
    ["vale-nueve", "quiero-y-vale-nueve"],
    ["vale-juego", "quiero-y-vale-juego"],
  ] as const;
  for (const [index, [later, direct]] of raises.entries()) {
    for (const acceptFirst of [false, true]) {
      const engine = new TrucoEngine({ withFlor: false });
      const state = engine.startNewMatch(undefined, "player");
      engine.dispatch("player", { type: "CALL_TRUCO" });
      for (let i = 0; i < index; i++) engine.dispatch(state.truco.responder!, { type: "CALL_TRUCO" });
      const actor = state.truco.responder!;
      if (acceptFirst) {
        engine.dispatch(actor, { type: "RESPOND_TRUCO", accept: true });
        if (state.turn !== actor) engine.dispatch(state.turn, { type: "PLAY_CARD", cardId: state.hands[state.turn]![0].id });
      }
      engine.dispatch(actor, { type: "CALL_TRUCO" });
      expect(eventCanto(state.lastEvent!)).toBe(acceptFirst ? later : direct);
    }
  }
});

test("La retirada se oye como «Me voy» aunque el mismo movimiento cierre la mano", () => {
  const engine = new TrucoEngine({ withFlor: false });
  const state = engine.startNewMatch(undefined, "player");
  engine.dispatch("player", { type: "IRSE_AL_MAZO" });
  expect(state.log.map(eventCanto).filter(Boolean)).toEqual(["me-voy"]);
});

test("Cada canto tiene tres tomas locales y la siguiente excluye la anterior", async () => {
  for (const take of cantoTakes) {
    for (const random of [0, 0.99999]) {
      spyOn(Math, "random").mockReturnValue(random);
      expect(nextCantoTake(take)).not.toBe(take);
    }
    for (const id of Object.keys(cantos)) {
      const file = Bun.file(new URL(`../public/${cantoAudioPath}/${id}.${take}.mp3`, import.meta.url));
      expect(file.size).toBeGreaterThan(500);
    }
  }
});

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

test("Los cantos en línea usan la frase pública y conservan la respuesta aunque se cierre la mano", () => {
  const engine = new TrucoEngine({ withFlor: false });
  const state = engine.startNewMatch(undefined, "player");
  const before = buildSafeViewerState(state, "cpu");
  const voice = spyOn(soundFX, "playCanto").mockImplementation(() => {});
  engine.dispatch("player", { type: "CALL_ENVIDO", call: "envido_cinco" });
  engine.dispatch("cpu", { type: "RESPOND_ENVIDO", accept: false });
  engine.dispatch("player", { type: "CALL_TRUCO" });
  engine.dispatch("cpu", { type: "RESPOND_TRUCO", accept: false });
  const after = buildSafeViewerState(state, "cpu");
  soundFX.playOnlineUpdate(before, after, false);
  soundFX.playOnlineUpdate(after, after, false);
  soundFX.playOnlineUpdate(undefined, after, false);
  expect(voice.mock.calls.flat()).toEqual(["envido-cinco", "no-quiero", "truco", "no-quiero"]);
});

test("No duplica el efecto sonoro de una jugada propia ya reproducida de forma optimista", () => {
  const engine = new TrucoEngine({ withFlor: false });
  const state = engine.startNewMatch(undefined, "player");
  const before = buildSafeViewerState(state, "player");
  engine.dispatch("player", { type: "PLAY_CARD", cardId: state.hands.player![0].id });
  const after = buildSafeViewerState(state, "player");
  const slap = spyOn(soundFX, "playCardSlap").mockImplementation(() => {});
  soundFX.playOnlineUpdate(before, after, false, true);
  expect(slap).not.toHaveBeenCalled();
});
