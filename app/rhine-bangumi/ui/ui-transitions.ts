import {
  followMusicMotionSpeed,
  getMusicMotionSpeed,
} from "../motion/music-motion";

const enterEase = "cubic-bezier(0.22, 1, 0.36, 1)";
const exitEase = "cubic-bezier(0.4, 0, 1, 1)";

/** Owns the visible lifetime, including a close that interrupts an opening. */
export function createSurfaceTransition(
  root: HTMLElement,
  panel?: HTMLElement,
  enterDuration = 300,
  exitDuration = 200,
  direction: "up" | "right" = "up",
  enterEasing = enterEase,
  // Separate overlays can fade together without changing their common
  // ancestor's stacking context or flattening them into a full-screen layer.
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

  function show(reduced: boolean, enterDelay = 0, onShow?: () => void) {
    cancelEnterLead();
    // A hidden surface can wait for its reading field without exposing text
    // or shortening the existing entrance. Visible reversals resume in place.
    if (
      !reduced &&
      root.hidden &&
      Number.isFinite(enterDelay) &&
      enterDelay > 0
    ) {
      const revision = ++revisionCounter;
      const animation = followMusicMotionSpeed(
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

  function hide(reduced: boolean, finished: () => void = () => {}) {
    cancelEnterLead();
    run(false, reduced, finished);
  }

  /** Complete an already running exit before a moving obstacle arrives.
   * Preserve currentTime and opacity: only its remaining playback rate changes.
   * milliseconds uses the same unscaled clock as the configured duration. */
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
      animation.updatePlaybackRate(getMusicMotionSpeed() * exitRate);
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
    // A late reversal travels a short distance. Replaying a full entrance here
    // makes rapid open/back input feel sticky even when its first pixel matches.
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
      followMusicMotionSpeed(
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
        followMusicMotionSpeed(
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
