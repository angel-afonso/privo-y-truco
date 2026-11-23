import { calculateFaltaEnvidoPoints, getTrucoAcceptPoints, getTrucoRejectPoints } from "../engine/evaluator";
import { TrucoEngine } from "../engine/gameEngine";
import { envidoLabel, PlayerAction, TRUCO_LEVEL_NAMES } from "../engine/types";

function piedras(n: number): string {
  return `${n} ${n === 1 ? "piedra" : "piedras"}`;
}

export function tableStake(engine: TrucoEngine) {
  const s = engine.getState();
  const base = getTrucoAcceptPoints(s.truco.level, s.scores, s.config.targetScore);
  const settlement: string[] = [];
  if (s.envido.pendingSettlement && s.envido.stakedPoints !== undefined) {
    settlement.push(`Envido al cierre · ${piedras(s.envido.stakedPoints)}`);
  }
  if (s.flor.pendingSettlement) {
    settlement.push(s.flor.stage === "flor" ? "Flor al cierre" : `Envite con flor al cierre · ${piedras(s.flor.stakedPoints ?? 6)}`);
  }
  const pending = (name: string, value: number) => ({
    name, value, status: "Por aceptar", detail: [`Mano en juego · ${piedras(base)}`, ...settlement].join(" / "),
  });
  if (s.phase === "AWAITING_TRUCO" && s.truco.pendingLevel) {
    const level = s.truco.pendingLevel;
    return pending(TRUCO_LEVEL_NAMES[level], getTrucoAcceptPoints(level, s.scores, s.config.targetScore));
  }
  if (s.phase === "AWAITING_ENVIDO") {
    const chain = s.envido.chain;
    const last = chain[chain.length - 1];
    return pending(envidoLabel(last, chain.length > 1), engine.getEnvidoStakes(chain).accept);
  }
  if (s.phase === "AWAITING_FLOR" && s.flor.stage !== "flor") {
    return s.flor.stage === "contraflor_resto"
      ? pending("Con flor envido la falta", s.flor.stakedPoints ?? calculateFaltaEnvidoPoints(s.scores, s.config))
      : pending("Con flor envido", s.flor.stakedPoints ?? 6);
  }
  if (s.phase === "AWAITING_FLOR") settlement.push("Flor por responder");
  if (s.ley.active) settlement.push("A ley");
  return {
    name: s.truco.level ? TRUCO_LEVEL_NAMES[s.truco.level] : "Mano",
    value: base, status: "En juego",
    detail: settlement.join(" / ") || ["Primera baza", "Segunda baza", "Tercera baza"][s.trickIndex],
  };
}

export interface TableChoice {
  label: string;
  detail?: string;
  tone: "lead" | "call" | "quiet";
  action: PlayerAction | { type: "TOGGLE_BURN" };
}

export function tableChoices(engine: TrucoEngine, burnMode: boolean): TableChoice[] {
  const s = engine.getState();
  const legal = engine.getLegalActions("player");
  const choices: TableChoice[] = [];
  const add = (label: string, tone: TableChoice["tone"], action: TableChoice["action"], detail?: string) =>
    choices.push({ label, tone, action, detail });
  const stake = tableStake(engine);
  if (legal.canRespondTruco && s.truco.pendingLevel) {
    add("Quiero", "lead", { type: "RESPOND_TRUCO", accept: true }, piedras(stake.value));
    add("No quiero", "quiet", { type: "RESPOND_TRUCO", accept: false }, `Cedes ${getTrucoRejectPoints(s.truco.pendingLevel)}`);
  }
  if (legal.canRespondEnvido) {
    add("Quiero", "lead", { type: "RESPOND_ENVIDO", accept: true }, piedras(stake.value));
    add("No quiero", "quiet", { type: "RESPOND_ENVIDO", accept: false }, `Cedes ${engine.getEnvidoStakes(s.envido.chain).reject}`);
  }
  for (const choice of legal.florResponses) {
    const rest = calculateFaltaEnvidoPoints(s.scores, s.config);
    const options = {
      quiero: ["Con flor quiero", piedras(stake.value)],
      no_quiero: ["No quiero", `Cedes ${s.flor.rejectPoints ?? (s.flor.stage === "contraflor_resto" ? 6 : 4)}`],
      achico: ["Con flor no quiero", "Cedes 4"],
      contraflor: ["Con flor envido", piedras(5)],
      contraflor_resto: ["Con flor envido la falta", piedras(rest)],
    };
    const [label, detail] = options[choice];
    add(label, choice === "quiero" ? "lead" : choice === "achico" || choice === "no_quiero" ? "quiet" : "call",
      { type: "RESPOND_FLOR", choice }, detail);
  }
  if (legal.canCallFlor) add(legal.mustCallFlorALey ? "Flor a ley" : "Flor", "lead", { type: "CALL_FLOR" });
  if (legal.canCallTruco && legal.nextTrucoLevel) {
    const level = legal.nextTrucoLevel;
    add(TRUCO_LEVEL_NAMES[level], choices.some(c => c.tone === "lead") ? "call" : "lead", { type: "CALL_TRUCO" },
      piedras(getTrucoAcceptPoints(level, s.scores, s.config.targetScore)));
  }
  for (const call of legal.envidoCalls) {
    const label = envidoLabel(call, s.envido.chain.length > 0);
    add(label, "call", { type: "CALL_ENVIDO", call }, piedras(engine.getEnvidoStakes([...s.envido.chain, call]).accept));
  }
  if (legal.canCallALey) add("A ley", "call", { type: "CALL_A_LEY" });
  if (legal.canBurnCard) add(burnMode ? "Cancelar quema" : "Quemar", burnMode ? "lead" : "quiet", { type: "TOGGLE_BURN" });
  if (legal.canIrseAlMazo) add("Al mazo", "quiet", { type: "IRSE_AL_MAZO" });
  return choices;
}
