import {
  followBangumiMotionSpeed,
  getBangumiMotionSpeed,
} from "../motion/bangumi-motion";

const enterEase = "cubic-bezier(0.22, 1, 0.36, 1)";
const exitEase = "cubic-bezier(0.4, 0, 1, 1)";

/**
 * 创建可中断的界面显隐过渡。
 *
 * 使用 Web Animations API 保持反向切换的当前透明度，并跟随全局动画速度。
 *
 * @param root 当前场景或界面的根 DOM 元素。
 * @param panel 参与过渡的内容元素。
 * @param enterDuration 入场动画的基础时长，单位为毫秒。
 * @param exitDuration 退场动画的基础时长，单位为毫秒。
 * @param direction 导航方向或过渡方向。
 * @param enterEasing 入场动画使用的缓动曲线。
 * @param fadeTargets 需要共同执行透明度过渡的元素。
 * @returns 显示、隐藏、加速结束及销毁控制句柄。
 */
export function createSurfaceTransition(
  root: HTMLElement,
  panel?: HTMLElement,
  enterDuration = 300,
  exitDuration = 200,
  direction: "up" | "right" = "up",
  enterEasing = enterEase,
  fadeTargets: readonly HTMLElement[] = [root],
) {
  let animations: Animation[] = [];
  let revisionCounter = 0;
  let transitionDuration = 0;
  let exitRate = 1;
  let enterLead:
    | {
        animation: Animation;
        start: (reduced: boolean) => void;
      }
    | undefined;

  /**
   * 开始或继续显示界面。
   *
   * 若入场被退场中断，则从当前透明度恢复而非重播完整动画。
   *
   * @param reduced 是否启用减少动态效果。
   * @param enterDelay 入场前的等待时间，单位为毫秒。
   * @param onShow 入场开始后的回调。
   */
  function show(reduced: boolean, enterDelay = 0, onShow?: () => void) {
    cancelEnterLead();
    if (
      !reduced &&
      root.hidden &&
      Number.isFinite(enterDelay) &&
      enterDelay > 0
    ) {
      const revision = ++revisionCounter;
      const animation = followBangumiMotionSpeed(
        root.animate([], { duration: enterDelay }),
      );
      const start = (finishImmediately: boolean) => {
        if (revision !== revisionCounter || enterLead?.animation !== animation)
          return;
        enterLead = undefined;
        animation.cancel();
        run(true, finishImmediately);
        onShow?.();
      };
      enterLead = { animation, start };
      void animation.finished.then(() => start(false)).catch(() => {});
      return;
    }
    run(true, reduced);
    onShow?.();
  }

  /**
   * 开始或继续隐藏界面。
   *
   * 完成时调用回调；新的过渡会取消旧回调。
   *
   * @param reduced 是否启用减少动态效果。
   * @param finished 退场完成后的回调。
   */
  function hide(reduced: boolean, finished: () => void = () => {}) {
    cancelEnterLead();
    run(false, reduced, finished);
  }

  /**
   * 提高当前退场动画的剩余播放速度。
   *
   * 保持当前透明度与时间位置，在指定时间内完成退出。
   *
   * @param milliseconds 允许退场剩余动画完成的时长，单位为毫秒。
   */
  function finishWithin(milliseconds: number) {
    if (root.dataset.transition !== "closing" || !(milliseconds > 0)) return;
    const remaining = Math.max(
      0,
      ...animations.map(
        (animation) => transitionDuration - Number(animation.currentTime ?? 0),
      ),
    );
    exitRate = Math.max(exitRate, remaining / milliseconds);
    animations.forEach((animation) => {
      animation.updatePlaybackRate(getBangumiMotionSpeed() * exitRate);
    });
  }

  function finish() {
    if (enterLead) {
      enterLead.start(true);
      return;
    }
    animations.forEach((animation) => {
      animation.finish();
    });
  }

  /**
   * 取消当前界面的全部过渡动画。
   *
   * 清理延迟入场及 Web Animations 对象，避免卸载后触发完成回调。
   */
  function dispose() {
    revisionCounter++;
    cancelEnterLead();
    animations.forEach((animation) => {
      animation.cancel();
    });
    animations = [];
  }

  function cancelEnterLead() {
    enterLead?.animation.cancel();
    enterLead = undefined;
  }

  /**
   * 执行一次界面显隐过渡。
   *
   * 取消旧动画并从当前计算样式续接，完成时按版本号避免旧回调覆盖新状态。
   *
   * @param show 本次过渡的目标是否为显示状态。
   * @param reduced 是否启用减少动态效果。
   * @param finished 退场完成后的回调。
   */
  function run(show: boolean, reduced: boolean, finished?: () => void) {
    const revision = ++revisionCounter;
    exitRate = 1;
    const hidden = root.hidden;
    const interrupted = animations.length > 0;
    const opacities = fadeTargets.map((target) =>
      hidden ? "0" : getComputedStyle(target).opacity,
    );
    const transform = panel
      ? hidden
        ? direction === "right"
          ? "translateX(24px)"
          : "translateY(10px)"
        : getComputedStyle(panel).transform
      : undefined;
    animations.forEach((animation) => {
      animation.cancel();
    });
    animations = [];
    root.hidden = false;
    root.dataset.transition = show ? "opening" : "closing";
    const complete = () => {
      if (revision !== revisionCounter) return;
      root.hidden = !show;
      root.dataset.transition = show ? "open" : "closed";
      animations.forEach((animation) => {
        animation.cancel();
      });
      animations = [];
      finished?.();
    };
    if (reduced || (!show && hidden)) {
      complete();
      return;
    }
    const distance = Math.max(
      ...opacities.map((opacity) => Math.abs((show ? 1 : 0) - Number(opacity))),
      0,
    );
    const baseDuration = show ? enterDuration : exitDuration;
    transitionDuration = interrupted
      ? Math.max(72, baseDuration * Math.sqrt(distance))
      : baseDuration;
    const options: KeyframeAnimationOptions = {
      duration: transitionDuration,
      easing: show ? enterEasing : exitEase,
      fill: "both",
    };
    const fades = fadeTargets.map((target, index) =>
      followBangumiMotionSpeed(
        target.animate(
          [{ opacity: opacities[index] }, { opacity: show ? 1 : 0 }],
          options,
        ),
        () => exitRate,
      ),
    );
    animations.push(...fades);
    if (panel) {
      animations.push(
        followBangumiMotionSpeed(
          panel.animate(
            [
              { transform },
              {
                transform:
                  direction === "right"
                    ? show
                      ? "translateX(0)"
                      : "translateX(32px)"
                    : show
                      ? "translateY(0)"
                      : "translateY(6px)",
              },
            ],
            options,
          ),
          () => exitRate,
        ),
      );
    }
    void Promise.all(fades.map((fade) => fade.finished))
      .then(complete)
      .catch(() => {});
  }
  return { show, hide, finishWithin, finish, dispose };
}
