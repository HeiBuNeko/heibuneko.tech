import { type ArchiveNavigation, wrap } from "./archive/archive-loop";
import {
  archiveColumns,
  columnFiles,
  fileLocation,
  records,
} from "./data/data";
import { viewportLayout } from "./motion/viewport-layout";
import type { ArchiveScene } from "./rendering/scene";
import { setupBangumiUI } from "./ui/bangumi-ui";
import { MusicBoot } from "./ui/music-boot";
import { mountMusicWheelNavigation } from "./ui/music-wheel-navigation";

export type BangumiHandle = {
  setActive: (active: boolean) => void;
  tick: (now: number) => void;
  dispose: () => void;
};

/**
 * 挂载番剧场景与界面交互。
 *
 * 创建加载状态、键盘与尺寸监听、开场控制和总览状态，并在卸载时释放对应资源。
 *
 * @param root 当前场景或界面的根 DOM 元素。
 * @param canvasHost 三维画布的 DOM 容器。
 * @param scene 需要绘制或配置的 Three.js 场景。
 * @param onFailure 资源加载失败时的回调。
 * @returns 用于激活、逐帧更新和卸载的场景句柄。
 */
export const mountBangumi = (
  root: HTMLElement,
  canvasHost: HTMLElement,
  scene: ArchiveScene,
  onFailure: () => void,
): BangumiHandle => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  canvasHost.style.opacity = "0";
  const status = document.createElement("p");
  status.className = "bangumi-status";
  status.textContent = "正在载入三维番剧架";
  const copyright = document.createElement("p");
  copyright.className = "bangumi-copyright music-bottomline";
  const credit = (name: string, href: string) => {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = name;
    return link;
  };
  copyright.append(
    "Copyright (c) 2026 ",
    credit("LBEILC", "https://github.com/LBEILC/RhineLabUI"),
    " · Copyright (c) 2026 ",
    credit("RonaldDeng", "https://github.com/RonaldDeng/Rhine-Music-Demo"),
    " (music adaptation and subsequent modifications)",
  );
  root.append(status, copyright);

  let interfaceUI: ReturnType<typeof setupBangumiUI> | undefined;
  let boot: MusicBoot | undefined;
  let wheel: { dispose: () => void } | undefined;
  let disposed = false;
  let ready = false;
  let active = false;
  let bootStarted = false;
  let mode: "archive" | "detail" = "archive";
  let overview = false;
  let overviewRevealPending = false;
  let selected = 0;
  const columnMemory = new Map<string, string>();

  const placed = () => {
    const phase = scene?.musicPresentationPhase;
    return phase === "placing" || phase === "presented";
  };

  const remember = (index: number) => {
    const id = records[index]?.id;
    const lane = fileLocation(index).lane;
    if (id) columnMemory.set(archiveColumns[lane] ?? "", id);
  };

  const go = (index: number, navigation?: ArchiveNavigation) => {
    if (!scene || !records[index]) return;
    const next = wrap(index, records.length);
    if (mode === "detail") {
      if (!placed()) return;
      scene.switchMusicAlbum(next, navigation);
    } else {
      scene.select(next, navigation);
    }
    selected = next;
    remember(next);
    interfaceUI?.updateSelection(next, navigation);
  };

  const stepAlbum = (direction: number) => {
    if (!records.length || !direction) return;
    const files = columnFiles(fileLocation(selected).lane);
    if (files.length < 2) return;
    const ordinal = files.indexOf(selected);
    const target = wrap(ordinal + direction, files.length);
    go(files[target] ?? selected, { axis: "row", direction });
  };

  /**
   * 按方向切换月份列。
   *
   * 恢复目标列上次浏览的番剧，再把方向交给场景导航。
   *
   * @param direction 导航方向或过渡方向。
   */
  const stepGenre = (direction: number) => {
    if (!records.length || archiveColumns.length < 2 || !direction) return;
    const lane = wrap(
      fileLocation(selected).lane + direction,
      archiveColumns.length,
    );
    const files = columnFiles(lane);
    if (!files.length) return;
    const remembered = columnMemory.get(archiveColumns[lane] ?? "");
    const index =
      files.find((item) => records[item]?.id === remembered) ?? files[0];
    if (index === undefined) return;
    go(index, { axis: "lane", direction });
    interfaceUI?.collapseOverview();
  };

  /**
   * 在总览中切换目标月份列。
   *
   * 优先恢复该列记住的番剧，随后复用普通列导航轨迹。
   *
   * @param lane 目标月份列在阵列中的索引。
   * @returns 月份列有效且可选择时返回真。
   */
  const selectOverviewColumn = (lane: number) => {
    if (
      !overview ||
      !Number.isInteger(lane) ||
      lane < 0 ||
      lane >= archiveColumns.length
    )
      return false;
    if (fileLocation(selected).lane === lane) return true;
    const files = columnFiles(lane);
    const remembered = columnMemory.get(archiveColumns[lane]);
    const index =
      files.find((item) => records[item]?.id === remembered) ?? files[0];
    if (index === undefined) return false;
    go(index, {
      axis: "lane",
      direction: Math.sign(lane - fileLocation(selected).lane),
    });
    return true;
  };

  const setOverview = (next: boolean) => {
    if (
      overview === next ||
      (next &&
        (!ready || boot?.active || mode !== "archive" || !records.length))
    )
      return;
    overview = next;
    overviewRevealPending = !next;
    interfaceUI?.setOverview(next, () => {
      if (!overview && !disposed) scene.setMusicOverview(false);
    });
    if (next) scene.setMusicOverview(true);
  };

  const openCover = () => {
    if (
      !scene ||
      !ready ||
      boot?.active ||
      overview ||
      mode === "detail" ||
      !records.length
    )
      return;
    mode = "detail";
    scene.setMode("detail");
    if (placed()) interfaceUI?.showDetail();
  };

  const closeCover = () => {
    if (!scene || mode !== "detail") return;
    mode = "archive";
    scene.setMode("archive");
    interfaceUI?.showBrowse();
  };

  const fit = () => {
    const kind = viewportLayout(
      root.clientWidth,
      root.clientHeight,
      coarse,
    ).kind;
    root.dataset.layout = kind;
    interfaceUI?.setLayout(kind);
    scene?.resize();
  };

  /**
   * 更新当前激活的番剧舞台。
   *
   * 推进开场、场景动画和总览投影，并在退场完成后恢复浏览界面。
   *
   * @param now 当前时间，单位为秒。
   */
  const tick = (now: number) => {
    if (disposed || !ready || !active || document.hidden) return;
    const opening = boot?.update(now);
    if (opening?.renderScene !== false) scene.update(now, opening?.cinema);
    if (overview)
      interfaceUI?.updateOverview(scene.getOverviewColumns(), selected);
    if (
      overviewRevealPending &&
      scene.musicOverviewProgress < 0.02 &&
      scene.musicArchiveReady
    ) {
      overviewRevealPending = false;
      interfaceUI?.showBrowseAfterOverview();
    }
    if (mode === "detail" && placed()) interfaceUI?.showDetail();
  };

  const resume = () => {
    if (disposed || !ready || !active || document.hidden || !scene || !boot)
      return;
    fit();
    if (!bootStarted) {
      bootStarted = true;
      status.remove();
      canvasHost.style.opacity = "1";
      boot.start(performance.now() / 1000);
    }
  };

  /**
   * 处理番剧舞台的键盘导航。
   *
   * 在非输入控件中分发方向键、详情和总览快捷键，并避免拦截站点页签的回车。
   *
   * @param event 当前键盘、鼠标或滚轮事件。
   */
  const onKey = (event: KeyboardEvent) => {
    if (!active || !ready || boot?.active) return;
    const target = event.target;
    if (target instanceof Element) {
      if (target.closest("input, textarea, select, [contenteditable=true]"))
        return;
      const outside = target.closest("button, a");
      if (outside && !root.contains(outside) && event.key === "Enter") return;
    }
    if (
      event.key.toLowerCase() === "v" &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      setOverview(!overview);
      return;
    }
    if (event.key === "Escape") {
      if (overview) {
        event.preventDefault();
        setOverview(false);
        return;
      }
      if (mode !== "detail") return;
      event.preventDefault();
      closeCover();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      stepAlbum(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      stepAlbum(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      stepGenre(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      stepGenre(1);
    } else if (
      event.key === "Enter" &&
      !overview &&
      !(target instanceof Element && target.closest("button, a"))
    ) {
      event.preventDefault();
      openCover();
    }
  };

  const onVisibility = () => {
    if (!document.hidden) resume();
  };

  interfaceUI = setupBangumiUI(root, reduced, {
    select: go,
    step: stepAlbum,
    month: stepGenre,
    open: openCover,
    back: closeCover,
    overview: () => setOverview(!overview),
    overviewReturn: () => setOverview(false),
    overviewColumn: selectOverviewColumn,
    overviewEnter: (lane) => {
      if (selectOverviewColumn(lane)) setOverview(false);
    },
    overviewRecord: (index) => {
      if (!overview || !records[index]) return;
      go(index);
      setOverview(false);
    },
  });

  const observer = new ResizeObserver(() => fit());
  observer.observe(root);
  window.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);
  fit();

  const fail = (error: unknown) => {
    if (disposed) return;
    canvasHost.style.opacity = "0";
    status.textContent = `三维资源未能加载。${error instanceof Error ? error.message : ""}`;
    onFailure();
  };

  void (async () => {
    try {
      if (disposed) return;
      scene.enableSelectionLighting();
      scene.setReduced(reduced);
      await scene.load(undefined, selected);
      if (disposed) return;
      scene.prepareRenderQuality();
      scene.renderer.domElement.setAttribute(
        "aria-label",
        "三维番剧阵列，左右切月份，上下切番剧",
      );
      await scene.prepareMusicRenderer();
      if (disposed) return;
      boot = new MusicBoot(root, {
        reduced,
        onStart: () => {
          scene?.setMode("hidden");
        },
        onComplete: (reason) => {
          const now = performance.now() / 1000;
          if (reason === "skip") scene?.showMusicArchiveImmediately(now);
          else scene?.finishMusicIntro(now);
          mode = "archive";
          interfaceUI?.showBrowse();
          interfaceUI?.setOverviewReady(true);
        },
      });
      scene.onSelect = (index, cell) => {
        if (!ready || boot?.active) return;
        if (mode === "detail") {
          if (index !== selected) go(index, cell ? { cell } : undefined);
          return;
        }
        if (overview) {
          if (index !== selected) go(index, cell ? { cell } : undefined);
          setOverview(false);
          return;
        }
        if (index === selected) openCover();
        else go(index, cell ? { cell } : undefined);
      };
      scene.onNavigate = (axis, direction) => {
        if (!ready || boot?.active || mode !== "archive") return;
        if (overview && interfaceUI?.overviewIsGrid) return;
        if (axis === "lane") stepGenre(direction);
        else stepAlbum(direction);
      };
      wheel = mountMusicWheelNavigation(root, {
        enabled: () =>
          active &&
          ready &&
          !boot?.active &&
          !interfaceUI?.overviewIsGrid &&
          columnFiles(fileLocation(selected).lane).length > 1,
        navigate: stepAlbum,
        context: () => fileLocation(selected).lane,
      });
      remember(selected);
      ready = true;
      resume();
    } catch (error) {
      console.error(error);
      scene.dispose();
      fail(error);
    }
  })();

  return {
    tick,
    setActive(next) {
      active = next;
      if (!ready) return;
      if (next) resume();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      wheel?.dispose();
      boot?.dispose();
      interfaceUI?.dispose();
      scene.dispose();
      status.remove();
      copyright.remove();
      canvasHost.style.opacity = "0";
    },
  };
};
