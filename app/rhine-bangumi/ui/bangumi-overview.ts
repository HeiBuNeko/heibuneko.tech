import {
  type OverviewColumn,
  visibleOverviewLabels,
} from "../archive/bangumi-overview";
import { fileLocation, records } from "../data/data";
import { isPortraitViewport } from "../motion/viewport-layout";
import { createSurfaceTransition } from "./ui-transitions";

type Actions = {
  selectColumn: (lane: number) => boolean;
  selectRecord: (index: number) => void;
  enterColumn: (lane: number) => void;
  return: () => void;
  stepColumn: (direction: number) => void;
};

/**
 * 创建并管理番剧总览交互层。
 *
 * 处理投影名牌、窄屏网格、键盘焦点、进退场动画和卸载清理。
 *
 * @param surface 总览所属界面的根元素。
 * @param actions 界面事件对应的外部操作回调。
 * @returns 总览控制句柄。
 * @throws 缺少总览面板、月份容器、网格或返回按钮时抛出异常。
 */
export function setupBangumiOverview(surface: HTMLElement, actions: Actions) {
  const panel = surface.querySelector<HTMLElement>(".bangumi-overview");
  const columns = surface.querySelector<HTMLElement>(".overview-columns");
  const grid = surface.querySelector<HTMLElement>(".overview-grid");
  const returnButton =
    surface.querySelector<HTMLButtonElement>(".overview-return");
  if (!panel || !columns || !grid || !returnButton)
    throw new Error("Missing Bangumi overview element");

  const panelTransition = createSurfaceTransition(panel, undefined, 460, 240);
  const labels = new Map<
    number,
    {
      anchor: HTMLDivElement;
      label: HTMLButtonElement;
      enter: HTMLButtonElement;
      title: HTMLElement;
      count: HTMLElement;
      physicalLane?: number;
      transition: ReturnType<typeof createSurfaceTransition>;
    }
  >();
  const retiring = new Set<{
    anchor: HTMLDivElement;
    transition: ReturnType<typeof createSurfaceTransition>;
  }>();
  const gridButtons = records.map((record, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "overview-record";
    button.dataset.overviewRecord = String(index);
    const title = document.createElement("strong");
    title.textContent = record.bangumi.name;
    const meta = document.createElement("small");
    meta.textContent = `${record.category} · ${record.bangumi.platform}`;
    button.append(title, meta);
    grid.append(button);
    return button;
  });
  let active = false;
  let portrait = false;
  let expandedLane: number | null = null;
  let currentSelected = 0;
  let revision = 0;

  const syncExpansion = () => {
    for (const [lane, item] of labels) {
      const expanded = lane === expandedLane;
      item.anchor.dataset.expanded = String(expanded);
      item.label.setAttribute("aria-expanded", String(expanded));
      item.enter.disabled = !expanded;
      item.enter.tabIndex = expanded ? 0 : -1;
      item.enter.setAttribute("aria-hidden", String(!expanded));
    }
  };

  const retire = (lane: number, reduced: boolean) => {
    const item = labels.get(lane);
    if (!item) return;
    labels.delete(lane);
    retiring.add(item);
    item.anchor.inert = true;
    item.transition.hide(reduced, () => {
      retiring.delete(item);
      item.transition.dispose();
      item.anchor.remove();
    });
  };

  /**
   * 切换投影名牌和窄屏网格布局。
   *
   * 在断点变化时退场旧名牌、更新 inert 状态并恢复键盘焦点。
   *
   * @param width 视口或渲染区域的宽度。
   * @param height 视口或渲染区域的高度。
   * @param reduced 是否启用减少动态效果。
   */
  const setLayout = (width: number, height: number, reduced: boolean) => {
    const next = isPortraitViewport(width, height);
    if (next === portrait) return;
    portrait = next;
    panel.dataset.layout = portrait ? "grid" : "projected";
    expandedLane = null;
    for (const lane of labels.keys()) retire(lane, true);
    grid.inert = !active || !portrait;
    columns.inert = !active || portrait;
    if (active)
      (portrait ? gridButtons[currentSelected] : returnButton)?.focus({
        preventScroll: true,
      });
    if (reduced) panelTransition.finish();
  };

  /**
   * 分发总览中的月份、番剧和返回操作。
   *
   * 只处理当前总览层的按钮，阻止失活界面执行选择。
   *
   * @param event 当前键盘、鼠标或滚轮事件。
   */
  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("button");
    if (!button || !panel.contains(button) || !active) return;
    if (button.dataset.overviewRecord !== undefined) {
      actions.selectRecord(Number(button.dataset.overviewRecord));
    } else if (button.dataset.overviewLane !== undefined) {
      const lane = Number(button.dataset.overviewLane);
      if (actions.selectColumn(lane)) {
        expandedLane = lane;
        syncExpansion();
      }
    } else if (button.dataset.overviewEnter !== undefined) {
      const lane = Number(button.dataset.overviewEnter);
      if (lane === expandedLane) actions.enterColumn(lane);
    } else if (button.dataset.action === "overview-return") {
      actions.return();
    } else if (button.dataset.action === "overview-prev") {
      actions.stepColumn(-1);
    } else if (button.dataset.action === "overview-next") {
      actions.stepColumn(1);
    }
  };
  /**
   * 在窄屏网格中移动键盘焦点。
   *
   * 按实际网格列数计算上下左右目标，并阻止方向键触发场景导航。
   *
   * @param event 当前键盘、鼠标或滚轮事件。
   */
  const onGridKey = (event: KeyboardEvent) => {
    if (!active || !portrait || event.altKey || event.ctrlKey || event.metaKey)
      return;
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    const index = gridButtons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    if (index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const count = Math.max(
      1,
      getComputedStyle(grid).gridTemplateColumns.split(" ").length,
    );
    const step =
      event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowUp"
            ? -count
            : count;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? gridButtons.length - 1
          : Math.max(0, Math.min(gridButtons.length - 1, index + step));
    gridButtons[next]?.focus();
  };
  panel.addEventListener("click", onClick);
  grid.addEventListener("keydown", onGridKey);

  return {
    get isGrid() {
      return active && portrait;
    },
    setLayout,
    collapse() {
      expandedLane = null;
      syncExpansion();
    },
    setSelected(index: number) {
      currentSelected = index;
      for (const [number, item] of labels)
        item.anchor.setAttribute(
          "aria-current",
          String(number === fileLocation(index).lane),
        );
      gridButtons.forEach((button, number) => {
        button.setAttribute("aria-pressed", String(index === number));
      });
    },
    /**
     * 切换总览的可见与可操作状态。
     *
     * 同步 inert、焦点和过渡动画，退场完成后通知场景收回镜头。
     *
     * @param next 即将应用的目标状态。
     * @param reduced 是否启用减少动态效果。
     * @param onExit 总览退场动画完成后的回调。
     */
    setActive(next: boolean, reduced: boolean, onExit: () => void) {
      if (active === next) return;
      active = next;
      const current = ++revision;
      expandedLane = null;
      syncExpansion();
      panel.inert = !next;
      panel.setAttribute("aria-hidden", String(!next));
      grid.inert = !next || !portrait;
      columns.inert = !next || portrait;
      if (next) {
        panelTransition.show(reduced, 0, () =>
          (portrait ? gridButtons[currentSelected] : returnButton)?.focus({
            preventScroll: true,
          }),
        );
      } else {
        for (const lane of labels.keys()) retire(lane, reduced);
        panelTransition.hide(reduced, () => {
          if (revision === current) onExit();
        });
      }
    },
    /**
     * 更新投影月份名牌的位置和可见集合。
     *
     * 结合场景投影、边界与碰撞结果创建或回收名牌，避免循环副本切换时瞬移。
     *
     * @param projections 场景计算的月份投影结果。
     * @param width 视口或渲染区域的宽度。
     * @param height 视口或渲染区域的高度。
     * @param reduced 是否启用减少动态效果。
     * @param selected 当前选中的番剧索引或状态。
     */
    update(
      projections: OverviewColumn[],
      width: number,
      height: number,
      reduced: boolean,
      selected: number,
    ) {
      setLayout(width, height, reduced);
      if (!active || portrait) return;
      const heading = panel.querySelector<HTMLElement>(".overview-heading");
      const footer = panel.querySelector<HTMLElement>(".overview-navigation");
      const bounds = {
        top: Math.max(
          100,
          heading ? heading.offsetTop + heading.offsetHeight + 12 : 100,
        ),
        bottom: footer ? footer.offsetTop - 12 : height - 100,
      };
      const visible = visibleOverviewLabels(
        projections,
        width,
        height,
        new Set(labels.keys()),
        expandedLane,
        bounds,
      );
      const wanted = new Set(visible.map((column) => column.lane));
      for (const lane of labels.keys())
        if (!wanted.has(lane)) retire(lane, reduced);
      for (const column of visible) {
        let item = labels.get(column.lane);
        if (item && item.physicalLane !== column.physicalLane) {
          retire(column.lane, reduced);
          item = undefined;
        }
        if (!item) {
          const anchor = document.createElement("div");
          anchor.className = "overview-anchor";
          anchor.hidden = true;
          const label = document.createElement("button");
          label.type = "button";
          label.className = "overview-column-label";
          label.dataset.overviewLane = String(column.lane);
          const title = document.createElement("strong");
          const count = document.createElement("small");
          label.append(title, count);
          const enter = document.createElement("button");
          enter.type = "button";
          enter.className = "overview-enter";
          enter.dataset.overviewEnter = String(column.lane);
          enter.textContent = "→";
          enter.setAttribute("aria-label", `从${column.name}返回近景`);
          anchor.append(label, enter);
          columns.append(anchor);
          item = {
            anchor,
            label,
            enter,
            title,
            count,
            physicalLane: column.physicalLane,
            transition: createSurfaceTransition(anchor, undefined, 460, 240),
          };
          labels.set(column.lane, item);
          item.transition.show(reduced);
        }
        item.anchor.style.left = `${column.x}px`;
        item.anchor.style.top = `${column.y}px`;
        item.anchor.dataset.expanded = String(expandedLane === column.lane);
        item.anchor.setAttribute(
          "aria-current",
          String(column.lane === fileLocation(selected).lane),
        );
        item.title.textContent = column.name;
        item.count.textContent = `${column.count} 部番剧`;
      }
      syncExpansion();
    },
    /**
     * 销毁总览界面持有的监听和动画。
     *
     * 同时移除仍在退场的名牌节点，避免卸载后留下可聚焦元素。
     */
    dispose() {
      panel.removeEventListener("click", onClick);
      grid.removeEventListener("keydown", onGridKey);
      panelTransition.dispose();
      for (const lane of labels.keys()) {
        const item = labels.get(lane);
        item?.transition.dispose();
        item?.anchor.remove();
      }
      labels.clear();
      for (const item of retiring) {
        item.transition.dispose();
        item.anchor.remove();
      }
      retiring.clear();
    },
  };
}
