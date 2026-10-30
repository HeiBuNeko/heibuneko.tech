export type MusicWheelInput = Pick<
  WheelEvent,
  "deltaMode" | "deltaX" | "deltaY" | "ctrlKey" | "shiftKey"
>;

const PIXELS_PER_ALBUM = 48;
const MAX_ALBUMS_PER_EVENT = 3;
const GESTURE_GAP_MS = 200;

/**
 * 把不同滚轮设备的增量统一到导航单位。
 *
 * 按 deltaMode 和手势幅度换算，保留自然滚动方向。
 *
 * @param event 当前键盘、鼠标或滚轮事件。
 * @param pageHeight 页面可滚动区域的高度。
 * @returns 归一化后的滚动增量。
 */
export function musicWheelDelta(event: MusicWheelInput, pageHeight: number) {
  const unit =
    event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? Math.max(1, pageHeight)
        : 1;
  if (
    event.ctrlKey ||
    event.shiftKey ||
    !Number.isFinite(event.deltaY) ||
    !Number.isFinite(event.deltaX) ||
    Math.abs(event.deltaX) >= Math.abs(event.deltaY)
  )
    return 0;
  return event.deltaY * unit;
}

/**
 * 累计滚轮输入并转换为离散选片步数。
 *
 * 按当前月份列维护手势上下文，防止残余滚动跨列触发。
 */
export class MusicWheelSteps {
  private remainder = 0;
  private direction = 0;
  private lastTime = -Infinity;

  reset() {
    this.remainder = 0;
    this.direction = 0;
    this.lastTime = -Infinity;
  }

  /**
   * 把累计滚动转换为离散选片步数。
   *
   * 在手势间隔或方向变化后重置余量，避免旧输入误触发。
   *
   * @param delta 本次滚轮事件的增量。
   * @param now 当前滚轮事件时间戳，单位为毫秒。
   * @returns 本次应导航的步数。
   */
  consume(delta: number, now: number) {
    if (!Number.isFinite(delta) || !delta) return 0;
    const direction = Math.sign(delta);
    if (
      now - this.lastTime > GESTURE_GAP_MS ||
      now < this.lastTime ||
      direction !== this.direction
    ) {
      this.remainder = 0;
    }
    this.lastTime = now;
    this.direction = direction;
    this.remainder +=
      Math.min(Math.abs(delta), PIXELS_PER_ALBUM * MAX_ALBUMS_PER_EVENT) *
      direction;
    const steps = Math.trunc(this.remainder / PIXELS_PER_ALBUM);
    this.remainder -= steps * PIXELS_PER_ALBUM;
    return steps || 0;
  }
}

type MusicWheelOptions = {
  enabled: () => boolean;
  navigate: (direction: number) => void;
  context?: () => string | number;
};

const NATIVE_WHEEL_TARGETS = [
  "input",
  "textarea",
  "select",
  "button",
  "a",
  "[contenteditable]:not([contenteditable=false])",
  "dialog",
  "[role=dialog]",
  "[role=slider]",
  ".music-panel-scrim",
  "#music-detail",
].join(",");

/**
 * 判断目标元素是否需要原生滚动。
 *
 * 详情内容及可滚动控件优先使用浏览器自身滚动。
 *
 * @param target 当前动画或灯光的目标值。
 * @param stage 接收滚轮事件的舞台元素。
 * @returns 应保留原生滚轮行为时返回真。
 */
function keepsNativeWheel(target: EventTarget | null, stage: HTMLElement) {
  if (!(target instanceof Element)) return true;
  if (target.closest(NATIVE_WHEEL_TARGETS)) return true;
  for (
    let element: Element | null = target;
    element && element !== stage;
    element = element.parentElement
  ) {
    if (element.scrollHeight <= element.clientHeight + 1) continue;
    const overflow = getComputedStyle(element).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay")
      return true;
  }
  return false;
}

/**
 * 安装番剧滚轮导航。
 *
 * 仅在允许导航时消费滚动事件，卸载句柄负责解绑监听。
 *
 * @param stage 接收滚轮事件的舞台元素。
 * @param options 场景或界面的初始化选项。
 * @returns 滚轮监听的销毁句柄。
 */
export function mountMusicWheelNavigation(
  stage: HTMLElement,
  options: MusicWheelOptions,
) {
  const steps = new MusicWheelSteps();
  let context: string | number | undefined;
  const reset = () => steps.reset();
  /**
   * 处理舞台上的滚轮输入。
   *
   * 仅在允许导航且目标不需原生滚动时消费事件。
   *
   * @param event 当前键盘、鼠标或滚轮事件。
   */
  const onWheel = (event: WheelEvent) => {
    if (
      event.defaultPrevented ||
      !options.enabled() ||
      keepsNativeWheel(event.target, stage)
    ) {
      reset();
      return;
    }
    const delta = musicWheelDelta(event, stage.clientHeight);
    if (!delta) {
      reset();
      return;
    }
    const nextContext = options.context?.();
    if (nextContext !== context) reset();
    context = nextContext;
    event.preventDefault();
    const direction = steps.consume(delta, performance.now());
    if (direction) options.navigate(direction);
  };
  stage.addEventListener("wheel", onWheel, { passive: false });
  stage.addEventListener("pointerdown", reset, { passive: true });
  stage.addEventListener("keydown", reset);
  window.addEventListener("blur", reset);
  return {
    reset,
    dispose() {
      reset();
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("pointerdown", reset);
      stage.removeEventListener("keydown", reset);
      window.removeEventListener("blur", reset);
    },
  };
}
