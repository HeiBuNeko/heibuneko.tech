import { followMusicMotionSpeed } from "../motion/music-motion";

export type TitleGlyph = {
  key: string;
  text: string;
  kind: "main" | "translation";
  x: number;
  y: number;
  width: number;
  height: number;
  font: string;
  letterSpacing: string;
};

const DURATION = 460;
const STEPS = 48;
const IDLE_SLOTS = 64;
type Sample = { value: number[]; velocity: number[] };

/**
 * 创建单个标题字符的滚动轨道。
 *
 * 保存字符面片和运动状态，允许中途改选时从当前帧继续。
 *
 * @param element 需要更新的 DOM 元素。
 * @param property 字符轨道需要更新的样式属性。
 * @param format 把字符轨道数值转换为可见字形的函数。
 * @returns 字符轨道控制句柄。
 */
function createTitleTrack(
  element: HTMLElement,
  property: "transform" | "height" | "clip-path",
  format: (value: number[]) => string,
) {
  let animation: Animation | undefined;
  let start: number[] = [];
  let velocity: number[] = [];
  let target: number[] = [];

  /**
   * 在当前字符轨道上采样位置和速度。
   *
   * 使用同一衰减曲线连接中途改选前后的字形，供新动画沿用当前速度。
   *
   * @param progress 当前动画进度。
   * @returns 字形位置与对应速度的采样值。
   */
  const at = (progress: number): Sample => {
    if (progress >= 1) return { value: target, velocity: target.map(() => 0) };
    const t = Math.max(0, progress);
    const decay = Math.exp(-10 * t);
    const seconds = DURATION / 1000;
    const value: number[] = [],
      sampledVelocity: number[] = [];
    target.forEach((destination, index) => {
      const delta = start[index] - destination;
      const advance = velocity[index] * seconds + 10 * delta;
      value.push(destination + (delta + advance * t) * decay);
      sampledVelocity.push(
        ((advance - 10 * (delta + advance * t)) * decay) / seconds,
      );
    });
    return { value, velocity: sampledVelocity };
  };

  const cancel = () => {
    if (animation) {
      animation.onfinish = null;
      animation.cancel();
      animation = undefined;
    }
  };
  const sample = (): Sample => {
    if (!animation) return { value: target, velocity: target.map(() => 0) };
    const time = animation.currentTime;
    return at(typeof time === "number" ? time / DURATION : 0);
  };
  const set = (value: number[]) => {
    cancel();
    target = value;
    element.style.setProperty(property, format(value));
  };
  /**
   * 把字符轨道从当前采样值移动到新目标。
   *
   * 保留中断瞬间的速度和字形，避免快速切换时倒跳。
   *
   * @param destination 字符轨道的目标数值。
   * @param from 字符轨道的当前采样值。
   * @param completed 轨道到达目标后执行的回调。
   */
  const move = (
    destination: number[],
    from = sample(),
    completed?: () => void,
  ) => {
    cancel();
    start = from.value.length ? from.value : destination;
    velocity = destination.map((value, index) => {
      const limit =
        (Math.max(Math.abs(start[index] - value), 1) * 12) / (DURATION / 1000);
      return Math.max(-limit, Math.min(limit, from.velocity[index] || 0));
    });
    target = destination;
    element.style.setProperty(property, format(destination));
    if (
      destination.every(
        (value, index) =>
          Math.abs(value - start[index]) < 0.001 &&
          Math.abs(velocity[index]) < 0.001,
      )
    ) {
      completed?.();
      return;
    }
    const frames = Array.from({ length: STEPS + 1 }, (_, index) => ({
      [property]: format(at(index / STEPS).value),
    }));
    const current = followMusicMotionSpeed(
      element.animate(frames, {
        duration: DURATION,
        easing: "linear",
      }),
    );
    animation = current;
    const now = element.ownerDocument.timeline.currentTime;
    if (typeof now === "number") current.startTime = now;
    current.onfinish = () => {
      if (animation !== current) return;
      cancel();
      completed?.();
    };
  };

  return {
    sample,
    set,
    move,
    finish: () => set(target),
    get finished() {
      return animation?.finished ?? Promise.resolve();
    },
    cancel,
  };
}

type TitleTrack = ReturnType<typeof createTitleTrack>;

type Face = {
  text: string;
  font: string;
  letterSpacing: string;
  height: number;
  width: number;
};
type Slot = {
  host: HTMLSpanElement;
  reel: HTMLSpanElement;
  faces: HTMLSpanElement[];
  values: Face[];
  offsets: number[];
  roll: TitleTrack;
  viewport: TitleTrack;
  position: TitleTrack;
  glyph: TitleGlyph;
  active: boolean;
};
const blankFace: Face = {
  text: "",
  font: "",
  letterSpacing: "",
  height: 0,
  width: 0,
};

/**
 * 管理标题字符的滚动与复用。
 *
 * 维护字符槽位、入退场和减少动态效果下的直接定位。
 *
 * @param visual 显示滚动字符的可见元素。
 * @param spacer 为标题滚动预留空间的元素。
 * @returns 标题滚动控制句柄。
 */
export function createTitleReels(visual: HTMLElement, spacer: HTMLElement) {
  const slots = new Map<string, Slot>();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const height = createTitleTrack(
    spacer,
    "height",
    ([value]) => `${value || 0}px`,
  );
  let heightTarget = 0;
  let settling = false;
  let revision = 0;

  /**
   * 更新字符轨道中的可见字形面片。
   *
   * 复用原有面片节点并维护可访问文本。
   *
   * @param slot 图集或阵列中的目标槽位。
   * @param values 槽位需要显示的字形面片列表。
   */
  const writeFaces = (slot: Slot, values: Face[]) => {
    while (slot.faces.length < values.length) {
      const face = document.createElement("span");
      face.className = "music-title-face";
      slot.faces.push(face);
      slot.reel.append(face);
    }
    slot.values = values.map((value) =>
      value.height ? value : { ...value, height: slot.glyph.height },
    );
    slot.offsets = [];
    let y = 0;
    slot.values.forEach((value, index) => {
      slot.offsets.push(y);
      const face = slot.faces[index];
      if (face.textContent !== value.text) face.textContent = value.text;
      face.style.font = value.font || slot.glyph.font;
      face.style.letterSpacing =
        value.letterSpacing || slot.glyph.letterSpacing;
      face.style.lineHeight = `${value.height}px`;
      face.style.height = `${value.height}px`;
      face.style.transform = `translateY(${y}px)`;
      y += value.height;
    });
    for (let index = values.length; index < slot.faces.length; index++)
      slot.faces[index].textContent = "";
    slot.host.style.height = `${Math.max(slot.glyph.height, ...slot.values.map((value) => value.height))}px`;
    slot.host.style.width = `${Math.max(slot.glyph.width, ...slot.values.map((value) => value.width)) + 0.3}px`;
  };

  /**
   * 为新的标题字形创建轨道槽位。
   *
   * 建立字符面片及动画控制，后续交给复用池管理。
   *
   * @param glyph 需要创建槽位的标题字形。
   * @returns 新建并已登记的字符槽位。
   */
  const create = (glyph: TitleGlyph) => {
    const host = document.createElement("span");
    host.className = `music-title-slot music-title-slot-${glyph.kind}`;
    const reel = document.createElement("span");
    reel.className = "music-title-wheel";
    const faces = Array.from({ length: 3 }, () => {
      const face = document.createElement("span");
      face.className = "music-title-face";
      return face;
    });
    reel.append(...faces);
    host.append(reel);
    visual.append(host);
    const slot: Slot = {
      host,
      reel,
      faces,
      values: [{ ...blankFace, height: glyph.height }],
      offsets: [0],
      glyph,
      active: false,
      roll: createTitleTrack(
        reel,
        "transform",
        ([value]) => `translateY(${-(value || 0)}px)`,
      ),
      viewport: createTitleTrack(
        host,
        "clip-path",
        ([value]) => `inset(0 0 calc(100% - ${value || 0}px) 0)`,
      ),
      position: createTitleTrack(
        host,
        "transform",
        ([x, y]) => `translate3d(${x || 0}px, ${y || 0}px, 0)`,
      ),
    };
    slot.roll.set([0]);
    slot.viewport.set([glyph.height]);
    slot.position.set([glyph.x, glyph.y]);
    slots.set(glyph.key, slot);
    return slot;
  };

  /**
   * 把字符槽位滚动到目标字形。
   *
   * 以当前采样位置为起点，避免快速改选时从旧目标重新播放。
   *
   * @param slot 图集或阵列中的目标槽位。
   * @param face 字符槽位下一步应显示的字形。
   * @param animated 是否播放过渡动画。
   */
  const rollTo = (slot: Slot, face: Face, animated: boolean) => {
    if (!animated) {
      writeFaces(slot, [face]);
      slot.roll.set([0]);
      return;
    }
    const sample = slot.roll.sample();
    const position = Math.max(0, sample.value[0] || 0);
    let first = 0;
    while (
      first + 1 < slot.offsets.length &&
      slot.offsets[first + 1] <= position
    )
      first++;
    const offset = Math.max(0, position - slot.offsets[first]);
    const values = [slot.values[first] || blankFace];
    const viewport = slot.viewport.sample().value[0] || slot.glyph.height;
    for (let index = first + 1; index < slot.values.length; index++) {
      if (slot.offsets[index] >= position + viewport - 0.001) break;
      values.push(slot.values[index]);
    }
    if (
      values.at(-1)?.text !== face.text ||
      values.at(-1)?.font !== face.font ||
      values.at(-1)?.letterSpacing !== face.letterSpacing ||
      values.at(-1)?.height !== face.height
    )
      values.push(face);
    writeFaces(slot, values);
    const target = slot.offsets.at(-1) ?? 0;
    const from = Math.min(offset, target);
    slot.roll.move(
      [target],
      {
        value: [from],
        velocity: [
          Math.max(
            0,
            Math.min(
              sample.velocity[0] || 0,
              ((target - from) * 10000) / DURATION,
            ),
          ),
        ],
      },
      () => {
        writeFaces(slot, [face]);
        slot.roll.set([0]);
      },
    );
  };

  /**
   * 完成当前所有字符轨道的过渡。
   *
   * 将进行中的动画落到目标字形并清理过渡状态。
   */
  const settle = () => {
    settling = false;
    const idle: string[] = [];
    slots.forEach((slot, key) => {
      slot.roll.finish();
      slot.position.finish();
      slot.viewport.finish();
      writeFaces(slot, [slot.active ? slot.glyph : blankFace]);
      slot.roll.set([0]);
      if (!slot.active) {
        slot.host.style.visibility = "hidden";
        idle.push(key);
      }
    });
    height.finish();
    for (const key of idle.slice(0, Math.max(0, idle.length - IDLE_SLOTS))) {
      slots.get(key)?.host.remove();
      slots.delete(key);
    }
  };
  const onReduced = () => {
    if (!reduced.matches) return;
    revision++;
    settle();
  };
  reduced.addEventListener("change", onReduced);

  return {
    get moving() {
      return settling;
    },
    /**
     * 把标题字形列表同步到轨道池。
     *
     * 复用相同位置的字符槽位，并为新增或退出的字形安排过渡。
     *
     * @param glyphs 当前标题的字形序列。
     * @param nextHeight 标题布局的目标高度。
     * @param animated 是否播放过渡动画。
     */
    render(glyphs: TitleGlyph[], nextHeight: number, animated: boolean) {
      animated = animated && !reduced.matches && !document.hidden;
      const currentRevision = ++revision;
      const active = new Set(glyphs.map((glyph) => glyph.key));
      glyphs.forEach((glyph) => {
        const slot = slots.get(glyph.key) || create(glyph);
        const old = slot.glyph;
        const changed =
          !slot.active ||
          old.text !== glyph.text ||
          old.font !== glyph.font ||
          old.letterSpacing !== glyph.letterSpacing ||
          old.height !== glyph.height;
        slot.glyph = glyph;
        slot.host.style.visibility = "";
        slot.host.style.width = `${Math.max(glyph.width, ...slot.values.map((value) => value.width)) + 0.3}px`;
        slot.host.style.fontSize =
          glyph.font.match(/([\d.]+)px/)?.[0] || "inherit";
        if (old.x !== glyph.x || old.y !== glyph.y) {
          if (animated) slot.position.move([glyph.x, glyph.y]);
          else slot.position.set([glyph.x, glyph.y]);
        }
        if (old.height !== glyph.height) {
          if (animated) slot.viewport.move([glyph.height]);
          else slot.viewport.set([glyph.height]);
        }
        if (changed) rollTo(slot, glyph, animated);
        else if (!animated) slot.roll.finish();
        slot.active = true;
      });
      slots.forEach((slot, key) => {
        if (!slot.active || active.has(key)) return;
        slot.active = false;
        rollTo(slot, blankFace, animated);
      });
      if (heightTarget !== nextHeight) {
        heightTarget = nextHeight;
        if (animated) height.move([nextHeight]);
        else height.set([nextHeight]);
      }
      if (animated) {
        settling = true;
        const motions = [height.finished];
        slots.forEach((slot) => {
          motions.push(
            slot.roll.finished,
            slot.position.finished,
            slot.viewport.finished,
          );
        });
        void Promise.all(motions)
          .then(() => {
            if (currentRevision === revision) settle();
          })
          .catch(() => {});
      } else settle();
    },
    finish() {
      revision++;
      settle();
    },
    destroy() {
      revision++;
      reduced.removeEventListener("change", onReduced);
      height.cancel();
      slots.forEach((slot) => {
        slot.roll.cancel();
        slot.position.cancel();
        slot.viewport.cancel();
      });
      slots.clear();
      visual.replaceChildren();
    },
  };
}
