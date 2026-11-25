import "./rulesDialog.css";

const rules = [
  ["LA VIRA Y PIEZAS", "La carta bajo el mazo define el palo de triunfo. El 11 de ese palo es el PERICO (carta suprema) y el 10 es la PERICA. Si la Vira es 11 o 10, el Rey (12) toma su lugar."],
  ["JERARQUÍA DEL TRUCO", "Perico > Perica > 1 Espadas (Espadilla) > 1 Bastos (Bastillo) > 7 Espadas > 7 Oros > 3 > 2 > 1 Copas/Oros > 12 > 11 > 10 > 7 Copas/Bastos > 6 > 5 > 4."],
  ["ESCALADA DEL TRUCO", "Sin truco (1) · Truco (3) · Retruco (6) · Vale Nueve (9) · Vale Juego. No querer paga el nivel anterior."],
  ["ENVIDO (solo 1.ª baza, antes de aceptar Truco)", "En parejas, quien conserve sus tres cartas puede abrir Envido ante un Truco. Cualquiera de los compañeros puede responder al envite abierto y vale la primera respuesta. Envido juega 2 piedras. Envido 5 piedras pone el total en 5, tanto al abrir como al subir. Envido la falta juega lo que le falta al equipo que va adelante. Rechazar la apertura cede 1 piedra y rechazar una subida cede la apuesta anterior. Dos cartas del mismo palo suman 20 + sus valores (figuras valen 0). Perico = 30 y Perica = 29 como comodines. Se resuelve y presenta al final de la mano."],
  ["PRIVE", "Si al repartir a un equipo le falta una piedra, el rival abre con «¿Cuánto privas?». Solo entonces se cantan los tantos de envido. En parejas cuenta el mejor de cada equipo y el empate favorece al más cercano a la mano. El prive vale una piedra. Si el rival lo gana y la partida sigue, canta «Privo y truco». Cuando ambos están a una, se pregunta al equipo de la mano y el prive decide la partida."],
  ["FLOR (anula Envido)", "3 del mismo palo o 2 + Perico/Perica (3 piedras). Entre flores rivales, «Con flor envido» juega 5 piedras en total. También se puede cantar «Con flor envido la falta». FLOR RESERVADA (Perico + Perica) = 5 piedras: nunca se canta «Flor Reservada» (se guarda callada hasta el final o se responde «¡Flor!» / «¡Con flor envido!»)."],
  ["CANTOS DE «A LEY» (quien no es Pie, 1.ª baza)", "Permite guardar Flor hasta antes de tu 2.ª carta o engañar sin tenerla."],
  ["BAZA PARDA", "Empate da ventaja a quien ganó la 1.ª baza. Si la 1.ª es parda, decide la 2.ª. Triple parda gana la Mano."],
];

export function createRulesDialog(): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = "rules-dialog";
  dialog.setAttribute("aria-labelledby", "table-rules-title");
  dialog.innerHTML = `<h2 id="table-rules-title">Reglas del Truco Venezolano</h2>
    <div class="rules-body" tabindex="0"></div>
    <form method="dialog"><button>Entendido</button></form>`;
  const body = dialog.querySelector<HTMLElement>(".rules-body")!;
  for (const [title, description] of rules) {
    const heading = document.createElement("h3");
    heading.textContent = title;
    const paragraph = document.createElement("p");
    paragraph.textContent = description;
    body.append(heading, paragraph);
  }
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener("close", () => { body.scrollTop = 0; });
  document.body.append(dialog);
  return dialog;
}
