import { createTitleReels, type TitleGlyph } from "./bangumi-title-reels";
import { escapeHtml } from "./html";

export function albumTitleParts(title: string) {
  const match = title.trim().match(/^(.+?)[（(]([^（）()]+)[）)]\s*$/u);
  if (
    match &&
    /\p{Script=Han}/u.test(match[1]) &&
    /[a-z]/i.test(match[2]) &&
    !/\p{Script=Han}/u.test(match[2])
  ) {
    return { main: match[1].trim(), translation: match[2].trim() };
  }
  return { main: title, translation: "" };
}

export function albumTitleMarkup(title: string) {
  const { main, translation } = albumTitleParts(title);
  return `<span class="bangumi-title-main">${escapeHtml(main)}</span>${translation ? `<span class="bangumi-title-translation">${escapeHtml(translation)}</span>` : ""}`;
}

type Candidate = {
  root: HTMLSpanElement;
  main: HTMLSpanElement;
  translation: HTMLSpanElement;
  size: number;
};
type TitleLayout = { size: number; height: number; glyphs: TitleGlyph[] };

/**
 * 比较两个标题排版是否等价。
 *
 * 逐项检查换行和字形位置，避免无变化时重建动画。
 *
 * @param a 第一个待比较对象或数值。
 * @param b 第二个待比较对象或数值。
 * @returns 排版结构是否相同。
 */
function sameLayout(a: TitleLayout | undefined, b: TitleLayout) {
  return (
    !!a &&
    a.size === b.size &&
    a.height === b.height &&
    a.glyphs.length === b.glyphs.length &&
    a.glyphs.every((glyph, index) => {
      const next = b.glyphs[index];
      return (
        glyph.key === next.key &&
        glyph.text === next.text &&
        glyph.x === next.x &&
        glyph.y === next.y &&
        glyph.width === next.width &&
        glyph.height === next.height &&
        glyph.font === next.font &&
        glyph.letterSpacing === next.letterSpacing
      );
    })
  );
}

/**
 * 测量并管理番剧标题的可见排版。
 *
 * 使用隔离测量层避免动画污染布局，并复用当前标题节点。
 *
 * @param root 当前场景或界面的根 DOM 元素。
 * @returns 标题更新与销毁句柄。
 * @throws 标题或布局依赖的 DOM 元素不存在时抛出异常。
 */
export function setupBangumiTitleLayout(root: HTMLElement) {
  const required = (selector: string) => {
    const element = root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing bangumi title element: ${selector}`);
    return element;
  };
  const title = required("#selection-title");
  const callout = required(".album-callout");
  const navigation = required(".bangumi-navigation");
  const spacer = document.createElement("span");
  spacer.className = "bangumi-title-layout";
  spacer.setAttribute("aria-hidden", "true");
  const visual = document.createElement("span");
  visual.className = "bangumi-title-rolling";
  visual.setAttribute("aria-hidden", "true");
  title.replaceChildren(spacer, visual);
  const reels = createTitleReels(visual, spacer);
  const probe = document.createElement("h1");
  probe.className = "bangumi-title-probe";
  probe.setAttribute("aria-hidden", "true");
  probe.inert = true;
  callout.append(probe);
  const candidates: Candidate[] = [];
  const cache = new Map<string, TitleLayout>();
  const segmenter =
    typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : undefined;
  const canvas = document.createElement("canvas").getContext("2d");
  if (!canvas) throw new Error("Unable to measure bangumi title text");
  let text = "",
    displayed = "",
    enabled = false,
    animateNext = false;
  let scheduled = 0,
    destroyed = false,
    bottomGap = -1,
    fontsVersion = 0;
  let appliedKey = "";
  let appliedViewport = "";
  let appliedLayout: TitleLayout | undefined;

  /**
   * 准备指定的标题候选节点。
   *
   * 复用已有 DOM 并只在缺失时创建测量节点。
   *
   * @param index 测量层中的候选槽位索引。
   * @returns 可供测量的候选节点。
   */
  const ensureCandidate = (index: number) => {
    let candidate = candidates[index];
    if (candidate) return candidate;
    const element = document.createElement("span");
    element.className = "bangumi-title-candidate";
    const main = document.createElement("span");
    main.className = "bangumi-title-main";
    const translation = document.createElement("span");
    translation.className = "bangumi-title-translation";
    element.append(main, translation);
    probe.append(element);
    candidate = { root: element, main, translation, size: 0 };
    candidates.push(candidate);
    return candidate;
  };

  /**
   * 把候选标题布置到测量层。
   *
   * 设置候选尺寸与内容，供后续布局比较。
   *
   * @param index 测量层中的候选槽位索引。
   * @param size 当前标题候选使用的字号。
   * @returns 已更新内容和字号的候选节点。
   */
  const stageCandidate = (index: number, size: number) => {
    const candidate = ensureCandidate(index);
    const parts = albumTitleParts(text);
    if (candidate.main.textContent !== parts.main)
      candidate.main.textContent = parts.main;
    if (candidate.translation.textContent !== parts.translation)
      candidate.translation.textContent = parts.translation;
    candidate.translation.hidden = !parts.translation;
    if (candidate.size !== size) {
      candidate.size = size;
      candidate.root.style.fontSize = `${size}px`;
    }
    candidate.root.style.display = "block";
    return candidate;
  };

  const fits = (candidate: Candidate, budget: number, lineRatio: number) =>
    candidate.root.getBoundingClientRect().height <= budget + 1 &&
    candidate.main.getBoundingClientRect().height <=
      candidate.size * lineRatio * 2 + 1;

  /**
   * 读取标题候选在测量层中的真实布局。
   *
   * 记录每个字形的换行与位置，供后续标题切换动画使用。
   *
   * @param candidate 需要测量的标题候选布局。
   * @param budget 当前标题候选可占用的垂直高度。
   * @param overflow 是否允许候选标题超过正常行高边界。
   * @returns 候选标题的排版快照。
   */
  const snapshot = (
    candidate: Candidate,
    budget: number,
    overflow: boolean,
  ): TitleLayout => {
    const glyphs: TitleGlyph[] = [];
    let y = 0;
    for (const kind of ["main", "translation"] as const) {
      const element = candidate[kind];
      const node = element.firstChild;
      const source = node?.textContent;
      if (element.hidden || !node || !source) continue;
      const style = getComputedStyle(element);
      const lineHeight = Number.parseFloat(style.lineHeight);
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const elementRect = element.getBoundingClientRect();
      let offset = 0;
      const segments = segmenter
        ? [...segmenter.segment(source)].map((part) => ({
            text: part.segment,
            index: part.index,
          }))
        : [...source].map((character) => {
            const index = offset;
            offset += character.length;
            return { text: character, index };
          });
      const range = document.createRange();
      const lines: TitleGlyph[][] = [];
      let firstTop: number | undefined;
      for (const segment of segments) {
        range.setStart(node, segment.index);
        range.setEnd(node, segment.index + segment.text.length);
        const rect = range.getBoundingClientRect();
        firstTop ??= rect.top;
        const line = Math.max(
          0,
          Math.round((rect.top - firstTop) / lineHeight),
        );
        lines[line] ??= [];
        const row = lines[line];
        if (!rect.width) continue;
        row.push({
          key: `${kind}:${line}:${row.length}`,
          text: segment.text,
          kind,
          x: rect.left - elementRect.left,
          y: 0,
          width: rect.width,
          height: lineHeight,
          font,
          letterSpacing: style.letterSpacing,
        });
      }
      const visible = overflow ? lines.slice(0, 2) : lines;
      if (kind === "translation") y += Number.parseFloat(style.marginTop) || 0;
      visible.forEach((row, line) => {
        if (lines.length > visible.length && line === visible.length - 1) {
          canvas.font = font;
          const spacing = Number.parseFloat(style.letterSpacing) || 0;
          const width = canvas.measureText("…").width + spacing;
          while (row.length) {
            const last = row.at(-1);
            if (!last || last.x + last.width + width <= elementRect.width)
              break;
            row.pop();
          }
          const last = row.at(-1);
          const x = last ? last.x + last.width : 0;
          row.push({
            key: `${kind}:${line}:${row.length}`,
            text: "…",
            kind,
            x,
            y: 0,
            width,
            height: lineHeight,
            font,
            letterSpacing: style.letterSpacing,
          });
        }
        for (const glyph of row) {
          glyph.y = y + line * lineHeight;
          glyphs.push(glyph);
        }
      });
      y += visible.length * lineHeight;
    }
    return { size: candidate.size, height: Math.min(y, budget), glyphs };
  };

  /**
   * 测量标题候选在当前容器中的占用空间。
   *
   * 使用独立测量节点获得字形宽高，不读取正在动画的可见节点。
   *
   * @param width 视口或渲染区域的宽度。
   * @param budget 当前标题候选可占用的垂直高度。
   * @param base 测量标题布局的基准尺寸。
   * @param lineRatio 候选布局允许的行高比例。
   * @returns 候选排版的测量结果。
   */
  const measure = (
    width: number,
    budget: number,
    base: number,
    lineRatio: number,
  ) => {
    if (probe.style.width !== `${width}px`) probe.style.width = `${width}px`;
    for (const candidate of candidates) candidate.root.style.display = "none";
    const first = stageCandidate(0, base);
    if (fits(first, budget, lineRatio)) return snapshot(first, budget, false);
    const min = Math.min(base, innerWidth <= 700 ? 18 : 20);
    const coarse = Array.from({ length: 8 }, (_, index) =>
      stageCandidate(index + 1, base - ((base - min) * (index + 1)) / 8),
    );
    const fitIndex = coarse.findIndex((candidate) =>
      fits(candidate, budget, lineRatio),
    );
    if (fitIndex < 0) return snapshot(coarse.at(-1) ?? first, budget, true);
    const low = coarse[fitIndex].size;
    const high = fitIndex ? coarse[fitIndex - 1].size : base;
    const fine = Array.from({ length: 16 }, (_, index) =>
      stageCandidate(index + 1, high - ((high - low) * (index + 1)) / 16),
    );
    const selected =
      fine.find((candidate) => fits(candidate, budget, lineRatio)) ??
      fine.at(-1) ??
      first;
    return snapshot(selected, budget, false);
  };

  /**
   * 根据容器尺寸排布标题字符。
   *
   * 比较候选换行并选择稳定布局，随后更新可见字符轨道。
   */
  const layout = () => {
    scheduled = 0;
    if (destroyed) return;
    if (!text) {
      reels.render([], 0, enabled && animateNext);
      displayed = "";
      appliedKey = "";
      appliedViewport = "";
      appliedLayout = undefined;
      animateNext = false;
      return;
    }
    const width = title.getBoundingClientRect().width;
    if (!width) return;
    const nextBottomGap =
      root.getBoundingClientRect().bottom -
      navigation.getBoundingClientRect().top +
      28;
    if (bottomGap !== nextBottomGap) {
      bottomGap = nextBottomGap;
      root.style.setProperty("--callout-bottom", `${bottomGap}px`);
    }
    const calloutStyle = getComputedStyle(callout);
    const titleStyle = getComputedStyle(title);
    const outside = [...callout.children].reduce((sum, element) => {
      if (element === title || element === probe) return sum;
      const style = getComputedStyle(element);
      if (style.display === "none") return sum;
      return (
        sum +
        element.getBoundingClientRect().height +
        Number.parseFloat(style.marginTop) +
        Number.parseFloat(style.marginBottom)
      );
    }, 0);
    const budget = Math.max(
      28,
      callout.clientHeight -
        outside -
        Number.parseFloat(calloutStyle.paddingTop) -
        Number.parseFloat(calloutStyle.paddingBottom) -
        Number.parseFloat(titleStyle.marginTop) -
        Number.parseFloat(titleStyle.marginBottom),
    );
    const style = getComputedStyle(probe);
    const base = Number.parseFloat(style.fontSize);
    const lineRatio = Number.parseFloat(style.lineHeight) / base;
    const viewport = JSON.stringify([
      width,
      base,
      lineRatio,
      style.fontFamily,
      style.fontWeight,
      style.fontStyle,
      style.letterSpacing,
      innerWidth,
      innerHeight,
      root.dataset.layout,
      fontsVersion,
    ]);
    const key = JSON.stringify([text, budget, viewport]);
    if (key === appliedKey) return;
    let result = cache.get(key);
    if (!result) {
      result = measure(width, budget, base, lineRatio);
      cache.set(key, result);
      if (cache.size > 96) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
    }
    if (displayed === text && sameLayout(appliedLayout, result)) {
      appliedKey = key;
      appliedViewport = viewport;
      animateNext = false;
      return;
    }
    const animated =
      enabled &&
      ((animateNext && displayed !== text) ||
        (displayed === text && viewport === appliedViewport && reels.moving));
    title.style.setProperty("--album-title-size", `${result.size}px`);
    reels.render(result.glyphs, result.height, animated);
    displayed = text;
    animateNext = false;
    appliedKey = key;
    appliedLayout = result;
    appliedViewport = viewport;
  };
  const schedule = () => {
    if (!destroyed && !scheduled) scheduled = requestAnimationFrame(layout);
  };
  const resize = new ResizeObserver(schedule);
  resize.observe(root);
  resize.observe(navigation);
  for (const id of ["selection-artist", "selection-meta"])
    resize.observe(required(`#${id}`));
  const changes = new MutationObserver(schedule);
  changes.observe(root, { attributes: true, attributeFilter: ["data-layout"] });
  const fontsChanged = () => {
    fontsVersion++;
    cache.clear();
    schedule();
  };
  document.fonts.addEventListener("loadingdone", fontsChanged);
  void document.fonts.ready.then(fontsChanged);
  return {
    update(next: string, animated: boolean) {
      enabled = animated;
      if (next === text) {
        if (!enabled) reels.finish();
        schedule();
        return;
      }
      text = next;
      animateNext = animated && !!displayed;
      title.title = next;
      title.setAttribute("aria-label", next);
      schedule();
    },
    finish() {
      enabled = false;
      animateNext = false;
      reels.finish();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(scheduled);
      resize.disconnect();
      changes.disconnect();
      document.fonts.removeEventListener("loadingdone", fontsChanged);
      reels.destroy();
      probe.remove();
      cache.clear();
      title.innerHTML = albumTitleMarkup(text);
    },
  };
}
