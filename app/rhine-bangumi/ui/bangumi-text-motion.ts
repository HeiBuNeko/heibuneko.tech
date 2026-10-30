import {
  createRollingNumber,
  createRollingText,
} from "@kitlangton/rolling-number";
import type { ArchiveNavigation } from "../archive/archive-loop";

type SelectionText = {
  number: number;
  total: number;
  code: number;
  genreIndex: number;
  genresTotal: number;
  genre: string;
  genreName: string;
  format: string;
  artist: string;
  meta: string;
};

/**
 * 建立番剧摘要文字的分段过渡。
 *
 * 测量换行、复用文字节点并在选择变化时驱动过渡。
 *
 * @param root 当前场景或界面的根 DOM 元素。
 * @returns 文字更新与销毁句柄。
 * @throws 必需的文字容器不存在时抛出异常。
 */
export function setupBangumiTextMotion(root: HTMLElement) {
  const required = (id: string) => {
    const element = root.querySelector<HTMLElement>(`#${id}`);
    if (!element) throw new Error(`Missing bangumi text element: ${id}`);
    return element;
  };
  const host = (id: string, kind: "text" | "number") => {
    const element = required(id);
    element.classList.add(`bangumi-rolling-${kind}`);
    return element;
  };
  const motion = {
    duration: 460,
    motionBlur: false,
    animated: false,
    pauseOffscreen: false,
  };
  const pendingWraps = new Set<() => () => void>();
  let wrappingFrame = 0;
  const flushWrapping = () => {
    wrappingFrame = 0;
    const commits = [...pendingWraps].map((read) => read());
    pendingWraps.clear();
    commits.forEach((commit) => {
      commit();
    });
  };
  const queueWrapping = (read: () => () => void) => {
    pendingWraps.add(read);
    if (!wrappingFrame) wrappingFrame = requestAnimationFrame(flushWrapping);
  };
  const number = (id: string, digits = 2) =>
    createRollingNumber(host(id, "number"), {
      ...motion,
      value: 1,
      locales: "en-US",
      format: { minimumIntegerDigits: digits, useGrouping: false },
    });
  const text = (id: string) =>
    createRollingText(host(id, "text"), {
      ...motion,
      text: "",
      transition: "direct",
      stagger: "none",
      direction: "up",
    });
  /**
   * 建立可在滚动与自然换行间切换的文字控制器。
   *
   * 复用隐藏测量层计算真实宽度，不读取动画中的可见节点。
   *
   * @param id 需要绑定滚动文字的 DOM 元素 ID。
   * @returns 文字更新、完成和销毁控制句柄。
   */
  const wrappingText = (id: string) => {
    const element = required(id);
    const reel = document.createElement("span");
    const plain = document.createElement("span");
    const measure = document.createElement("span");
    reel.className = "bangumi-rolling-text bangumi-inline-reel";
    plain.className = "bangumi-inline-plain";
    plain.style.display = "none";
    plain.style.whiteSpace = "normal";
    plain.style.overflowWrap = "anywhere";
    measure.setAttribute("aria-hidden", "true");
    measure.style.cssText =
      "position:absolute;visibility:hidden;pointer-events:none;white-space:pre;width:max-content;max-width:none;";
    element.replaceChildren(reel, plain, measure);
    const controller = createRollingText(reel, {
      ...motion,
      text: "",
      transition: "direct",
      stagger: "none",
      direction: "up",
    });
    let value = "",
      animated = false,
      usingReel = true,
      measured = false,
      disposed = false;
    /**
     * 读取当前文字是否适合滚动单行显示。
     *
     * 先测量可用宽度，再返回统一提交 DOM 更新的闭包。
     * @returns 一次布局提交函数。
     */
    const readLayout = () => {
      if (disposed) return () => {};
      const style = getComputedStyle(element);
      const available =
        element.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight);
      const fits = available > 0 && measure.scrollWidth <= available;
      return () => {
        const previouslyUsingReel = usingReel;
        usingReel = fits;
        if (!measured || fits !== previouslyUsingReel) {
          reel.style.display = fits ? "inline-block" : "none";
          plain.style.display = fits ? "none" : "inline";
        }
        measured = true;
        controller.update({
          text: value,
          animated: animated && fits && previouslyUsingReel,
        });
        if (fits && !previouslyUsingReel) controller.update({ animated });
      };
    };
    const schedule = () => {
      if (!disposed) queueWrapping(readLayout);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    document.fonts.addEventListener("loadingdone", schedule);
    void document.fonts.ready.then(schedule);
    return {
      /**
       * 更新单段可换行文字。
       *
       * 同步可见文本、测量文本和滚动控制器，并按需排队布局测量。
       *
       * @param options 当前文字、动画开关及持续时间的更新值。
       */
      update(options: {
        text?: string;
        animated?: boolean;
        duration?: number;
      }) {
        if (options.duration !== undefined)
          controller.update({ duration: options.duration });
        let changedText = false;
        if (options.text !== undefined && options.text !== value) {
          changedText = true;
          value = options.text;
          element.title = value;
          plain.textContent = value;
          measure.textContent = value;
        }
        const changedMotion =
          options.animated !== undefined && options.animated !== animated;
        if (options.animated !== undefined) animated = options.animated;
        if (changedText || !measured) schedule();
        else if (changedMotion)
          controller.update({ animated: animated && usingReel });
      },
      finish() {
        animated = false;
        controller.update({ animated: false });
      },
      destroy() {
        disposed = true;
        resize.disconnect();
        document.fonts.removeEventListener("loadingdone", schedule);
        pendingWraps.delete(readLayout);
        controller.destroy();
        element.textContent = value;
      },
    };
  };
  const numbers = {
    number: number("selection-number"),
    total: number("selection-total"),
    code: number("selection-code-number", 3),
    genreIndex: number("genre-index"),
    genresTotal: number("genre-total"),
  };
  const texts = {
    genre: text("selection-genre"),
    genreName: text("genre-name"),
    format: text("selection-format"),
    artist: wrappingText("selection-artist"),
    meta: wrappingText("selection-meta"),
  };
  const controllers = [...Object.values(numbers), ...Object.values(texts)];
  let enabled = false;
  const setEnabled = (next: boolean) => {
    if (enabled === next) return;
    enabled = next;
    controllers.forEach((controller) => {
      controller.update({ animated: next });
    });
  };
  return {
    setEnabled,
    /**
     * 更新摘要中的数字与文字轨道。
     *
     * 根据行列导航方向设置滚动方向，再同步所有字段。
     *
     * @param value 当前输入或目标值。
     * @param animated 是否播放过渡动画。
     * @param navigation 本次选片的导航上下文。
     */
    update(
      value: SelectionText,
      animated: boolean,
      navigation?: ArchiveNavigation,
    ) {
      setEnabled(animated);
      const axis =
        navigation && "axis" in navigation ? navigation.axis : undefined;
      const direction =
        navigation && "axis" in navigation
          ? navigation.direction > 0
            ? "up"
            : "down"
          : "auto";
      numbers.number.update({
        value: value.number,
        direction: axis === "row" ? direction : "auto",
      });
      numbers.total.update({
        value: value.total,
        direction: axis === "lane" ? direction : "auto",
      });
      numbers.code.update({ value: value.code, direction });
      numbers.genreIndex.update({
        value: value.genreIndex,
        direction: axis === "lane" ? direction : "auto",
      });
      numbers.genresTotal.update({
        value: value.genresTotal,
        direction: "auto",
      });
      for (const key of Object.keys(texts) as (keyof typeof texts)[])
        texts[key].update({ text: value[key] });
    },
    finish() {
      setEnabled(false);
    },
    destroy() {
      cancelAnimationFrame(wrappingFrame);
      pendingWraps.clear();
      controllers.forEach((controller) => {
        controller.destroy();
      });
    },
  };
}
