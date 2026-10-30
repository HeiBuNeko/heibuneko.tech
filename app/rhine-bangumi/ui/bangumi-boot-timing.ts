export const BANGUMI_BOOT_START_TIME = 0;
export const BANGUMI_BOOT_SCENE_REVEAL_TIME = 1.72;
export const BANGUMI_BOOT_SCENE_START = 1.8;
export const BANGUMI_BOOT_SCENE_TIME = 21.92;
export const BANGUMI_BOOT_END_TIME = BANGUMI_BOOT_SCENE_START + 5.2;

export const bangumiBootSceneTime = (time: number) =>
  BANGUMI_BOOT_SCENE_TIME + Math.max(0, time - BANGUMI_BOOT_SCENE_START);

/**
 * 约束开场动画的有效帧时间。
 *
 * 把后台停顿与 Shader 编译耗时从开场时间轴中剔除。
 */
export class BangumiBootFrameClock {
  private lastTime = 0;
  private appTime = BANGUMI_BOOT_START_TIME;

  reset(
    nowSeconds: number,
    startTime:
      | typeof BANGUMI_BOOT_START_TIME
      | typeof BANGUMI_BOOT_SCENE_START = BANGUMI_BOOT_START_TIME,
  ) {
    this.lastTime = nowSeconds;
    this.appTime = startTime;
  }

  update(nowSeconds: number) {
    if (!Number.isFinite(nowSeconds) || nowSeconds <= this.lastTime)
      return this.appTime;
    const dt = Math.min(nowSeconds - this.lastTime, 0.05);
    this.lastTime = nowSeconds;
    this.appTime = Math.min(BANGUMI_BOOT_END_TIME, this.appTime + dt);
    if (BANGUMI_BOOT_END_TIME - this.appTime < 1e-9)
      this.appTime = BANGUMI_BOOT_END_TIME;
    return this.appTime;
  }
}
