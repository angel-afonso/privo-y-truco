import { GameConfig, getSeatsForMode, PlayerId } from "../engine/types";
import { normalizeRoomCode, RoomMember } from "../multiplayer/roomClient";

export interface MultiplayerLobbyCallbacks {
  onCreateRoom: (name: string, config: GameConfig) => Promise<void>;
  onJoinRoom: (code: string, name: string) => Promise<void>;
  onUpdateConfig: (config: GameConfig) => void;
  onClaimSeat: (seat: PlayerId) => void;
  onStartOnlineMatch: () => void;
  onLeaveRoom: () => Promise<void>;
  onClose: () => void;
}

const STORAGE_NAME_KEY = "truco_venezolano_nickname";

const LOBBY_STYLES = `
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
  max-height: calc(100vh - 28px);
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
  width: 36px;
  height: 36px;
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
  font-size: 14px;
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
.truco-mp-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 16px 0;
  color: #7e9e8c;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
}
.truco-mp-divider::before,
.truco-mp-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: #224234;
}
.truco-mp-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.truco-mp-codebox {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: #06150f;
  border: 1px solid #284d3c;
  border-radius: 12px;
  padding: 10px 14px;
  margin-bottom: 14px;
}
.truco-mp-codeval {
  font-family: "Fraunces", Georgia, serif;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 3px;
  color: #f4dca0;
}
.truco-mp-segs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}
.truco-mp-seg {
  display: flex;
  background: #06150f;
  border: 1px solid #284d3c;
  border-radius: 9px;
  padding: 3px;
  gap: 3px;
}
.truco-mp-seg button {
  flex: 1;
  height: 30px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #bcd1c4;
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
}
.truco-mp-seg button.active {
  background: #d6a645;
  color: #1b120a;
}
.truco-mp-seg button:disabled {
  cursor: default;
}
.truco-mp-seats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 14px;
}
.truco-mp-seat {
  text-align: left;
  background: #081b13;
  border: 1px solid #284d3c;
  border-radius: 11px;
  padding: 10px 12px;
  color: #f4efe4;
  cursor: pointer;
  font-family: inherit;
  transition: border-color 120ms ease, background 120ms ease;
}
.truco-mp-seat:hover:not(:disabled) {
  border-color: #d6a645;
  background: #102a1f;
}
.truco-mp-seat.mine {
  border-color: #d6a645;
  background: #133224;
}
.truco-mp-seat.taken {
  cursor: default;
}
.truco-mp-seat-role {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.7px;
  text-transform: uppercase;
  color: #7e9e8c;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.truco-mp-seat-name {
  margin-top: 4px;
  font-size: 13.5px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 6px;
}
.truco-mp-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #5cc48f;
  flex-shrink: 0;
}
.truco-mp-dot.bot {
  background: #4d6b5c;
}
.truco-mp-status {
  font-size: 12px;
  color: #bcd1c4;
  background: #06150f;
  border-left: 3px solid #d6a645;
  border-radius: 8px;
  padding: 9px 12px;
  margin-bottom: 14px;
}
.truco-mp-status.error {
  border-left-color: #e38b90;
  color: #f8d2d5;
}
@media (max-width: 460px) {
  .truco-mp-segs {
    grid-template-columns: 1fr;
  }
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
  private copiedFeedback = false;

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
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root && !this.roomCode) {
        this.close();
        this.callbacks.onClose();
      }
    });

    this.card = document.createElement("div");
    this.card.className = "truco-mp-card";
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

  public open(initialConfig?: GameConfig): void {
    if (initialConfig && !this.roomCode) {
      this.config = { ...initialConfig };
    }
    this.isOpen = true;
    this.root.classList.add("open");
    this.render();
  }

  public close(): void {
    this.isOpen = false;
    this.root.classList.remove("open");
  }

  public setRoomState(params: {
    roomCode: string | null;
    isHost: boolean;
    myClientId: string;
    mySeat: PlayerId | null;
    members: RoomMember[];
    config: GameConfig;
  }): void {
    this.roomCode = params.roomCode;
    this.isHost = params.isHost;
    this.myClientId = params.myClientId;
    this.mySeat = params.mySeat;
    this.members = params.members;
    this.config = { ...params.config };
    if (this.isOpen) this.render();
  }

  public setStatus(text: string, isError = false, busy = false): void {
    this.statusText = text;
    this.isError = isError;
    this.busy = busy;
    if (this.isOpen) this.render();
  }

  private seatRoleLabel(seat: PlayerId): { title: string; team: string } {
    if (this.config.mode === "1v1") {
      return seat === "player"
        ? { title: "Asiento Sur", team: "Jugador 1" }
        : { title: "Asiento Norte", team: "Jugador 2" };
    }
    switch (seat) {
      case "player":
        return { title: "Sur", team: "Pareja A" };
      case "partner":
        return { title: "Norte", team: "Pareja A" };
      case "cpu":
        return { title: "Este", team: "Pareja B" };
      case "cpu2":
        return { title: "Oeste", team: "Pareja B" };
    }
  }

  private render(): void {
    const closeSvg = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3l10 10M13 3L3 13"/></svg>`;

    if (!this.roomCode) {
      this.card.innerHTML = `
        <div class="truco-mp-head">
          <div>
            <div class="truco-mp-title">Mesa Online</div>
            <div class="truco-mp-sub">Juega 1 vs 1 o 2 vs 2 en tiempo real con Supabase</div>
          </div>
          <button class="truco-mp-close" data-action="close" aria-label="Cerrar">${closeSvg}</button>
        </div>

        ${
          this.statusText
            ? `<div class="truco-mp-status ${this.isError ? "error" : ""}">${this.escapeHtml(this.statusText)}</div>`
            : ""
        }

        <div style="margin-bottom: 14px;">
          <label class="truco-mp-label" for="truco-mp-name">Tu nombre en la mesa</label>
          <input
            id="truco-mp-name"
            class="truco-mp-input"
            type="text"
            maxlength="16"
            placeholder="Ej. Ángel"
            value="${this.escapeAttr(this.nameValue)}"
          />
        </div>

        <button class="truco-mp-btn primary full" data-action="create" ${this.busy ? "disabled" : ""}>
          ${this.busy ? "Conectando..." : "Crear sala nueva"}
        </button>

        <div class="truco-mp-divider">o únete con un código</div>

        <div class="truco-mp-row">
          <input
            id="truco-mp-code"
            class="truco-mp-input code"
            type="text"
            maxlength="8"
            placeholder="TRK482"
            value="${this.escapeAttr(this.codeInputValue)}"
          />
          <button class="truco-mp-btn secondary" style="min-width: 110px;" data-action="join" ${this.busy ? "disabled" : ""}>
            Unirse
          </button>
        </div>
      `;

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

      this.card.querySelector('[data-action="create"]')?.addEventListener("click", () => {
        const name = (nameInput?.value ?? this.nameValue).trim() || "Anfitrión";
        void this.callbacks.onCreateRoom(name, this.config);
      });

      this.card.querySelector('[data-action="join"]')?.addEventListener("click", () => {
        const name = (nameInput?.value ?? this.nameValue).trim() || "Invitado";
        const code = normalizeRoomCode(codeInput?.value ?? this.codeInputValue);
        void this.callbacks.onJoinRoom(code, name);
      });
      return;
    }

    // Vista de Sala Activa (Waiting Room)
    const seats = getSeatsForMode(this.config.mode);
    const humanCount = this.members.filter((m) => m.seat !== null).length;

    const seatsHtml = seats
      .map((seat) => {
        const occupant = this.members.find((m) => m.seat === seat);
        const role = this.seatRoleLabel(seat);
        const isMine = occupant?.clientId === this.myClientId;
        const isTaken = Boolean(occupant && !isMine);
        const displayName = occupant
          ? `${this.escapeHtml(occupant.name)}${isMine ? " (Tú)" : ""}`
          : "Libre · Bot al iniciar";

        return `
          <button
            class="truco-mp-seat ${isMine ? "mine" : ""} ${isTaken ? "taken" : ""}"
            data-seat="${seat}"
            ${isTaken ? "disabled" : ""}
          >
            <div class="truco-mp-seat-role">
              <span>${role.title}</span>
              <span>${role.team}</span>
            </div>
            <div class="truco-mp-seat-name">
              <span class="truco-mp-dot ${occupant ? "" : "bot"}"></span>
              <span>${displayName}</span>
            </div>
          </button>
        `;
      })
      .join("");

    const dis = this.isHost ? "" : "disabled";

    this.card.innerHTML = `
      <div class="truco-mp-head">
        <div>
          <div class="truco-mp-title">Sala ${this.escapeHtml(this.roomCode)}</div>
          <div class="truco-mp-sub">${humanCount} jugador${humanCount === 1 ? "" : "es"} conectado${humanCount === 1 ? "" : "s"} · Toca un asiento libre para cambiar</div>
        </div>
        <button class="truco-mp-close" data-action="leave" aria-label="Salir">${closeSvg}</button>
      </div>

      <div class="truco-mp-codebox">
        <div>
          <div class="truco-mp-label" style="margin-bottom: 2px;">Código de invitación</div>
          <div class="truco-mp-codeval">${this.escapeHtml(this.roomCode)}</div>
        </div>
        <button class="truco-mp-btn secondary" data-action="copy">
          ${this.copiedFeedback ? "Enlace copiado" : "Copiar enlace"}
        </button>
      </div>

      ${
        this.statusText
          ? `<div class="truco-mp-status ${this.isError ? "error" : ""}">${this.escapeHtml(this.statusText)}</div>`
          : ""
      }

      <div class="truco-mp-segs">
        <div class="truco-mp-seg">
          <button data-cfg="mode:1v1" class="${this.config.mode === "1v1" ? "active" : ""}" ${dis}>1 vs 1</button>
          <button data-cfg="mode:2v2" class="${this.config.mode === "2v2" ? "active" : ""}" ${dis}>2 vs 2</button>
        </div>
        <div class="truco-mp-seg">
          <button data-cfg="score:12" class="${this.config.targetScore === 12 ? "active" : ""}" ${dis}>12 pts</button>
          <button data-cfg="score:24" class="${this.config.targetScore === 24 ? "active" : ""}" ${dis}>24 pts</button>
        </div>
        <div class="truco-mp-seg">
          <button data-cfg="flor:1" class="${this.config.withFlor ? "active" : ""}" ${dis}>Con Flor</button>
          <button data-cfg="flor:0" class="${!this.config.withFlor ? "active" : ""}" ${dis}>Sin Flor</button>
        </div>
      </div>

      <div class="truco-mp-seats">${seatsHtml}</div>

      <div class="truco-mp-row">
        ${
          this.isHost
            ? `<button class="truco-mp-btn primary" style="flex: 1;" data-action="start">Empezar partida</button>`
            : `<div class="truco-mp-status" style="flex: 1; margin-bottom: 0;">Esperando que el anfitrión inicie la partida...</div>`
        }
        <button class="truco-mp-btn ghost" data-action="leave">Salir</button>
      </div>
    `;

    this.card.querySelector('[data-action="copy"]')?.addEventListener("click", async () => {
      if (!this.roomCode) return;
      const url = `${window.location.origin}${window.location.pathname}?sala=${this.roomCode}`;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // Fallback silencioso si clipboard no está disponible
      }
      this.copiedFeedback = true;
      this.render();
      setTimeout(() => {
        this.copiedFeedback = false;
        if (this.isOpen && this.roomCode) this.render();
      }, 2000);
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
