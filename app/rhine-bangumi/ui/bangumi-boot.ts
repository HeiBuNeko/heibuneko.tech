import "../styles/bangumi-boot.css";
import { bangumiIntroFrame } from "../motion/bangumi-intro-motion";
import { followBangumiMotionSpeed } from "../motion/bangumi-motion";
import {
  BANGUMI_BOOT_END_TIME,
  BANGUMI_BOOT_SCENE_REVEAL_TIME,
  BANGUMI_BOOT_START_TIME,
  BangumiBootFrameClock,
  bangumiBootSceneTime,
} from "./bangumi-boot-timing";
import {
  BANGUMI_OPENING_CAPTION,
  BangumiOpening,
  bangumiOpeningFrame,
} from "./bangumi-opening";

const REVEAL_DURATION = 720;
const REVEAL_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
export interface BangumiBootFrame {
  cinema: {
    reveal: number;
    lift: number;
    time: number;
    bangumiIntro: true;
  };
  renderScene: boolean;
  phase: "slogan" | "array" | "select";
  appTime: number;
}
export interface BangumiBootOptions {
  onStart?: () => void;
  onComplete?: (reason: "complete" | "skip") => void;
  reduced?: boolean | (() => boolean);
  album?: () => { title: string; artist?: string } | null | undefined;
}
type SavedSibling = {
  node: HTMLElement;
  inert: boolean;
  visibility: string;
  priority: string;
};

/**
 * 管理番剧开场遮罩和阶段切换。
 *
 * 控制开场画面、跳过操作与正式场景的交接，卸载时释放动画和监听。
 */
export class BangumiBoot {
  readonly root: HTMLElement;
  private readonly skipButton: HTMLButtonElement;
  private readonly opening: BangumiOpening;
  private readonly frameClock = new BangumiBootFrameClock();
  private running = false;
  private revealing = false;
  private revealRevision = 0;
  private revealAnimations: Animation[] = [];
  private revealFocus: HTMLElement | null = null;
  private endpointRendered = false;
  private disposed = false;
  private siblings: SavedSibling[] = [];
  private opener: HTMLElement | null = null;

  /**
   * 建立开场遮罩和跳过交互。
   *
   * 初始化 DOM 与时间轴；相应监听在 dispose 时清理。
   *
   * @param parent 开场内容挂载的 DOM 容器。
   * @param options 场景或界面的初始化选项。
   */
  constructor(
    private parent: HTMLElement,
    private options: BangumiBootOptions = {},
  ) {
    this.root = document.createElement("section");
    this.root.className = "bangumi-boot-overlay";
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute(
      "aria-label",
      `番剧开场：${BANGUMI_OPENING_CAPTION}`,
    );
    this.root.tabIndex = -1;
    this.opening = new BangumiOpening(this.root);
    this.skipButton = document.createElement("button");
    this.skipButton.type = "button";
    this.skipButton.className = "bangumi-boot-skip";
    this.skipButton.textContent = "跳过进场";
    this.root.appendChild(this.skipButton);
    this.parent.appendChild(this.root);
    this.skipButton.addEventListener("click", () => this.skip());
    this.root.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (this.revealing) {
        event.preventDefault();
        return;
      }
      if (event.key === "Escape" || event.key === "Enter") {
        event.preventDefault();
        this.skip();
      } else if (event.key === "Tab") {
        event.preventDefault();
        this.skipButton.focus({ preventScroll: true });
      }
    });
  }
  get active() {
    return this.running || this.revealing;
  }

  start(nowSeconds = performance.now() / 1000) {
    this.begin(nowSeconds);
  }

  /**
   * 开始开场阶段的时间轴。
   *
   * 设置初始界面状态并启动需要的视觉过渡。
   *
   * @param nowSeconds 当前时间，单位为秒。
   */
  private begin(nowSeconds: number) {
    if (this.disposed) return;
    if (!Number.isFinite(nowSeconds)) nowSeconds = performance.now() / 1000;
    if (this.revealing) this.completeReveal(false);
    if (!this.running) {
      this.opener =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      this.siblings = [...this.parent.children]
        .filter(
          (node): node is HTMLElement =>
            node instanceof HTMLElement && node !== this.root,
        )
        .map((node) => ({
          node,
          inert: node.inert,
          visibility: node.style.getPropertyValue("visibility"),
          priority: node.style.getPropertyPriority("visibility"),
        }));
      for (const { node } of this.siblings) {
        node.inert = true;
        if (!node.classList.contains("three-scene"))
          node.style.setProperty("visibility", "hidden");
      }
    }
    this.running = true;
    this.endpointRendered = false;
    this.parent.dataset.bangumiBoot = "running";
    const startTime = BANGUMI_BOOT_START_TIME;
    this.frameClock.reset(nowSeconds, startTime);
    this.opening.update(0);
    this.root.hidden = false;
    this.root.dataset.phase = "slogan";
    this.root.dataset.appTime = String(startTime);
    this.root.setAttribute(
      "aria-label",
      `番剧开场：${BANGUMI_OPENING_CAPTION}`,
    );
    this.skipButton.hidden = false;
    this.options.onStart?.();
    const reduced =
      typeof this.options.reduced === "function"
        ? this.options.reduced()
        : this.options.reduced;
    if (reduced) {
      this.skip();
      return;
    }
    this.root.focus({ preventScroll: true });
  }
  skip() {
    if (this.running && !this.disposed) this.finish("skip");
  }

  /**
   * 按当前时间推进开场动画。
   *
   * 协调遮罩、文字和场景是否需要本帧渲染。
   *
   * @param nowSeconds 当前时间，单位为秒。
   * @returns 本帧的开场控制状态。
   */
  update(nowSeconds: number): BangumiBootFrame | undefined {
    if (this.revealing && this.isReduced()) this.completeReveal();
    if (!this.running || this.disposed || !Number.isFinite(nowSeconds)) return;
    if (this.isReduced()) {
      this.skip();
      return;
    }
    if (this.endpointRendered) {
      this.finish("complete");
      return;
    }
    const appTime = this.frameClock.update(nowSeconds);
    this.endpointRendered = appTime === BANGUMI_BOOT_END_TIME;
    this.opening.update(appTime);
    const sceneTime = bangumiBootSceneTime(appTime);
    const phase =
      bangumiIntroFrame(sceneTime) >= 89
        ? "select"
        : bangumiOpeningFrame(appTime).phase;
    this.root.dataset.phase = phase;
    this.root.dataset.appTime = String(appTime);
    return {
      appTime,
      phase,
      renderScene: appTime >= BANGUMI_BOOT_SCENE_REVEAL_TIME,
      cinema: {
        reveal: ease((sceneTime - 21.9) / 0.13),
        lift: 0,
        time: sceneTime,
        bangumiIntro: true,
      },
    };
  }
  /**
   * 完成或跳过开场。
   *
   * 终止进行中的过渡并只调用一次交接回调。
   *
   * @param reason 开场结束或被跳过的原因。
   * @param notify 是否通知外部开场完成回调。
   */
  private finish(reason: "complete" | "skip", notify = true) {
    this.running = false;
    this.opening.root.hidden = true;
    this.root.hidden = true;
    for (const { node, inert, visibility, priority } of this.siblings) {
      node.inert = inert;
      if (visibility)
        node.style.setProperty("visibility", visibility, priority);
      else node.style.removeProperty("visibility");
    }
    if (notify) this.options.onComplete?.(reason);
    this.revealFocus =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body &&
      !this.root.contains(document.activeElement)
        ? document.activeElement
        : this.opener;
    if (!notify || this.isReduced()) {
      this.siblings = [];
      this.parent.dataset.bangumiBoot = "done";
      if (notify) this.restoreFocus();
      return;
    }

    for (const sibling of this.siblings) {
      sibling.inert = sibling.node.inert;
      sibling.node.inert = true;
    }
    this.revealing = true;
    this.parent.dataset.bangumiBoot = "revealing";
    this.root.hidden = false;
    this.skipButton.hidden = true;
    this.root.setAttribute("aria-label", "正在显示番剧档案");
    this.root.focus({ preventScroll: true });
    const revision = ++this.revealRevision;
    /**
     * 按开场时间轴安排遮罩淡入淡出。
     *
     * 使用全局动态速度，避免跳过时留下仍运行的动画。
     *
     * @param selector 需要执行淡入淡出的目标元素选择器。
     * @param delay 淡入开始前的延迟，单位为毫秒。
     */
    const fade = (selector: string, delay = 0) => {
      const node = this.parent.querySelector<HTMLElement>(selector);
      if (!node || node.hidden) return;
      this.revealAnimations.push(
        followBangumiMotionSpeed(
          node.animate(
            [{ opacity: 0 }, { opacity: getComputedStyle(node).opacity }],
            {
              duration: REVEAL_DURATION - delay,
              delay,
              easing: REVEAL_EASE,
              fill: "both",
            },
          ),
        ),
      );
    };
    fade(".bangumi-vignette");
    fade(".bangumi-header");
    fade(".bangumi-view-toggle");
    fade(".library-status", 45);
    fade(".bangumi-bottomline", 90);
    fade(".bangumi-empty", 60);
    for (const selector of [
      ".bangumi-counter",
      ".album-stepper",
      ".genre-stepper",
    ])
      fade(selector, 110);
    for (const [selector, delay] of [
      [".album-callout", 60],
      [".bangumi-keyhint", 140],
    ] as const) {
      const node = this.parent.querySelector<HTMLElement>(selector);
      if (!node) continue;
      this.revealAnimations.push(
        followBangumiMotionSpeed(
          node.animate(
            [
              { translate: "0 8px" },
              { translate: getComputedStyle(node).translate },
            ],
            {
              duration: REVEAL_DURATION - delay,
              delay,
              easing: REVEAL_EASE,
              fill: "both",
            },
          ),
        ),
      );
    }
    void Promise.all(
      this.revealAnimations.map((animation) => animation.finished),
    )
      .then(() => {
        if (revision === this.revealRevision && !this.disposed)
          this.completeReveal();
      })
      .catch(() => {});
  }
  private isReduced() {
    return typeof this.options.reduced === "function"
      ? this.options.reduced()
      : this.options.reduced;
  }
  private restoreFocus() {
    if (
      this.revealFocus?.isConnected &&
      !this.revealFocus.closest("[inert], [hidden]")
    )
      this.revealFocus.focus({ preventScroll: true });
    this.revealFocus = null;
  }
  private completeReveal(restoreFocus = true) {
    this.revealRevision++;
    for (const animation of this.revealAnimations) animation.cancel();
    this.revealAnimations = [];
    this.revealing = false;
    this.root.hidden = true;
    this.parent.dataset.bangumiBoot = "done";
    for (const { node, inert } of this.siblings) node.inert = inert;
    this.siblings = [];
    if (restoreFocus) this.restoreFocus();
    else this.revealFocus = null;
  }
  dispose() {
    if (this.disposed) return;
    if (this.running) this.finish("skip", false);
    if (this.revealing) this.completeReveal(false);
    this.disposed = true;
    this.root.remove();
  }
}
