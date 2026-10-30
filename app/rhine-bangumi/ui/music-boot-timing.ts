export const MUSIC_BOOT_START_TIME = 0;
export const MUSIC_BOOT_SCENE_REVEAL_TIME = 1.72;
export const MUSIC_BOOT_SCENE_START = 1.8;
export const MUSIC_BOOT_SCENE_TIME = 21.92;
export const MUSIC_BOOT_END_TIME = MUSIC_BOOT_SCENE_START + 5.2;

export const musicBootSceneTime = (time: number) =>
  MUSIC_BOOT_SCENE_TIME + Math.max(0, time - MUSIC_BOOT_SCENE_START);

/**
 * 约束开场动画的有效帧时间。
 *
 * 把后台停顿与 Shader 编译耗时从开场时间轴中剔除。
 */
export class MusicBootFrameClock {
  private lastTime = 0;
  private appTime = MUSIC_BOOT_START_TIME;

  reset(
    nowSeconds: number,
    startTime:
      | typeof MUSIC_BOOT_START_TIME
      | typeof MUSIC_BOOT_SCENE_START = MUSIC_BOOT_START_TIME,
  ) {
    this.lastTime = nowSeconds;
    this.appTime = startTime;
  }

  update(nowSeconds: number) {
    if (!Number.isFinite(nowSeconds) || nowSeconds <= this.lastTime)
      return this.appTime;
    const dt = Math.min(nowSeconds - this.lastTime, 0.05);
    this.lastTime = nowSeconds;
    this.appTime = Math.min(MUSIC_BOOT_END_TIME, this.appTime + dt);
    if (MUSIC_BOOT_END_TIME - this.appTime < 1e-9)
      this.appTime = MUSIC_BOOT_END_TIME;
    return this.appTime;
  }
}
