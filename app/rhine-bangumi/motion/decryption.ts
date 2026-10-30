import { smooth } from "./motion";

export const DECRYPTION_START = 34.12;
export const DECRYPTION_END = 39.56;
const INTERACTIVE_RATE = 1.5;

type Knot = readonly [number, number];
/**
 * 按关键点采样连续的解密曲线。
 *
 * 使用相邻斜率维持关键点之间的平滑过渡。
 *
 * @param knots 定义插值曲线的关键点。
 * @param time 当前动画时间，单位为秒。
 * @returns 指定时刻的曲线采样值。
 */
export function sampleCurve(knots: readonly Knot[], time: number) {
  if (time <= knots[0][0]) return knots[0][1];
  if (time >= knots[knots.length - 1][0]) return knots[knots.length - 1][1];
  const secant = (i: number) =>
    (knots[i + 1][1] - knots[i][1]) / (knots[i + 1][0] - knots[i][0]);
  const slope = (i: number) => {
    if (i === 0 || i === knots.length - 1) return 0;
    const a = secant(i - 1),
      b = secant(i);
    if (a * b <= 0) return 0;
    const left = knots[i][0] - knots[i - 1][0],
      right = knots[i + 1][0] - knots[i][0];
    const w1 = 2 * right + left,
      w2 = right + 2 * left;
    return (w1 + w2) / (w1 / a + w2 / b);
  };
  let i = 0;
  while (time > knots[i + 1][0]) i++;
  const span = knots[i + 1][0] - knots[i][0],
    t = (time - knots[i][0]) / span,
    t2 = t * t,
    t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * knots[i][1] +
    (t3 - 2 * t2 + t) * span * slope(i) +
    (-2 * t3 + 3 * t2) * knots[i + 1][1] +
    (t3 - t2) * span * slope(i + 1)
  );
}

const GROW: readonly Knot[] = [
  [34.24, 0],
  [34.4, 0.19],
  [34.64, 0.57],
  [34.96, 0.79],
  [35.28, 0.92],
  [35.6, 0.973],
  [36.04, 1],
];
const REVEAL: readonly Knot[] = [
  [38.84, 0],
  [38.92, 0.28],
  [39.0, 0.51],
  [39.16, 0.74],
  [39.32, 0.94],
  [39.56, 1],
];
const RETRACT: readonly Knot[] = [
  [37.72, 1],
  [37.88, 0.72],
  [38.0, 0.38],
  [38.12, 0.22],
  [38.24, 0.14],
  [38.4, 0.075],
  [38.64, 0.024],
  [38.84, 0],
];

/**
 * 计算封面解密动画在指定时刻的状态。
 *
 * 组合多个曲线阶段得到当前的清晰度与显示参数。
 *
 * @param time 当前动画时间，单位为秒。
 * @returns 当前动画帧的状态值。
 */
export function decryptionFrame(time: number) {
  const grow = sampleCurve(GROW, time);
  const remaining = sampleCurve(RETRACT, time);
  const intervals: [number, number][] = [];
  if (time >= 34.24 && time < 36.04 && grow > 0)
    intervals.push([0, grow * 0.5], [1 - grow * 0.5, 1]);
  else if (time >= 36.04 && time < 38.84)
    intervals.push([0.5 - remaining * 0.5, 0.5 + remaining * 0.5]);
  const markers =
    smooth((time - 34.2) / 0.12) * (1 - smooth((time - 37.76) / 0.56));
  return {
    time,
    intervals,
    markers,
    point: smooth((time - 38.58) / 0.2) * (1 - smooth((time - 39.08) / 0.22)),
    label: smooth((time - 34.32) / 0.36) * (1 - smooth((time - 37.68) / 0.24)),
    labelValue: smooth((time - 35.64) / 0.56),
    clarity: sampleCurve(REVEAL, time),
    phase:
      time < 34.24
        ? "waiting"
        : time < 36.04
          ? "joining"
          : time < 37.72
            ? "connected"
            : time < 38.84
              ? "retracting"
              : time < DECRYPTION_END
                ? "revealing"
                : "clear",
  };
}
export type DecryptionFrame = ReturnType<typeof decryptionFrame>;

/**
 * 管理封面解密状态及详情切换。
 *
 * 同步入场、离场、选片和减少动态效果时的清晰度。
 */
export class DecryptionController {
  clarity = 0;
  private active = false;
  private elapsed: number | null = null;
  frame: DecryptionFrame = decryptionFrame(-1);

  enter(alreadyClear = false) {
    if (this.active) return;
    this.active = true;
    this.elapsed = alreadyClear
      ? (DECRYPTION_END - DECRYPTION_START) / INTERACTIVE_RATE
      : null;
    if (alreadyClear) this.finish();
  }
  leave() {
    this.active = false;
    this.elapsed = null;
    this.frame = decryptionFrame(-1);
  }
  select(clarity = 0) {
    this.leave();
    this.clarity = clarity;
  }
  finish() {
    this.elapsed = (DECRYPTION_END - DECRYPTION_START) / INTERACTIVE_RATE;
    this.clarity = 1;
    this.frame = decryptionFrame(DECRYPTION_END);
  }
  /**
   * 推进解密动画并同步当前状态。
   *
   * 根据就绪状态和参考时间决定动画目标，减少动态效果时立即完成。
   *
   * @param dt 本次更新的时间步长，单位为秒。
   * @param ready 场景资源是否已经可用于当前动画。
   * @param reduced 是否启用减少动态效果。
   * @param referenceTime 可选的参考时间，用于与开场时间轴同步。
   */
  update(dt: number, ready: boolean, reduced: boolean, referenceTime?: number) {
    if (referenceTime !== undefined) {
      this.frame = decryptionFrame(referenceTime);
      this.clarity = this.frame.clarity;
      return;
    }
    if (!this.active) {
      this.clarity = reduced
        ? 0
        : this.clarity * Math.exp(-Math.max(0, dt) * 9);
      if (this.clarity < 0.0001) this.clarity = 0;
      this.frame = decryptionFrame(-1);
      return;
    }
    if (reduced) {
      this.finish();
      return;
    }
    if (this.elapsed === null && ready) this.elapsed = 0;
    else if (this.elapsed !== null)
      this.elapsed = Math.min(
        this.elapsed + Math.max(0, dt),
        (DECRYPTION_END - DECRYPTION_START) / INTERACTIVE_RATE,
      );
    if (this.elapsed !== null) {
      this.frame = decryptionFrame(
        DECRYPTION_START + this.elapsed * INTERACTIVE_RATE,
      );
      this.clarity =
        this.frame.clarity > this.clarity
          ? this.frame.clarity
          : this.frame.phase === "clear"
            ? 1
            : this.clarity * Math.exp(-Math.max(0, dt) * 9);
    }
  }
}
