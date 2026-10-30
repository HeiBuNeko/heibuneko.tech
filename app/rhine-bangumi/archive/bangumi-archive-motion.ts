import type { Spring } from "../motion/motion";
import { BANGUMI_COLUMN_SPACING } from "../rendering/bangumi-model";
import { ROW_SPACING } from "./archive-loop";

export const ARCHIVE_TRACK_KEYS = [
  "rail",
  "column",
  "shoulder",
  "lane",
] as const;
export type ArchiveTrack = (typeof ARCHIVE_TRACK_KEYS)[number];
export type ArchiveTracks = Record<ArchiveTrack, Spring>;
export type ArchiveTargets = Record<ArchiveTrack, number>;
type Kinematics = Spring & { acceleration: number };
type Polynomial = [number, number, number, number, number, number];

export function bangumiArchiveTravelDuration(lanes: number, rows: number) {
  const distance = Math.hypot(lanes, rows / 8);
  return 1.4 + Math.min(1, Math.max(0, (distance - 1) / 7));
}

/**
 * 管理跨列和远距离选片的连续位移轨迹。
 *
 * 跟踪轨道目标及速度，使中途再次导航时不发生位置跳变。
 */
export class BangumiArchiveMotion {
  private states: Record<ArchiveTrack, Kinematics> = Object.fromEntries(
    ARCHIVE_TRACK_KEYS.map((key) => [
      key,
      { value: 0, velocity: 0, acceleration: 0 },
    ]),
  ) as Record<ArchiveTrack, Kinematics>;
  private coefficients = {} as Record<ArchiveTrack, Polynomial>;
  private targets = {} as ArchiveTargets;
  private elapsed = 0;
  private duration = 0;
  private running = false;

  get active() {
    return this.running;
  }
  get progress() {
    return this.duration ? Math.min(1, this.elapsed / this.duration) : 1;
  }
  get durationSeconds() {
    return this.duration;
  }
  get settled() {
    return !this.running;
  }
  get state() {
    return Object.fromEntries(
      ARCHIVE_TRACK_KEYS.map((key) => [key, { ...this.states[key] }]),
    ) as Record<ArchiveTrack, Kinematics>;
  }

  observe(
    tracks: ArchiveTracks,
    targets: ArchiveTargets,
    rates: ArchiveTargets,
  ) {
    if (this.running) return;
    for (const key of ARCHIVE_TRACK_KEYS) {
      const { value, velocity } = tracks[key],
        rate = rates[key];
      this.states[key] = {
        value,
        velocity,
        acceleration:
          rate * rate * (targets[key] - value) - 2 * rate * velocity,
      };
    }
  }

  /**
   * 把当前轨道状态重新定向到新的选片目标。
   *
   * 保留已有位置和速度，计算各轴剩余的移动过程。
   *
   * @param tracks 当前各运动轴的位置与速度。
   * @param targets 多个运动轴的目标状态。
   */
  retarget(tracks: ArchiveTracks, targets: ArchiveTargets) {
    for (const key of ARCHIVE_TRACK_KEYS)
      Object.assign(this.states[key], tracks[key]);
    this.duration = bangumiArchiveTravelDuration(
      (targets.column - tracks.column.value) / BANGUMI_COLUMN_SPACING,
      (targets.rail - tracks.rail.value) / ROW_SPACING,
    );
    this.elapsed = 0;
    this.targets = { ...targets };
    this.running = true;
    const t = this.duration;
    for (const key of ARCHIVE_TRACK_KEYS) {
      const { value, velocity, acceleration } = this.states[key];
      const distance =
        targets[key] - value - velocity * t - (acceleration * t * t) / 2;
      const remainingVelocity = -velocity - acceleration * t;
      const remainingAcceleration = -acceleration;
      this.coefficients[key] = [
        value,
        velocity,
        acceleration / 2,
        (10 * distance -
          4 * remainingVelocity * t +
          (remainingAcceleration * t * t) / 2) /
          t ** 3,
        (-15 * distance +
          7 * remainingVelocity * t -
          remainingAcceleration * t * t) /
          t ** 4,
        (6 * distance -
          3 * remainingVelocity * t +
          (remainingAcceleration * t * t) / 2) /
          t ** 5,
      ];
    }
  }

  /**
   * 按时间步长推进阵列导航轨迹。
   *
   * 减少动态效果时直接收敛到目标，其余情况按轨迹更新各轴。
   *
   * @param tracks 当前各运动轴的位置与速度。
   * @param dt 本次更新的时间步长，单位为秒。
   * @param reduced 是否启用减少动态效果。
   */
  update(tracks: ArchiveTracks, dt: number, reduced: boolean) {
    if (!this.running) return;
    this.elapsed = reduced
      ? this.duration
      : Math.min(this.duration, this.elapsed + Math.max(0, dt));
    for (const key of ARCHIVE_TRACK_KEYS) {
      const state = this.states[key];
      if (this.elapsed >= this.duration) {
        state.value = this.targets[key];
        state.velocity = state.acceleration = 0;
      } else {
        const [a, b, c, d, e, f] = this.coefficients[key],
          t = this.elapsed;
        state.value =
          a + b * t + c * t ** 2 + d * t ** 3 + e * t ** 4 + f * t ** 5;
        state.velocity =
          b + 2 * c * t + 3 * d * t ** 2 + 4 * e * t ** 3 + 5 * f * t ** 4;
        state.acceleration =
          2 * c + 6 * d * t + 12 * e * t ** 2 + 20 * f * t ** 3;
      }
      tracks[key].value = state.value;
      tracks[key].velocity = state.velocity;
    }
    this.running = this.elapsed < this.duration;
  }

  translate(offset: ArchiveTargets) {
    for (const key of ARCHIVE_TRACK_KEYS) {
      this.states[key].value += offset[key];
      if (this.coefficients[key]) this.coefficients[key][0] += offset[key];
      if (this.targets[key] !== undefined) this.targets[key] += offset[key];
    }
  }

  reset() {
    this.running = false;
    this.duration = this.elapsed = 0;
  }
}
