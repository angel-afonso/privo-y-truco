export type EasingFn = (t: number) => number;

export const Easing = {
  easeOutCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  easeInOutQuad: (t: number): number =>
    t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  easeOutBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

export interface TweenTarget {
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

interface ActiveTween {
  target: TweenTarget;
  start: TweenProps;
  end: TweenProps;
  elapsed: number;
  duration: number;
  easing: EasingFn;
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
  ): void {
    // Remove conflicting properties on existing tweens for the same target
    this.tweens = this.tweens.filter((tw) => tw.target !== target);

    const start: TweenProps = {};
    if (props.x !== undefined) start.x = target.x ?? 0;
    if (props.y !== undefined) start.y = target.y ?? 0;
    if (props.alpha !== undefined) start.alpha = target.alpha ?? 1;
    if (props.rotation !== undefined) start.rotation = target.rotation ?? 0;
    if (props.scaleX !== undefined) start.scaleX = target.scale?.x ?? 1;
    if (props.scaleY !== undefined) start.scaleY = target.scale?.y ?? 1;

    this.tweens.push({
      target,
      start,
      end: props,
      elapsed: 0,
      duration: Math.max(1, durationMs),
      easing,
      onComplete,
    });
  }

  public cancel(target: TweenTarget): void {
    this.tweens = this.tweens.filter((tw) => tw.target !== target);
  }

  public clear(): void {
    this.tweens = [];
  }

  public update(deltaMS: number): void {
    if (this.tweens.length === 0) return;

    const remaining: ActiveTween[] = [];
    const completed: Array<() => void> = [];

    for (const tw of this.tweens) {
      tw.elapsed += deltaMS;
      const rawT = Math.min(1, tw.elapsed / tw.duration);
      const t = tw.easing(rawT);

      if (tw.end.x !== undefined && tw.start.x !== undefined) {
        tw.target.x = tw.start.x + (tw.end.x - tw.start.x) * t;
      }
      if (tw.end.y !== undefined && tw.start.y !== undefined) {
        tw.target.y = tw.start.y + (tw.end.y - tw.start.y) * t;
      }
      if (tw.end.alpha !== undefined && tw.start.alpha !== undefined) {
        tw.target.alpha = tw.start.alpha + (tw.end.alpha - tw.start.alpha) * t;
      }
      if (tw.end.rotation !== undefined && tw.start.rotation !== undefined) {
        tw.target.rotation = tw.start.rotation + (tw.end.rotation - tw.start.rotation) * t;
      }
      if (tw.target.scale) {
        if (tw.end.scaleX !== undefined && tw.start.scaleX !== undefined) {
          tw.target.scale.x = tw.start.scaleX + (tw.end.scaleX - tw.start.scaleX) * t;
        }
        if (tw.end.scaleY !== undefined && tw.start.scaleY !== undefined) {
          tw.target.scale.y = tw.start.scaleY + (tw.end.scaleY - tw.start.scaleY) * t;
        }
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
