export const DEFAULT_BANGUMI_MOTION_SPEED = 1;
export const MIN_BANGUMI_MOTION_SPEED = 0.25;
export const MAX_BANGUMI_MOTION_SPEED = 3;

let speed = DEFAULT_BANGUMI_MOTION_SPEED;
const listeners = new Set<(speed: number) => void>();

export function normalizeBangumiMotionSpeed(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(
        MAX_BANGUMI_MOTION_SPEED,
        Math.max(MIN_BANGUMI_MOTION_SPEED, value),
      )
    : DEFAULT_BANGUMI_MOTION_SPEED;
}

export const getBangumiMotionSpeed = () => speed;
export const bangumiMotionDuration = (milliseconds: number) =>
  milliseconds / speed;

export function setBangumiMotionSpeed(value: unknown) {
  const next = normalizeBangumiMotionSpeed(value);
  if (next === speed) return;
  speed = next;
  for (const listener of listeners) listener(speed);
}

export function onBangumiMotionSpeedChange(listener: (speed: number) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 让界面动画跟随全局动态速度。
 *
 * 监听速度变化并更新当前 Web Animations 播放倍率，动画结束时解除订阅。
 *
 * @param animation 需要跟随全局速度的动画。
 * @param rate 相对于全局动态速度的倍率回调。
 * @returns 已接入速度同步的动画。
 */
export function followBangumiMotionSpeed(
  animation: Animation,
  rate: () => number = () => 1,
) {
  animation.playbackRate = getBangumiMotionSpeed() * rate();
  const unsubscribe = onBangumiMotionSpeedChange((speed) => {
    animation.updatePlaybackRate(speed * rate());
  });
  void animation.finished.then(unsubscribe, unsubscribe);
  return animation;
}
