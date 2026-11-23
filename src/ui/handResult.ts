import type { Card } from "../engine/types";
import "./handResult.css";

export interface RevealedHand {
  label: string;
  cards: Card[];
  winner: boolean;
}

interface ResultSheet {
  hand: number;
  target: number;
  title: string;
  matchOver: boolean;
  scores: { label: string; value: number }[];
  notes: string[];
  reason: string;
  points: number;
  reveals: RevealedHand[];
  vira: Card;
}

export class HandResult {
  private root = document.createElement("section");
  private content = document.createElement("div");
  private primary = document.createElement("button");
  private menu = document.createElement("button");
  private current = "";

  constructor(parent: HTMLElement, onContinue: () => void, onMenu: () => void) {
    this.root.className = "hand-result";
    this.root.hidden = true;
    this.root.setAttribute("aria-labelledby", "hand-result-title");
    this.content.className = "hr-content";
    const actions = document.createElement("footer");
    this.primary.type = this.menu.type = "button";
    this.primary.onclick = onContinue;
    this.menu.textContent = "Menú";
    this.menu.onclick = onMenu;
    actions.append(this.menu, this.primary);
    this.root.append(this.content, actions);
    parent.append(this.root);
  }

  centerOn(x: number, y: number): void {
    this.root.style.setProperty("--result-x", `${x}px`);
    this.root.style.setProperty("--result-y", `${y}px`);
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.content.replaceChildren();
    this.current = "";
  }

  show(sheet: ResultSheet, action: string, enabled: boolean, draw: (cards: Card[]) => HTMLCanvasElement): void {
    const key = JSON.stringify(sheet);
    if (key !== this.current) {
      const el = (tag: string, text: string) => {
        const node = document.createElement(tag);
        node.textContent = text;
        return node;
      };
      const meta = document.createElement("header");
      meta.append(el("span", `Mano ${sheet.hand}`), el("span", `A ${sheet.target} piedras`));
      const heading = el("h2", sheet.title);
      heading.id = "hand-result-title";
      heading.setAttribute("aria-live", "polite");
      const score = document.createElement("dl");
      score.setAttribute("aria-label", "Marcador de la partida");
      for (const side of sheet.scores) {
        const pair = document.createElement("div");
        pair.append(el("dt", side.label), el("dd", String(side.value)));
        score.append(pair);
      }
      this.content.replaceChildren(meta, heading, score);
      for (const note of sheet.notes) this.content.append(el("p", note));
      if (sheet.reason) {
        const detail = document.createElement("p");
        detail.className = "hr-award";
        detail.append(el("span", sheet.reason));
        if (sheet.points) detail.append(el("strong", `+${sheet.points} ${sheet.points === 1 ? "piedra" : "piedras"}`));
        this.content.append(detail);
      }
      if (sheet.reveals.length) {
        const hands = document.createElement("div");
        hands.className = "hr-reveals";
        for (const { cards, label, winner } of sheet.reveals) {
          const figure = document.createElement("figure");
          const caption = el("figcaption", label);
          if (winner) caption.className = "hr-winning-hand";
          figure.append(caption);
          if (cards.length) figure.append(draw(cards));
          hands.append(figure);
        }
        this.content.append(hands);
      }
      this.current = key;
      this.content.scrollTop = 0;
    }
    this.menu.hidden = !sheet.matchOver;
    this.primary.textContent = action;
    this.primary.disabled = !enabled;
    this.root.hidden = false;
  }
}
