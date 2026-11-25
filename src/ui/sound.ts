import type { GameEvent, GameState } from "../engine/types";

import { cantoAudioPath, eventCanto, nextCantoTake, type Canto, type CantoTake } from "./cantos";

const VOICE_CACHE_BYTES = 2 * 1024 * 1024;
const COMMON_PRELOAD_CANTOS: readonly Canto[] = [
  "truco",
  "envido",
  "quiero",
  "no-quiero",
  "flor",
  "me-voy",
];
const bufferBytes = (buffer: AudioBuffer) => buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;

class SoundFX {
  private ctx: AudioContext | null = null;
  private muted = false;
  private output: GainNode | null = null;

  private buffers = new Map<string, AudioBuffer>();
  private cachedBytes = 0;
  private preloaded = false;
  private lastTake = new Map<Canto, CantoTake>();
  private voice: AudioBufferSourceNode | null = null;
  private voiceQueue = Promise.resolve();
  private voiceSession = new AbortController();

  private async loadVoice(ctx: AudioContext, filename: string, signal: AbortSignal): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(filename);
    if (cached) {
      this.buffers.delete(filename);
      this.buffers.set(filename, cached);
      return cached;
    }
    const response = await fetch(`${import.meta.env.BASE_URL}${cantoAudioPath}/${filename}`, { signal });
    if (!response.ok) throw new Error(`Audio ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (signal.aborted) return null;
    const buffer = await ctx.decodeAudioData(bytes);
    if (signal.aborted) return null;
    const size = bufferBytes(buffer);
    if (size <= VOICE_CACHE_BYTES) {
      for (const [key, oldest] of this.buffers) {
        if (this.cachedBytes + size <= VOICE_CACHE_BYTES) break;
        this.cachedBytes -= bufferBytes(oldest);
        this.buffers.delete(key);
      }
      this.buffers.set(filename, buffer);
      this.cachedBytes += size;
    }
    return buffer;
  }

  public stopVoices(): void {
    this.voiceSession.abort();
    this.voiceSession = new AbortController();
    this.voiceQueue = Promise.resolve();
    this.voice?.stop();
    this.voice = null;
  }

  public preloadCommonCantos(): void {
    if (this.preloaded || this.muted || typeof fetch !== "function") return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    this.preloaded = true;
    const controller = new AbortController();
    void (async () => {
      for (const canto of COMMON_PRELOAD_CANTOS) {
        if (this.muted || ctx.state !== "running") break;
        const filename = `${canto}.directa.mp3`;
        if (this.buffers.has(filename)) continue;
        try {
          await this.loadVoice(ctx, filename, controller.signal);
        } catch {
          // Ignorar errores de precarga silenciosamente
        }
      }
    })();
  }

  public playCanto(canto: Canto): void {
    const ctx = this.ensureCtx();
    if (!ctx || !this.output) return;
    const { signal } = this.voiceSession;
    const output = this.output;
    const take = nextCantoTake(this.lastTake.get(canto));
    this.lastTake.set(canto, take);
    this.voiceQueue = this.voiceQueue.then(async () => {
      if (signal.aborted || ctx.state !== "running") return;
      const decoded = await this.loadVoice(ctx, `${canto}.${take}.mp3`, signal);
      if (!decoded || signal.aborted || ctx.state !== "running") return;
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.connect(output);
      this.voice = source;
      await new Promise<void>(resolve => {
        source.onended = () => {
          source.disconnect();
          if (this.voice === source) this.voice = null;
          resolve();
        };
        source.start();
      });
    }).catch(() => {});
  }

  public playNewCantos(events: readonly GameEvent[], afterId: number): void {
    for (const event of events) {
      if (event.id <= afterId) continue;
      const canto = eventCanto(event);
      if (canto) this.playCanto(canto);
    }
  }

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
      if (this.ctx.state !== "running") {
        void this.ctx.resume().then(() => this.preloadCommonCantos()).catch(() => {});
      } else {
        this.preloadCommonCantos();
      }
    };
    document.addEventListener("click", unlock, { capture: true });
    document.addEventListener("keydown", unlock, { capture: true });
    document.addEventListener("pointerup", unlock, { capture: true });
    window.addEventListener("pagehide", () => this.stopVoices());
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

  public playOnlineUpdate(
    previous: GameState | undefined,
    current: GameState,
    turnBegan: boolean,
    skipPlayerActionSfx = false,
  ): void {
    const last = current.lastEvent;
    if (previous && last && last.id > (previous.lastEvent?.id ?? 0)) {
      // Una misma carta puede generar también el cierre de baza, mano o partida.
      const events = current.log.filter(e => e.id > (previous.lastEvent?.id ?? 0));
      this.playNewCantos(events, previous.lastEvent?.id ?? 0);
      const action = events.reverse().find(e =>
        e.type === "play_card" || e.type === "burn_card" || e.type === "call" || e.type === "response");
      if (action && !(skipPlayerActionSfx && action.actor === "player")) {
        this.playEvent(action.type, current.matchWinner === "nosotros");
      }
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
    if (this.muted) this.stopVoices();
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
    const leaves = 10;
    let offset = 0;
    for (let k = 0; k < leaves; k++) {
      // Cadencia orgánica: arranca sutil, acelera en el centro del riffle y asienta al final
      const step = 0.032 - Math.sin((k / (leaves - 1)) * Math.PI) * 0.011;
      const t = now + offset;
      offset += step;

      const len = Math.floor(ctx.sampleRate * 0.026);
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const env = Math.pow(1 - i / len, 1.45);
        data[i] = (Math.random() * 2 - 1) * env * 0.3;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.setValueAtTime(1.4, t);
      filter.frequency.setValueAtTime(1450 + k * 95, t);

      const gain = ctx.createGain();
      const peak = 0.12 + Math.sin((k / (leaves - 1)) * Math.PI) * 0.055;
      gain.gain.setValueAtTime(peak, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.026);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.output!);
      noise.start(t);
    }
  }

  public playDeckCut(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.065);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    osc.connect(gain);
    gain.connect(this.output!);
    osc.start(now);
    osc.stop(now + 0.08);

    const len = Math.floor(ctx.sampleRate * 0.045);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len) * 0.25;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1100, now);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.12, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.output!);
    noise.start(now);
  }

  public playCardFlip(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.055);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const p = i / len;
      const env = Math.sin(p * Math.PI);
      data[i] = (Math.random() * 2 - 1) * env * 0.24;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1900, now);
    filter.frequency.exponentialRampToValueAtTime(950, now + 0.055);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.output!);
    noise.start(now);
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

  public playChatPop(): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(740, now + 0.055);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.055, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain);
    gain.connect(this.output!);
    osc.start(now);
    osc.stop(now + 0.1);
  }
}

export const soundFX = new SoundFX();
