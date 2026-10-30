import {
  type ArchiveNavigation,
  nearestOccurrence,
  wrap,
} from "../archive/archive-loop";

type BangumiRulerItem = { index: number; title: string; id?: string };
type Spring = { value: number; velocity: number };
type RulerSlot = {
  button: HTMLButtonElement;
  mark: HTMLSpanElement;
  ordinal: number;
  x: number;
  offset: Spring;
  presence: Spring;
  height: Spring;
  opacity: Spring;
  revealAt: number;
  rippleAt: number;
  pointer: boolean;
  focused: boolean;
};

const CAPACITY = 12;
const OVERSCAN = 2;
const POOL_SIZE = CAPACITY + OVERSCAN * 2;
const ANCHOR = 5;
const RIPPLE_DURATION = 560;

function spring(value: number): Spring {
  return { value, velocity: 0 };
}

/**
 * 按临界阻尼逼近刻度目标位置。
 *
 * 限制过冲并保留可用速度，使连续选片仍保持平滑。
 *
 * @param state 需要原位更新的运动状态。
 * @param target 当前动画或灯光的目标值。
 * @param seconds 动画步长或收敛时长，单位为秒。
 * @param instant 是否立即完成位置更新。
 * @returns 本次是否仍发生运动。
 */
function approach(
  state: Spring,
  target: number,
  seconds: number,
  instant: boolean,
) {
  if (
    instant ||
    (Math.abs(state.value - target) < 0.001 && Math.abs(state.velocity) < 0.01)
  ) {
    state.value = target;
    state.velocity = 0;
    return false;
  }
  const frequency = 10 / 0.46;
  const delta = state.value - target;
  const decay = Math.exp(-frequency * seconds);
  const advance = (state.velocity + frequency * delta) * seconds;
  state.value = target + (delta + advance) * decay;
  state.velocity = (state.velocity - frequency * advance) * decay;
  return true;
}

/**
 * 建立可复用的番剧导航刻度。
 *
 * 维护可见刻度池、测量布局和选择动画，卸载时销毁相关节点。
 *
 * @param host 后处理所对应的 DOM 容器。
 * @returns 刻度更新与销毁句柄。
 */
export function setupBangumiRuler(host: HTMLElement) {
  const events = new AbortController();
  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  let items: BangumiRulerItem[] = [];
  let groupKey = "";
  let selectedIndex = -1;
  let selectedOrdinal = 0;
  let populated = false;
  let reduced = false;
  let looping = true;
  let disposed = false;
  let frame = 0;
  let lastFrame = 0;
  let motionTime = 0;
  let clockTime = performance.now();
  const motionNow = (now: number) => {
    motionTime += Math.max(0, now - clockTime);
    clockTime = Math.max(clockTime, now);
    return motionTime;
  };
  let tickWidth = 3;
  let gap = 8;
  let restHeight = 10;
  let fullHeight = 30;
  let hoverHeight = 22;
  let step = tickWidth + gap;
  const scroll = spring(0);
  const width = spring(0);
  let scrollTarget = 0;

  host.classList.add("bangumi-ruler");
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", "选择番剧");

  const slots: RulerSlot[] = Array.from({ length: POOL_SIZE }, (_, ordinal) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bangumi-ruler-slot";
    button.disabled = true;
    button.tabIndex = -1;
    button.dataset.visible = "false";
    button.setAttribute("aria-hidden", "true");
    const mark = document.createElement("span");
    mark.className = "bangumi-ruler-mark";
    mark.setAttribute("aria-hidden", "true");
    button.appendChild(mark);
    const slot: RulerSlot = {
      button,
      mark,
      ordinal,
      x: ordinal * step,
      offset: spring(0),
      presence: spring(0),
      height: spring(restHeight),
      opacity: spring(0.28),
      revealAt: 0,
      rippleAt: -Infinity,
      pointer: false,
      focused: false,
    };
    for (const [name, field, value] of [
      ["pointerenter", "pointer", true],
      ["pointerleave", "pointer", false],
      ["focus", "focused", true],
      ["blur", "focused", false],
    ] as const) {
      button.addEventListener(
        name,
        () => {
          slot[field] = value;
          schedule();
        },
        { signal: events.signal },
      );
    }
    return slot;
  });
  host.replaceChildren(...slots.map((slot) => slot.button));

  const overflowing = () => items.length > CAPACITY;
  const instantMotion = () => reduced || reducedQuery.matches;
  const visibleCount = () => Math.min(CAPACITY, items.length);
  const targetWidth = () => Math.max(0, visibleCount() * step - gap);
  const validOrdinal = (ordinal: number) =>
    items.length > 0 &&
    ((looping && overflowing()) || (ordinal >= 0 && ordinal < items.length));
  const itemAt = (ordinal: number) =>
    validOrdinal(ordinal) ? items[wrap(ordinal, items.length)] : undefined;
  const selectionScroll = () =>
    !overflowing()
      ? 0
      : looping
        ? selectedOrdinal - ANCHOR
        : Math.max(
            0,
            Math.min(items.length - CAPACITY, selectedOrdinal - ANCHOR),
          );

  /**
   * 测量刻度所在容器与文字的实际尺寸。
   *
   * 把读布局与写样式分开，避免动画过程中重复强制排版。
   */
  function measure() {
    const css = getComputedStyle(host);
    const read = (name: string, fallback: number) =>
      Number.parseFloat(css.getPropertyValue(name)) || fallback;
    const oldStep = step;
    tickWidth = read("--tick-width", 3);
    gap = read("--tick-gap", 8);
    restHeight = read("--tick-rest", 10);
    fullHeight = read("--tick-height", 30);
    hoverHeight = read("--tick-hover", 22);
    step = tickWidth + gap;
    if (step !== oldStep) {
      const ratio = step / oldStep;
      width.value *= ratio;
      width.velocity *= ratio;
      slots.forEach((slot) => {
        slot.x *= ratio;
        slot.offset.value *= ratio;
        slot.offset.velocity *= ratio;
      });
    }
  }

  /**
   * 同步一个复用刻度的当前记录与可访问状态。
   *
   * 空槽位会清除旧记录的选择属性，避免循环复用时指向错误番剧。
   *
   * @param slot 需要更新的刻度槽位。
   */
  function labelSlot(slot: RulerSlot) {
    const item = itemAt(slot.ordinal);
    const active = Boolean(item) && slot.ordinal === selectedOrdinal;
    slot.button.classList.toggle("active", active);
    slot.button.setAttribute("aria-current", String(active));
    slot.button.setAttribute("aria-pressed", String(active));
    if (item) {
      slot.button.dataset.select = String(item.index);
      slot.button.dataset.rulerStep = String(slot.ordinal - selectedOrdinal);
      slot.button.setAttribute("aria-label", `选择番剧 ${item.title}`);
      slot.button.title = item.title;
    } else {
      delete slot.button.dataset.select;
      delete slot.button.dataset.rulerStep;
      slot.button.removeAttribute("aria-label");
      slot.button.removeAttribute("title");
    }
  }

  /**
   * 回收离开可见窗口的刻度节点。
   *
   * 保留节点池供后续导航复用，减少频繁创建 DOM。
   */
  function recycle() {
    if (!overflowing()) return;
    const start = Math.floor(scroll.value) - OVERSCAN;
    const end = start + POOL_SIZE;
    const free = slots.filter((slot) => {
      if (slot.ordinal >= start && slot.ordinal < end) return false;
      const x = (slot.ordinal - scroll.value) * step + slot.offset.value;
      return (
        slot.presence.value <= 0.025 ||
        x + tickWidth <= 0.5 ||
        x >= width.value - 0.5
      );
    });
    const present = new Set(
      slots
        .filter((slot) => slot.ordinal >= start && slot.ordinal < end)
        .map((slot) => slot.ordinal),
    );
    for (let ordinal = start; ordinal < end; ordinal++) {
      if (present.has(ordinal)) continue;
      const slot = free.shift();
      if (!slot) break;
      slot.ordinal = ordinal;
      slot.offset.value = slot.offset.velocity = 0;
      slot.presence.value = 1;
      slot.presence.velocity = 0;
      slot.height.value = ordinal === selectedOrdinal ? fullHeight : restHeight;
      slot.height.velocity = 0;
      slot.opacity.value = ordinal === selectedOrdinal ? 1 : 0.28;
      slot.opacity.velocity = 0;
      slot.revealAt = 0;
      slot.rippleAt = -Infinity;
      slot.pointer = false;
      labelSlot(slot);
    }
  }

  /**
   * 渲染当前可见刻度及其状态。
   *
   * 复用节点并根据选中项与布局计算位置，避免每次导航重建全部刻度。
   *
   * @param now 当前动画时间戳，单位为毫秒。
   * @param seconds 动画步长或收敛时长，单位为秒。
   * @param forceInstant 是否跳过当前刻度动画直接排布。
   * @returns 刻度或波纹是否仍需后续动画帧。
   */
  function render(now: number, seconds: number, forceInstant = false) {
    const instant = forceInstant || instantMotion();
    let moving = approach(scroll, scrollTarget, seconds, instant);
    moving = approach(width, targetWidth(), seconds, instant) || moving;
    recycle();
    host.dataset.overflow = String(overflowing());
    host.dataset.reduced = String(instantMotion());
    host.style.width = `${Math.max(0, width.value).toFixed(3)}px`;
    const focused = document.activeElement;
    let lostFocus = false;
    for (const slot of slots) {
      const valid = validOrdinal(slot.ordinal);
      const active = valid && slot.ordinal === selectedOrdinal;
      if (instant) {
        slot.revealAt = now;
        slot.rippleAt = -Infinity;
      }
      const revealed = now >= slot.revealAt;
      const presenceTarget = valid ? Number(revealed) : Number(!revealed);
      moving =
        approach(slot.presence, presenceTarget, seconds, instant) || moving;
      moving = approach(slot.offset, 0, seconds, instant) || moving;
      slot.x = (slot.ordinal - scroll.value) * step + slot.offset.value;
      const visible =
        valid &&
        (instant || revealed) &&
        slot.presence.value > 0.025 &&
        slot.x + tickWidth > 0.5 &&
        slot.x < width.value - 0.5;
      slot.button.disabled = !visible;
      slot.button.tabIndex = visible ? 0 : -1;
      slot.button.dataset.visible = String(visible);
      slot.button.setAttribute("aria-hidden", String(!visible));
      if (!visible && slot.button === focused) lostFocus = true;
      const hovering = visible && (slot.pointer || slot.focused);
      const rippleProgress = (now - slot.rippleAt) / RIPPLE_DURATION;
      const rippling =
        !instant && valid && rippleProgress >= 0 && rippleProgress < 1;
      const contraction = rippling
        ? 0.4 * Math.sin(Math.PI * rippleProgress)
        : 0;
      const heightTarget = active
        ? fullHeight
        : hovering
          ? hoverHeight
          : restHeight * (1 - contraction);
      const opacityTarget = active || hovering ? 1 : 0.28 - contraction * 0.2;
      moving = approach(slot.height, heightTarget, seconds, instant) || moving;
      moving =
        approach(slot.opacity, opacityTarget, seconds, instant) || moving;
      moving =
        moving ||
        (!instant &&
          (!revealed || (valid && now < slot.rippleAt + RIPPLE_DURATION)));
      slot.button.style.transform = `translate3d(${slot.x.toFixed(3)}px, 0, 0)`;
      slot.button.style.opacity = String(
        Math.max(0, Math.min(1, slot.presence.value)),
      );
      slot.button.style.setProperty(
        "--ruler-presence",
        String(slot.presence.value),
      );
      slot.mark.style.setProperty(
        "--ruler-height",
        `${Math.max(0, slot.height.value).toFixed(3)}px`,
      );
      slot.mark.style.setProperty(
        "--ruler-opacity",
        String(Math.max(0, Math.min(1, slot.opacity.value))),
      );
    }
    if (lostFocus) {
      const active = slots.find(
        (slot) => slot.ordinal === selectedOrdinal && !slot.button.disabled,
      );
      (active || slots.find((slot) => !slot.button.disabled))?.button.focus({
        preventScroll: true,
      });
    }
    return moving;
  }

  function animate(now: number) {
    frame = 0;
    if (disposed) return;
    now = motionNow(now);
    const seconds = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (render(now, seconds) && !frame) frame = requestAnimationFrame(animate);
  }

  function schedule() {
    if (disposed || frame) return;
    lastFrame = motionNow(performance.now());
    frame = requestAnimationFrame(animate);
  }

  /**
   * 在布局变化后重新组织刻度节点。
   *
   * 保留当前选择与运动状态，并按新尺寸重新分组。
   *
   * @param now 当前动画时间戳，单位为毫秒。
   * @param instant 是否立即完成位置更新。
   */
  function regroup(now: number, instant: boolean) {
    scrollTarget = selectionScroll();
    scroll.value = scrollTarget;
    scroll.velocity = 0;
    const start = overflowing() ? Math.floor(scroll.value) - OVERSCAN : 0;
    const ordinals = Array.from({ length: POOL_SIZE }, (_, i) => start + i);
    ordinals.sort((a, b) => {
      const aVisible =
        validOrdinal(a) && a - scroll.value >= 0 && a - scroll.value < CAPACITY;
      const bVisible =
        validOrdinal(b) && b - scroll.value >= 0 && b - scroll.value < CAPACITY;
      return Number(bVisible) - Number(aVisible) || a - b;
    });
    const available = new Set(slots);
    for (const ordinal of ordinals) {
      const x = (ordinal - scroll.value) * step;
      const slot = [...available].sort(
        (a, b) => Math.abs(a.x - x) - Math.abs(b.x - x),
      )[0];
      available.delete(slot);
      const valid = validOrdinal(ordinal);
      const wasVisible =
        slot.presence.value > 0.025 &&
        slot.x + tickWidth > 0.5 &&
        slot.x < width.value - 0.5;
      slot.ordinal = ordinal;
      slot.offset.value = instant || !wasVisible ? 0 : slot.x - x;
      if (instant || !wasVisible) slot.offset.velocity = 0;
      if (!wasVisible) {
        slot.presence.value = slot.presence.velocity = 0;
        slot.height.value = restHeight;
        slot.height.velocity = 0;
        slot.opacity.value = 0.28;
        slot.opacity.velocity = 0;
      }
      const order = Math.max(0, Math.min(CAPACITY - 1, ordinal - scroll.value));
      const delay = instant ? 0 : order * 24;
      const changesPresence = valid
        ? slot.presence.value < 0.025
        : slot.presence.value > 0.025;
      slot.revealAt = changesPresence ? now + delay : now;
      slot.rippleAt = instant ? -Infinity : now + delay;
      slot.pointer = false;
      labelSlot(slot);
    }
  }

  const onResize = () => {
    measure();
    schedule();
  };
  const onReduced = () => {
    render(motionNow(performance.now()), 0, instantMotion());
    schedule();
  };
  window.addEventListener("resize", onResize, { signal: events.signal });
  reducedQuery.addEventListener("change", onReduced);
  measure();

  return {
    /**
     * 同步刻度数据与选中项。
     *
     * 根据导航方向安排入退场和位置更新，不改变外部选择状态。
     *
     * @param nextItems 当前月份列的新刻度数据。
     * @param selected 当前选中的番剧索引或状态。
     * @param reduceMotion 是否启用减少动态效果。
     * @param navigation 本次选片的导航上下文。
     * @param loop 刻度导航是否在当前列内循环。
     */
    update(
      nextItems: BangumiRulerItem[],
      selected: number,
      reduceMotion: boolean,
      navigation?: ArchiveNavigation,
      loop = true,
    ) {
      if (disposed) return;
      reduced = reduceMotion;
      const now = motionNow(performance.now());
      const nextKey = JSON.stringify(
        nextItems.map((item) => [item.id ?? item.index, item.index]),
      );
      const changedGroup = nextKey !== groupKey || loop !== looping;
      const changedSelection = selected !== selectedIndex;
      const first = !populated;
      const row = Math.max(
        0,
        nextItems.findIndex((item) => item.index === selected),
      );
      const rowDirection =
        navigation && "axis" in navigation && navigation.axis === "row"
          ? navigation.direction
          : 0;
      items = nextItems;
      looping = loop;
      groupKey = nextKey;
      selectedIndex = selected;
      if (changedGroup || first) {
        selectedOrdinal = row;
        regroup(now, first || instantMotion());
      } else if (changedSelection || rowDirection) {
        if (looping && overflowing()) {
          if (rowDirection) {
            const candidate = selectedOrdinal + rowDirection;
            if (wrap(candidate, items.length) === row)
              selectedOrdinal = candidate;
            else {
              const delta =
                rowDirection > 0
                  ? wrap(row - selectedOrdinal, items.length)
                  : -wrap(selectedOrdinal - row, items.length);
              selectedOrdinal += delta;
            }
          } else
            selectedOrdinal = nearestOccurrence(
              row,
              scroll.value + ANCHOR,
              items.length,
            );
        } else selectedOrdinal = row;
        scrollTarget = selectionScroll();
      }
      slots.forEach(labelSlot);
      populated = populated || items.length > 0;
      render(now, 0, first || instantMotion());
      schedule();
    },
    destroy() {
      disposed = true;
      cancelAnimationFrame(frame);
      events.abort();
      reducedQuery.removeEventListener("change", onReduced);
    },
  };
}
