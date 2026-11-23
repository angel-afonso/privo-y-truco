import { envidoLabel, envidoResponseLabel, GameState, PlayerAction, trucoCallLabel, TrucoLevel } from "../engine/types";

// La vista puede mover la carta propia antes de que el servidor o anfitrión resuelva la baza.
export function previewPlayerAction(state: GameState, action: PlayerAction): GameState {
  if (action.type !== "PLAY_CARD") return state;
  const hand = state.hands.player ?? [];
  const card = hand.find((item) => item.id === action.cardId);
  const trick = state.tricks[state.trickIndex];
  if (!card || !trick || trick.played.player || state.turn !== "player" || state.phase !== "PLAYING") {
    return state;
  }
  const played = {
    ...trick.played,
    player: { card, burned: Boolean(action.burned), order: Object.keys(trick.played).length },
  };
  return {
    ...state,
    hands: { ...state.hands, player: hand.filter((item) => item.id !== card.id) },
    tricks: state.tricks.map((entry, i) => i === state.trickIndex ? { ...trick, played } : entry),
  };
}

export function pendingActionLabel(action: PlayerAction, state: GameState, nextLevel?: TrucoLevel): string {
  switch (action.type) {
    case "PLAY_CARD": return action.burned ? "Quemando carta…" : "Jugando carta…";
    case "CALL_TRUCO": return trucoCallLabel(nextLevel ?? 1, state.phase === "AWAITING_TRUCO") + "…";
    case "CALL_ENVIDO": return envidoLabel(action.call, state.envido.chain.length > 0) + "…";
    case "CALL_FLOR": return "Flor…";
    case "CALL_A_LEY": return "A ley…";
    case "RESPOND_ENVIDO": return envidoResponseLabel(action.accept, state.ley.active) + "…";
    case "RESPOND_TRUCO": return action.accept ? "Quiero…" : "No quiero…";
    case "RESPOND_FLOR": return {
      quiero: "Quiero…", no_quiero: "No quiero…", achico: "Con flor no quiero…",
      contraflor: "Con flor envido…", contraflor_resto: "Con flor envido la falta…",
    }[action.choice];
    case "IRSE_AL_MAZO": return "Me voy…";
    case "NEXT_HAND": return "Repartiendo…";
  }
}
