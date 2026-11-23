import { getSeatsForMode } from "../engine/types";
import type { PublicRoom } from "../multiplayer/roomClient";
import "./roomDirectory.css";

interface DirectoryActions {
  list: () => Promise<PublicRoom[]>;
  join: (room: PublicRoom) => void;
  create: () => void;
  code: () => void;
  solo: () => void;
}

export class RoomDirectory {
  private root = document.createElement("section");
  private list: HTMLElement;
  private notice: HTMLElement;
  private refreshButton: HTMLButtonElement;
  private timer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private opener: HTMLElement | null = null;

  constructor(cards: HTMLCanvasElement, private actions: DirectoryActions) {
    this.root.className = "room-home";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="room-book wrap">
        <header class="room-cover">
          <h1>Truco<br>venezolano</h1>
          <div class="room-hand" aria-hidden="true"></div>
          <button class="room-solo">Jugar solo <span aria-hidden="true">→</span></button>
        </header>
        <section class="room-page" aria-labelledby="open-room-title">
          <div class="room-heading">
            <h2 id="open-room-title">Salas abiertas</h2>
            <button class="room-refresh" aria-label="Actualizar salas" title="Actualizar salas">↻</button>
          </div>
          <p class="room-notice" role="status"></p>
          <ul class="room-list" aria-label="Mesas con puestos libres"></ul>
          <div class="room-actions">
            <button class="room-create">Crear sala</button>
            <button class="room-code">Entrar con código</button>
          </div>
        </section>
      </div>`;
    this.root.querySelector(".room-hand")!.append(cards);
    this.list = this.root.querySelector(".room-list")!;
    this.notice = this.root.querySelector(".room-notice")!;
    this.refreshButton = this.root.querySelector(".room-refresh")!;
    this.refreshButton.onclick = () => void this.refresh();
    this.root.querySelector<HTMLButtonElement>(".room-solo")!.onclick = actions.solo;
    this.root.querySelector<HTMLButtonElement>(".room-create")!.onclick = actions.create;
    this.root.querySelector<HTMLButtonElement>(".room-code")!.onclick = actions.code;
    (document.getElementById("app") ?? document.body).append(this.root);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && !this.root.hidden && !this.root.inert) void this.refresh();
    });
  }

  public suspend(): void {
    this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.inert = true;
  }

  public show(): void {
    const suspended = this.root.inert;
    this.root.inert = false;
    if (!this.root.hidden) {
      if (suspended) {
        this.opener?.focus({ preventScroll: true });
        void this.refresh();
      }
      return;
    }
    this.root.hidden = false;
    this.list.replaceChildren();
    this.notice.textContent = "Buscando mesas…";
    void this.refresh();
    this.timer = setInterval(() => {
      if (!document.hidden && !this.root.inert) void this.refresh();
    }, 8000);
  }

  public hide(): void {
    this.root.hidden = true;
    this.generation++;
    this.refreshButton.disabled = false;
    clearInterval(this.timer);
  }

  private async refresh(): Promise<void> {
    if (this.refreshButton.disabled) return;
    const generation = this.generation;
    this.refreshButton.disabled = true;
    try {
      const rooms = await this.actions.list();
      if (this.generation !== generation) return;
      const focusedCode = (document.activeElement as HTMLElement | null)?.dataset.room;
      this.list.replaceChildren(...rooms.map(room => {
        const item = document.createElement("li");
        const join = document.createElement("button");
        join.className = "room-row";
        join.dataset.room = room.code;
        join.innerHTML = '<span class="room-details"><strong></strong><small></small></span><span class="room-seats"></span><span aria-hidden="true">→</span>';
        const capacity = getSeatsForMode(room.config.mode).length;
        const title = `Mesa de ${room.host}`;
        join.querySelector("strong")!.textContent = title;
        join.querySelector("small")!.textContent = `${capacity === 2 ? "Individual" : "Por parejas"} · ${room.config.targetScore} piedras · ${room.config.withFlor ? "Con flor" : "Sin flor"}`;
        join.querySelector(".room-seats")!.textContent = `${room.occupied}/${capacity}`;
        join.setAttribute("aria-label", `Unirse a ${title}, ${room.occupied} de ${capacity} puestos ocupados`);
        join.onclick = () => this.actions.join(room);
        item.append(join);
        return item;
      }));
      if (focusedCode) Array.from(this.list.querySelectorAll("button"))
        .find(b => b.dataset.room === focusedCode)?.focus({ preventScroll: true });
      this.notice.textContent = rooms.length ? "" : "Todavía no hay mesas abiertas. Puedes crear la primera.";
    } catch {
      if (this.generation !== generation) return;
      this.list.replaceChildren();
      this.notice.textContent = "No se pudieron cargar las salas. Vuelve a actualizar.";
    } finally {
      if (this.generation === generation) this.refreshButton.disabled = false;
    }
  }
}
