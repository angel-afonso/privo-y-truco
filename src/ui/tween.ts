export type EasingFn = (t: number) => number;

export const Easing = {
  linear: (t: number): number => t,
  easeOutCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  easeOutQuart: (t: number): number => 1 - Math.pow(1 - t, 4),
  easeOutQuint: (t: number): number => 1 - Math.pow(1 - t, 5),
  easeInOutQuad: (t: number): number =>
    t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  easeInOutCubic: (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeInOutSine: (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2,
  easeOutSoftBack: (t: number): number => {
    const c1 = 0.85;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeOutBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

export interface TweenTarget {
  destroyed?: boolean;
  x?: number;
  y?: number;
  alpha?: number;
  rotation?: number;
  scale?: { x: number; y: number };
}

export interface TweenProps {
  x?: number;
  y?: number;
  alpha?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
}

export interface TweenOptions {
  /** Canal lógico para permitir tweens simultáneos en el mismo objeto (ej. "move" y "flip"). */
  channel?: string;
  /** Retraso en ms antes de iniciar la animación (en el ticker de Pixi, sin deriva de setTimeout). */
  delay?: number;
  /** Curvatura lateral/vertical de arco cuadrático (4 * t * (1 - t) * curve). */
  curveX?: number;
  curveY?: number;
  /** Elevación sutil de escala a mitad de vuelo (sin(π * t) * liftScale). */
  liftScale?: number;
  /** Callback por fotograma con progreso bruto y suavizado. */
  onUpdate?: (rawT: number, easedT: number) => void;
}

interface ActiveTween {
  target: TweenTarget;
  channel: string;
  start: TweenProps;
  end: TweenProps;
  capturedStart: boolean;
  delay: number;
  elapsed: number;
  duration: number;
  easing: EasingFn;
  curveX: number;
  curveY: number;
  liftScale: number;
  onUpdate?: (rawT: number, easedT: number) => void;
  onComplete?: () => void;
}

export class TweenManager {
  private tweens: ActiveTween[] = [];

  public to(
    target: TweenTarget,
    props: TweenProps,
    durationMs: number,
    easing: EasingFn = Easing.easeOutCubic,
    onComplete?: () => void,
    options?: TweenOptions,
  ): void {
    const channel = options?.channel ?? "default";
    // Cancelar solo tweens del mismo objeto y canal para permitir vuelo + giro 3D simultáneos
    this.tweens = this.tweens.filter((tw) => !(tw.target === target && tw.channel === channel));

    const delay = Math.max(0, options?.delay ?? 0);
    const tween: ActiveTween = {
      target,
      channel,
      start: {},
      end: props,
      capturedStart: false,
      delay,
      elapsed: 0,
      duration: Math.max(1, durationMs),
      easing,
      curveX: options?.curveX ?? 0,
      curveY: options?.curveY ?? 0,
      liftScale: options?.liftScale ?? 0,
      onUpdate: options?.onUpdate,
      onComplete,
    };

    if (delay === 0) {
      this.captureStart(tween);
    }

    this.tweens.push(tween);
  }

  /**
   * Anima un valor personalizado (ej. giro 3D o elevación de sombra) sincronizado al ticker.
   */
  public run(
    target: TweenTarget,
    durationMs: number,
    easing: EasingFn,
    onUpdate: (rawT: number, easedT: number) => void,
    onComplete?: () => void,
    channel = "fx",
    delay = 0,
  ): void {
    this.to(target, {}, durationMs, easing, onComplete, {
      channel,
      delay,
      onUpdate,
    });
  }

  public cancel(target: TweenTarget, channel?: string): void {
    this.tweens = this.tweens.filter(
      (tw) => !(tw.target === target && (channel === undefined || tw.channel === channel)),
    );
  }

  public clear(): void {
    this.tweens = [];
  }

  private captureStart(tw: ActiveTween): void {
    const { target, end } = tw;
    const start: TweenProps = {};
    if (end.x !== undefined) start.x = target.x ?? 0;
    if (end.y !== undefined) start.y = target.y ?? 0;
    if (end.alpha !== undefined) start.alpha = target.alpha ?? 1;
    if (end.rotation !== undefined) start.rotation = target.rotation ?? 0;
    if (end.scaleX !== undefined) start.scaleX = target.scale?.x ?? 1;
    if (end.scaleY !== undefined) start.scaleY = target.scale?.y ?? 1;
    tw.start = start;
    tw.capturedStart = true;
  }

  public update(deltaMS: number): void {
    if (this.tweens.length === 0) return;

    const remaining: ActiveTween[] = [];
    const completed: Array<() => void> = [];

    for (const tw of this.tweens) {
      if (tw.target.destroyed) continue;

      if (tw.delay > 0) {
        tw.delay -= deltaMS;
        if (tw.delay > 0) {
          remaining.push(tw);
          continue;
        }
        // Sobrante exacto tras cumplir el retraso
        tw.elapsed += -tw.delay;
        tw.delay = 0;
      } else {
        tw.elapsed += deltaMS;
      }

      if (!tw.capturedStart) {
        this.captureStart(tw);
      }

      const rawT = Math.min(1, tw.elapsed / tw.duration);
      const t = tw.easing(rawT);
      const arc = 4 * rawT * (1 - rawT);
      const lift = tw.liftScale !== 0 ? Math.sin(rawT * Math.PI) * tw.liftScale : 0;

      if (tw.end.x !== undefined && tw.start.x !== undefined) {
        tw.target.x = tw.start.x + (tw.end.x - tw.start.x) * t + tw.curveX * arc;
      }
      if (tw.end.y !== undefined && tw.start.y !== undefined) {
        tw.target.y = tw.start.y + (tw.end.y - tw.start.y) * t + tw.curveY * arc;
      }
      if (tw.end.alpha !== undefined && tw.start.alpha !== undefined) {
        tw.target.alpha = tw.start.alpha + (tw.end.alpha - tw.start.alpha) * t;
      }
      if (tw.end.rotation !== undefined && tw.start.rotation !== undefined) {
        tw.target.rotation = tw.start.rotation + (tw.end.rotation - tw.start.rotation) * t;
      }
      if (tw.target.scale) {
        if (tw.end.scaleX !== undefined && tw.start.scaleX !== undefined) {
          tw.target.scale.x = tw.start.scaleX + (tw.end.scaleX - tw.start.scaleX) * t + lift;
        }
        if (tw.end.scaleY !== undefined && tw.start.scaleY !== undefined) {
          tw.target.scale.y = tw.start.scaleY + (tw.end.scaleY - tw.start.scaleY) * t + lift;
        }
      }

      if (tw.onUpdate) {
        tw.onUpdate(rawT, t);
      }

      if (rawT >= 1) {
        if (tw.onComplete) completed.push(tw.onComplete);
      } else {
        remaining.push(tw);
      }
    }

    this.tweens = remaining;
    for (const fn of completed) fn();
  }
}
