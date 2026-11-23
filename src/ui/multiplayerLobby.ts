import "./waitingTable.css";
import { FONT_DISPLAY } from "./theme";
import { mapSeatToViewer } from "../multiplayer/perspective";
import { GameConfig, getSeatsForMode, PlayerId } from "../engine/types";
import { normalizeRoomCode, PublicRoom, RoomMember, RoomVisibility } from "../multiplayer/roomClient";

export interface MultiplayerLobbyCallbacks {
  onCreateRoom: (name: string, config: GameConfig, visibility: RoomVisibility) => Promise<void>;
  onJoinRoom: (code: string, name: string, publicEntry: boolean) => Promise<void>;
  onUpdateConfig: (config: GameConfig) => void;
  onClaimSeat: (seat: PlayerId) => void;
  onStartOnlineMatch: () => void;
  onLeaveRoom: () => Promise<void>;
  onChatSlot: (slot: HTMLElement) => void;
  onTableViewChange: (waiting: boolean) => void;
  onClose: () => void;
}

type LobbyIntent = { type: "create" | "code" } | { type: "public"; room: PublicRoom };

const STORAGE_NAME_KEY = "truco_venezolano_nickname";

const LOBBY_STYLES = `
.truco-access { border: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 16px 0; }
.truco-access label { display: block; padding: 12px; border: 1px solid #547765; border-radius: 5px; cursor: pointer; font-size: 14px; }
.truco-access label:has(:checked) { border-color: #dfbd78; background: #27392b; }
.truco-access input { accent-color: #dfbd78; }
.truco-access small { display: block; color: #d1d9ce; margin-top: 5px; }
.truco-mp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 14px;
  background: rgba(5, 14, 10, 0.8);
  backdrop-filter: blur(4px);
  font-family: "Plus Jakarta Sans", system-ui, -apple-system, sans-serif;
  color: #f4efe4;
}
.truco-mp-backdrop.open {
  display: flex;
}
.truco-mp-card {
  width: 100%;
  max-width: 464px;
  max-height: calc(100dvh - 28px);
  overscroll-behavior: contain;
  overflow-y: auto;
  background: #0d251b;
  border: 1.5px solid rgba(214, 166, 69, 0.78);
  border-radius: 16px;
  box-shadow: 0 22px 54px rgba(0, 0, 0, 0.56), inset 0 0 0 6px rgba(214, 166, 69, 0.08);
  padding: 20px;
}
.truco-mp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.truco-mp-title {
  font-family: "Fraunces", Georgia, serif;
  font-size: 21px;
  font-weight: 700;
  color: #f8f1e1;
  letter-spacing: 0.2px;
}
.truco-mp-sub {
  font-size: 12px;
  color: #bcd1c4;
  margin-top: 2px;
}
.truco-mp-close {
  width: 44px;
  height: 44px;
  border-radius: 9px;
  border: 1px solid #284d3c;
  background: #0a1e16;
  color: #bcd1c4;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.truco-mp-close:hover {
  background: #133024;
  color: #f4efe4;
}
.truco-mp-label {
  display: block;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.9px;
  text-transform: uppercase;
  color: #7e9e8c;
  margin-bottom: 6px;
}
.truco-mp-input {
  width: 100%;
  height: 44px;
  border-radius: 10px;
  border: 1px solid #284d3c;
  background: #06150f;
  color: #f4efe4;
  font-family: inherit;
  font-size: 16px;
  font-weight: 600;
  padding: 0 13px;
  outline: none;
  user-select: text;
  -webkit-user-select: text;
}
.truco-mp-input:focus {
  border-color: #d6a645;
}
.truco-mp-input.code {
  text-transform: uppercase;
  letter-spacing: 2.5px;
  font-family: "Fraunces", Georgia, serif;
  font-size: 16px;
}
.truco-mp-btn {
  height: 44px;
  border-radius: 10px;
  border: 1px solid transparent;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: background 120ms ease, transform 80ms ease;
}
.truco-mp-btn:active {
  transform: translateY(1px);
}
.truco-mp-btn:disabled {
  opacity: 0.48;
  cursor: default;
}
.truco-mp-btn.primary {
  background: #d6a645;
  border-color: #f4dca0;
  color: #1b120a;
}
.truco-mp-btn.primary:hover:not(:disabled) {
  background: #e3b85b;
}
.truco-mp-btn.secondary {
  background: #133024;
  border-color: rgba(158, 121, 50, 0.7);
  color: #f4efe4;
}
.truco-mp-btn.secondary:hover:not(:disabled) {
  background: #1b4031;
}
.truco-mp-btn.ghost {
  background: #0a1e16;
  border-color: #284d3c;
  color: #bcd1c4;
}
.truco-mp-btn.ghost:hover:not(:disabled) {
  background: #133024;
  color: #f4efe4;
}
.truco-mp-btn.full {
  width: 100%;
}
.truco-mp-status {
  font-size: 12px;
  color: #bcd1c4;
  background: #06150f;
  border: 1px solid #395346;
  border-radius: 8px;
  padding: 9px 12px;
  margin-bottom: 14px;
}
.truco-mp-status.error {
  background: #321e24;
  border-color: #765058;
  color: #f8d2d5;
}
`;

/**
 * Lobby HTML ligero estilizado con el mismo sistema «Club de Truco» (caoba, fieltro y latón).
 * Se oculta automáticamente en cuanto inicia la partida en el lienzo PixiJS.
 */
export class MultiplayerLobby {
  private root: HTMLDivElement;
  private card: HTMLDivElement;
  private callbacks: MultiplayerLobbyCallbacks;

  private isOpen = false;
  private roomCode: string | null = null;
  private isHost = false;
  private myClientId = "";
  private mySeat: PlayerId | null = null;
  private members: RoomMember[] = [];
  private config: GameConfig = { mode: "2v2", targetScore: 24, withFlor: true };
  private statusText = "";
  private isError = false;
  private busy = false;
  private nameValue = "";
  private codeInputValue = "";
  private inviteCode: string | null = null;
  private copyMessage = "";
  private waitingMarkup = "";
  private visibility: RoomVisibility = "private";
  private intent: LobbyIntent = { type: "create" };

  constructor(callbacks: MultiplayerLobbyCallbacks) {
    this.callbacks = callbacks;
    this.injectStyles();

    const savedName =
      typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_NAME_KEY) : null;
    this.nameValue = savedName || "";

    const params =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const urlCode = params?.get("sala");
    if (urlCode) {
      this.codeInputValue = normalizeRoomCode(urlCode);
    }

    this.root = document.createElement("div");
    this.root.className = "truco-mp-backdrop";
    this.root.style.setProperty("--table-display", FONT_DISPLAY);
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root && !this.roomCode && !this.busy) {
        this.close();
        this.callbacks.onClose();
      }
    });

    this.card = document.createElement("div");
    this.card.className = "truco-mp-card";
    this.card.setAttribute("role", "dialog");
    this.card.setAttribute("aria-modal", "true");
    this.card.setAttribute("aria-labelledby", "truco-lobby-title");
    this.root.addEventListener("keydown", event => {
      if (event.key === "Escape" && !this.busy && !this.roomCode) {
        this.close();
        this.callbacks.onClose();
      }
    });
    this.root.appendChild(this.card);
    document.body.appendChild(this.root);
    this.render();
  }

  private injectStyles(): void {
    if (document.getElementById("truco-mp-styles")) return;
    const style = document.createElement("style");
    style.id = "truco-mp-styles";
    style.textContent = LOBBY_STYLES;
    document.head.appendChild(style);
  }

  public hasPendingUrlCode(): boolean {
    return this.codeInputValue.length >= 4;
  }

  public open(initialConfig?: GameConfig, intent: LobbyIntent = { type: "create" }): void {
    this.intent = intent;
    this.statusText = "";
    this.isError = false;
    this.busy = false;
    if (initialConfig && !this.roomCode) {
      this.config = { ...initialConfig };
    }
    this.isOpen = true;
    this.root.classList.add("open");
    this.render();
    this.card.querySelector<HTMLInputElement>("#truco-mp-name")?.focus();
  }

  public close(): void {
    this.isOpen = false;
    this.root.classList.remove("open");
    this.setTableView(false);
  }

  public setRoomState(params: {
    roomCode: string | null;
    visibility: RoomVisibility;
    inviteCode: string | null;
    isHost: boolean;
    myClientId: string;
    mySeat: PlayerId | null;
    members: RoomMember[];
    config: GameConfig;
  }): void {
    if (params.roomCode && this.roomCode !== params.roomCode) {
      this.codeInputValue = "";
      const url = new URL(window.location.href);
      if (url.searchParams.has("sala")) {
        url.searchParams.delete("sala");
        window.history.replaceState(window.history.state, "", url);
      }
    }
    this.roomCode = params.roomCode;
    const inviteCode = params.isHost ? params.inviteCode : null;
    if (this.inviteCode !== inviteCode) this.copyMessage = "";
    this.inviteCode = inviteCode;
    this.isHost = params.isHost;
    this.myClientId = params.myClientId;
    this.mySeat = params.mySeat;
    this.members = params.members;
    if (params.roomCode) {
      this.config = { ...params.config };
      this.visibility = params.visibility;
    }
    if (this.isOpen) this.render();
  }

  public setStatus(text: string, isError = false, busy = false): void {
    this.statusText = text;
    this.isError = isError;
    this.busy = busy;
    if (this.isOpen) this.render();
  }

  private setTableView(waiting: boolean): void {
    if (this.root.classList.contains("at-table") === waiting) return;
    this.root.classList.toggle("at-table", waiting);
    this.card.setAttribute("role", waiting ? "region" : "dialog");
    if (waiting) this.card.removeAttribute("aria-modal");
    else this.card.setAttribute("aria-modal", "true");
    this.waitingMarkup = "";
    this.callbacks.onTableViewChange(waiting);
  }

  private render(): void {
    const closeSvg = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>`;

    this.setTableView(Boolean(this.roomCode && this.isOpen));
    if (!this.roomCode) {
      const creating = this.intent.type === "create";
      const selected = this.intent.type === "public" ? this.intent.room : null;
      const title = creating ? "Crear sala" : selected ? `Mesa de ${this.escapeHtml(selected.host)}` : "Entrar con código";
      const disabled = this.busy ? "disabled" : "";
      this.card.innerHTML = `
        <div class="truco-mp-head">
          <h2 id="truco-lobby-title" class="truco-mp-title">${title}</h2>
          <button class="truco-mp-close" data-action="close" aria-label="Cerrar" ${disabled}>${closeSvg}</button>
        </div>
        <form>
          ${this.statusText ? `<div role="status" class="truco-mp-status ${this.isError ? "error" : ""}">${this.escapeHtml(this.statusText)}</div>` : ""}
          <label class="truco-mp-label" for="truco-mp-name">Tu nombre en la mesa</label>
          <input id="truco-mp-name" class="truco-mp-input" maxlength="16" autocomplete="nickname"
            placeholder="Ej. Ángel" value="${this.escapeAttr(this.nameValue)}" ${disabled}>
          ${creating ? `
            <fieldset class="truco-access">
              <legend class="truco-mp-label">Acceso a la sala</legend>
              <label><input type="radio" name="visibility" value="public" ${this.visibility === "public" ? "checked" : ""}> Abierta <small>Aparece en la portada</small></label>
              <label><input type="radio" name="visibility" value="private" ${this.visibility === "private" ? "checked" : ""}> Privada <small>Solo con código o enlace</small></label>
            </fieldset>
            <label class="truco-mp-label" for="truco-create-mode">Mesa</label>
            <select id="truco-create-mode" class="truco-mp-input">
              <option value="1v1" ${this.config.mode === "1v1" ? "selected" : ""}>Individual · 2 puestos</option>
              <option value="2v2" ${this.config.mode === "2v2" ? "selected" : ""}>Por parejas · 4 puestos</option>
            </select>` : selected ? "" : `
            <label class="truco-mp-label" style="margin-top:16px" for="truco-mp-code">Código de sala</label>
            <input id="truco-mp-code" class="truco-mp-input code" required minlength="4" maxlength="8"
              placeholder="TRK482" value="${this.escapeAttr(this.codeInputValue)}" ${disabled}>`}
          <button type="submit" class="truco-mp-btn primary full" style="margin-top:18px" ${disabled}>
            ${this.busy ? "Conectando…" : creating ? "Crear sala" : "Sentarme a jugar"}
          </button>
        </form>`;

      const nameInput = this.card.querySelector<HTMLInputElement>("#truco-mp-name");
      const codeInput = this.card.querySelector<HTMLInputElement>("#truco-mp-code");

      nameInput?.addEventListener("input", () => {
        this.nameValue = nameInput.value;
        try {
          localStorage.setItem(STORAGE_NAME_KEY, this.nameValue);
        } catch {
          // ignore
        }
      });

      codeInput?.addEventListener("input", () => {
        const clean = normalizeRoomCode(codeInput.value);
        this.codeInputValue = clean;
        if (codeInput.value !== clean) codeInput.value = clean;
      });

      this.card.querySelector('[data-action="close"]')?.addEventListener("click", () => {
        this.close();
        this.callbacks.onClose();
      });

      this.card.querySelectorAll<HTMLInputElement>('input[name="visibility"]').forEach(input => {
        input.onchange = () => { this.visibility = input.value === "public" ? "public" : "private"; };
      });
      const mode = this.card.querySelector<HTMLSelectElement>("#truco-create-mode");
      if (mode) mode.onchange = () => { this.config.mode = mode.value === "2v2" ? "2v2" : "1v1"; };
      this.card.querySelector("form")!.onsubmit = event => {
        event.preventDefault();
        if (this.busy) return;
        const name = this.nameValue.trim() || (creating ? "Anfitrión" : "Invitado");
        this.setStatus("Conectando…", false, true);
        if (creating) void this.callbacks.onCreateRoom(name, { ...this.config }, this.visibility);
        else void this.callbacks.onJoinRoom(selected?.code ?? this.codeInputValue, name, !!selected);
      };
      return;
    }

    const seats = getSeatsForMode(this.config.mode);
    const occupied = seats.filter(seat => this.members.some(m => m.seat === seat)).length;
    const full = occupied === seats.length;
    const host = this.members.find(m => m.isHost);
    const seatNodes = seats.map(seat => {
      const member = this.members.find(m => m.seat === seat);
      const relative = mapSeatToViewer(seat, this.mySeat ?? "player", seats);
      const position = relative === "player" ? "sur" : relative === "partner" || seats.length === 2 ? "norte" :
        relative === "cpu" ? "este" : "oeste";
      const mine = member?.clientId === this.myClientId;
      const name = member ? this.escapeHtml(member.name) : "Libre";
      const team = seat === "player" || seat === "partner" ? "Pareja A" : "Pareja B";
      const label = [mine ? "Tú" : "", member?.isHost ? "Anfitrión" : "", seats.length === 4 ? team : ""].filter(Boolean).join(" · ");
      return `<button type="button" class="waiting-seat ${position} ${member ? "occupied" : ""}" data-seat="${seat}"
        ${member ? "disabled" : ""} aria-label="${member ? [name, label, position].filter(Boolean).join(", ") : 'Ocupar asiento ' + position}">
        <span class="seat-mark" aria-hidden="true">${member ? this.escapeHtml(Array.from(member.name)[0]?.toUpperCase() ?? "•") : "+"}</span>
        <strong>${name}</strong><small>${label || position}</small></button>`;
    }).join("");
    const rules = [
      ["mode", [["1v1","Individual"],["2v2","Parejas"]], this.config.mode],
      ["score", [["12","12 piedras"],["24","24 piedras"]], String(this.config.targetScore)],
      ["flor", [["1","Con flor"],["0","Sin flor"]], this.config.withFlor ? "1" : "0"],
    ] as const;
    const settings = rules.map(([key, options, value]) => `<div class="waiting-options">${options.map(([v, label]) =>
      `<button type="button" data-cfg="${key}:${v}" aria-pressed="${v === value}">${label}</button>`).join("")}</div>`).join("");
    const count = `${occupied} de ${seats.length} puestos ocupados`;
    const invite = this.isHost && !full ? `<section class="waiting-invite">
      <h3>Invitar a la mesa</h3>${this.inviteCode ? `
      <span class="truco-mp-label">Código de un uso</span>
      <strong class="truco-mp-codeval">${this.escapeHtml(this.inviteCode)}</strong>
      <button class="truco-mp-btn secondary full" data-action="copy">Copiar enlace</button>
      <p role="status">${this.escapeHtml(this.copyMessage)}</p>` : "<p>Preparando la invitación…</p>"}</section>` : "";
    const markup = `
      <header class="waiting-head">
        <div><h2 id="truco-lobby-title">Sala ${this.visibility === "public" ? "abierta" : "privada"}</h2>
        <p>${seats.length === 4 ? "Por parejas" : "Individual"} · ${this.config.targetScore} piedras · ${this.config.withFlor ? "Con flor" : "Sin flor"}</p></div>
        <div class="waiting-head-actions"><span data-chat-slot></span><button class="truco-mp-btn ghost" data-action="leave">Salir</button></div>
      </header>
      <div class="waiting-layout">
        <section class="waiting-places" aria-label="Asientos de la mesa">
          <div class="waiting-center" role="status"><span class="waiting-pack" aria-hidden="true"></span>
          <strong>${full ? "Mesa completa" : "Esperando jugadores"}</strong><small>${count}</small></div>
          ${seatNodes}
        </section>
        <aside class="waiting-side">
          ${invite}
          ${this.isHost ? `<details class="waiting-rules"><summary>Reglas de la mesa</summary>${settings}</details>
          ${full ? "" : "<p>Los puestos libres los ocuparán bots al empezar.</p>"}
          <button class="truco-mp-btn primary full" data-action="start">Empezar partida</button>` :
          `<p>${host ? this.escapeHtml(host.name) : "El anfitrión"} dará inicio a la partida.</p>`}
          ${this.isError ? `<p role="alert" class="truco-mp-status error">${this.escapeHtml(this.statusText)}</p>` : ""}
        </aside>
      </div>`;
    if (this.waitingMarkup === markup) return;
    this.waitingMarkup = markup;
    const rulesOpen = this.card.querySelector("details")?.open;
    const active = document.activeElement as HTMLElement | null;
    const focusKey = active && this.card.contains(active) ?
      (["action", "seat", "cfg"] as const).find(key => active.dataset[key]) : undefined;
    this.card.innerHTML = markup;
    this.callbacks.onChatSlot(this.card.querySelector("[data-chat-slot]")!);
    const details = this.card.querySelector("details");
    if (details && rulesOpen) details.open = true;
    if (focusKey) this.card.querySelector<HTMLElement>(`[data-${focusKey}="${active!.dataset[focusKey]}"]`)?.focus({ preventScroll: true });
    else if (active?.tagName === "SUMMARY") details?.querySelector("summary")?.focus({ preventScroll: true });

    this.card.querySelector('[data-action="copy"]')?.addEventListener("click", async () => {
      const code = this.inviteCode;
      if (!this.isHost || !code) return;
      const url = new URL(window.location.pathname, window.location.origin);
      url.searchParams.set("sala", code);
      try {
        await navigator.clipboard.writeText(url.href);
        if (this.inviteCode === code) this.copyMessage = "Enlace copiado.";
      } catch {
        if (this.inviteCode === code) this.copyMessage = "Puedes seleccionar y copiar el código.";
      }
      if (this.isOpen && this.inviteCode === code) this.render();
    });

    this.card.querySelectorAll<HTMLButtonElement>("[data-cfg]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!this.isHost) return;
        const [k, v] = (btn.dataset.cfg ?? "").split(":");
        const next: GameConfig = { ...this.config };
        if (k === "mode") next.mode = v === "2v2" ? "2v2" : "1v1";
        if (k === "score") next.targetScore = v === "12" ? 12 : 24;
        if (k === "flor") next.withFlor = v === "1";
        this.config = next;
        this.callbacks.onUpdateConfig(next);
        this.render();
      });
    });

    this.card.querySelectorAll<HTMLButtonElement>("[data-seat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const seat = btn.dataset.seat as PlayerId;
        if (seat && seat !== this.mySeat) {
          this.callbacks.onClaimSeat(seat);
        }
      });
    });

    this.card.querySelector('[data-action="start"]')?.addEventListener("click", () => {
      this.callbacks.onStartOnlineMatch();
    });

    this.card.querySelectorAll('[data-action="leave"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        void this.callbacks.onLeaveRoom();
      });
    });
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private escapeAttr(str: string): string {
    return this.escapeHtml(str).replace(/'/g, "&#39;");
  }
}
