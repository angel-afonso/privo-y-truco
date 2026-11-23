import type { GameEvent, GameState } from "../engine/types";

class SoundFX {
  private ctx: AudioContext | null = null;
  private muted = false;
  private output: GainNode | null = null;

  public enableOnInteraction(): void {
    const unlock = () => {
      if (this.muted) return;
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.ctx || this.ctx.state === "closed") {
        this.ctx = new AudioCtx();
        this.output = this.ctx.createGain();
        this.output.connect(this.ctx.destination);
      }
      if (this.ctx.state !== "running") void this.ctx.resume().catch(() => {});
    };
    document.addEventListener("click", unlock, { capture: true });
    document.addEventListener("keydown", unlock, { capture: true });
    document.addEventListener("pointerup", unlock, { capture: true });
  }

  private ensureCtx(): AudioContext | null {
    return !this.muted && this.ctx?.state === "running" ? this.ctx : null;
  }

  public playEvent(type: GameEvent["type"], victory: boolean): void {
    switch (type) {
      case "play_card":
      case "burn_card": this.playCardSlap(); break;
      case "call": this.playCall(); break;
      case "response":
      case "flor_result": this.playCall(true); break;
      case "envido_result":
      case "hand_end": this.playStoneClink(); break;
      case "match_end": this.playFanfare(victory); break;
    }
  }

  public playOnlineUpdate(previous: GameState | undefined, current: GameState, turnBegan: boolean): void {
    const last = current.lastEvent;
    if (previous && last && last.id > (previous.lastEvent?.id ?? 0)) {
      // Una misma carta puede generar también el cierre de baza, mano o partida.
      const events = current.log.filter(e => e.id > (previous.lastEvent?.id ?? 0));
      const action = events.reverse().find(e =>
        e.type === "play_card" || e.type === "burn_card" || e.type === "call" || e.type === "response");
      if (action) this.playEvent(action.type, current.matchWinner === "nosotros");
      if (last.id !== action?.id) this.playEvent(last.type, current.matchWinner === "nosotros");
    }
    if (turnBegan) this.playTurnCue();
  }

  private playTurnCue(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime + 0.18;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.setValueAtTime(880, now + 0.12);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.14);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.37);
    osc.connect(gain);
    gain.connect(this.output!);
    osc.start(now);
    osc.stop(now + 0.38);
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.output) this.output.gain.value = this.muted ? 0 : 1;
    return this.muted;
  }

  public playCardSlide(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * 0.08);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize) * 0.35;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(600, now + 0.08);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.output!);
    noise.start(now);
  }

  public playShuffleRiffle(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    for (let k = 0; k < 5; k++) {
      const t = now + k * 0.042;
      const len = Math.floor(ctx.sampleRate * 0.032);
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / len) * 0.28;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1600 + k * 140, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.16, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.032);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.output!);
      noise.start(t);
    }
  }

  public playCardSlap(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(185, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.07);

    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(this.output!);
    osc.start(now);
    osc.stop(now + 0.09);

    this.playCardSlide();
  }

  public playCall(intense = false): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = intense ? [392, 523.25, 659.25] : [349.23, 440];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      const t = now + idx * 0.065;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain);
      gain.connect(this.output!);
      osc.start(t);
      osc.stop(t + 0.24);
    });
  }

  public playStoneClink(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(980, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.04);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain);
    gain.connect(this.output!);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  public playFanfare(victory: boolean): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = victory ? [523.25, 659.25, 783.99, 1046.5] : [392, 349.23, 293.66];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      const t = now + idx * 0.11;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.16, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain);
      gain.connect(this.output!);
      osc.start(t);
      osc.stop(t + 0.37);
    });
  }

  public playPartnerWhisper(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [587.33, 739.99];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      const t = now + idx * 0.055;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(gain);
      gain.connect(this.output!);
      osc.start(t);
      osc.stop(t + 0.16);
    });
  }
}

export const soundFX = new SoundFX();
