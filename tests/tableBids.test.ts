import { describe, expect, test } from "bun:test";
import { TrucoEngine } from "../src/engine/gameEngine";
import { tableChoices, tableStake } from "../src/ui/tableBids";

describe("Piedras que se muestran en la mesa", () => {
  test("Truco y Retruco distinguen el valor ofrecido del ya pactado", () => {
    const e = new TrucoEngine({ withFlor: false });
    e.startNewMatch(undefined, "cpu");
    e.dispatch("cpu", { type: "CALL_TRUCO" });
    expect(tableStake(e)).toMatchObject({ name: "Truco", value: 3, status: "Por aceptar", detail: "Mano en juego · 1 piedra" });
    const choices = tableChoices(e, false);
    expect(choices.find(c => c.label === "No quiero")?.detail).toBe("Cedes 1");
    expect(choices.find(c => c.label === "Retruco")?.detail).toBe("6 piedras");
    e.dispatch("player", { type: "CALL_TRUCO" });
    expect(tableStake(e)).toMatchObject({ name: "Retruco", value: 6, detail: "Mano en juego · 3 piedras" });
    e.dispatch("cpu", { type: "RESPOND_TRUCO", accept: true });
    expect(tableStake(e)).toMatchObject({ value: 6, status: "En juego" });
  });

  test("El envido no querido se mantiene al cierre sin sumarse al truco", () => {
    const e = new TrucoEngine({ withFlor: false });
    e.startNewMatch(undefined, "cpu");
    e.dispatch("cpu", { type: "CALL_ENVIDO", call: "envido" });
    expect(tableChoices(e, false).find(c => c.label === "Envido 5 piedras")?.detail).toBe("5 piedras");
    e.dispatch("player", { type: "RESPOND_ENVIDO", accept: false });
    expect(tableStake(e)).toMatchObject({ value: 1, detail: "Envido al cierre · 1 piedra" });
    e.dispatch("cpu", { type: "CALL_TRUCO" });
    expect(tableStake(e).detail).toContain("Envido al cierre · 1 piedra");
  });

  test("Envido 5 piedras vale cinco tanto de entrada como sobre dos o cuatro", () => {
    for (const previas of [0, 1, 2]) {
      for (const accept of [false, true]) {
        const e = new TrucoEngine({ withFlor: false });
        e.startNewMatch(undefined, "player");
        const seats = ["player", "cpu"] as const;
        for (let i = 0; i < previas; i++) e.dispatch(seats[i % 2], { type: "CALL_ENVIDO", call: "envido" });
        const actor = seats[previas % 2], rival = seats[(previas + 1) % 2];
        expect(e.getLegalActions(actor).envidoCalls).not.toContain("real_envido");
        e.dispatch(actor, { type: "CALL_ENVIDO", call: "envido_cinco" });
        expect(tableStake(e)).toMatchObject({ name: "Envido 5 piedras", value: 5 });
        expect(e.getState().lastEvent?.bubble).toBe("¡ENVIDO 5 PIEDRAS!");
        expect(e.getLegalActions(rival).envidoCalls).toEqual(["falta_envido"]);
        e.dispatch(rival, { type: "RESPOND_ENVIDO", accept });
        const points = accept ? 5 : Math.max(1, 2 * previas);
        expect(e.getState().envido.stakedPoints).toBe(points);
        e.dispatch("player", { type: "IRSE_AL_MAZO" });
        expect(e.getState().envido.pointsAwarded).toBe(points);
      }
    }
  });

  test("Rechazar la falta tras envidar cinco cede cinco piedras", () => {
    const e = new TrucoEngine({ withFlor: false });
    e.startNewMatch(undefined, "player");
    e.dispatch("player", { type: "CALL_ENVIDO", call: "envido_cinco" });
    e.dispatch("cpu", { type: "CALL_ENVIDO", call: "falta_envido" });
    expect(tableChoices(e, false).find(c => c.label === "No quiero")?.detail).toBe("Cedes 5");
    e.dispatch("player", { type: "RESPOND_ENVIDO", accept: false });
    expect(e.getState().envido.stakedPoints).toBe(5);
    expect(e.getEnvidoStakes(["real_envido"])).toEqual({ accept: 3, reject: 1 });
  });

  test("Con flor envido juega cinco y al rechazar la falta cuenta la apuesta previa", () => {
    for (const direct of [false, true]) {
      const e = new TrucoEngine({ targetScore: 24 });
      const s = e.startNewMatch();
      s.scores = { nosotros: 4, ellos: 9 };
      s.phase = "AWAITING_FLOR";
      s.flor = { stage: "flor", resolved: false, caller: "cpu", responder: "player", pointsAwarded: 0 };
      if (!direct) {
        e.dispatch("player", { type: "RESPOND_FLOR", choice: "contraflor" });
        expect(tableStake(e)).toMatchObject({ name: "Con flor envido", value: 5 });
        expect(s.lastEvent?.bubble).toBe("¡CON FLOR ENVIDO!");
      }
      e.dispatch(direct ? "player" : "cpu", { type: "RESPOND_FLOR", choice: "contraflor_resto" });
      expect(tableStake(e)).toMatchObject({ name: "Con flor envido la falta", value: 15 });
      e.dispatch(direct ? "cpu" : "player", { type: "RESPOND_FLOR", choice: "no_quiero" });
      expect(s.flor.pointsAwarded).toBe(direct ? 4 : 5);
    }
  });

  test("Una apuesta de flor guardada conserva las piedras que ya se ofrecieron", () => {
    const e = new TrucoEngine({ targetScore: 24 });
    const state = e.startNewMatch();
    state.scores = { nosotros: 4, ellos: 9 };
    state.phase = "AWAITING_FLOR";
    state.flor = { resolved: false, stage: "contraflor", caller: "cpu", responder: "player", pointsAwarded: 0 };
    expect(tableStake(e)).toMatchObject({ name: "Con flor envido", value: 6 });
    expect(tableChoices(e, false).find(c => c.label === "No quiero")?.detail).toBe("Cedes 4");
    state.flor.stage = "contraflor_resto";
    expect(tableStake(e)).toMatchObject({ name: "Con flor envido la falta", value: 15 });
    expect(tableChoices(e, false).find(c => c.label === "No quiero")?.detail).toBe("Cedes 6");
  });

  test("La falta envido depende del tanteo y la flor reservada se mantiene privada", () => {
    const e = new TrucoEngine({ withFlor: false, targetScore: 24 });
    const state = e.startNewMatch();
    state.scores = { nosotros: 5, ellos: 11 };
    const falta = tableChoices(e, false).find(c => c.label === "Envido la falta");
    expect(falta?.detail).toBe("13 piedras");
    state.flor = { resolved: true, stage: "flor", pendingSettlement: true, stakedPoints: 5, pointsAwarded: 0 };
    expect(tableStake(e).detail).toBe("Flor al cierre");
  });
});
