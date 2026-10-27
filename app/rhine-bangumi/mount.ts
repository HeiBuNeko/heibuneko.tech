import { type ArchiveNavigation, wrap } from "./archive/archive-loop";
import {
  archiveColumns,
  columnFiles,
  fileLocation,
  records,
  setMusicAlbums,
} from "./data/data";
import { demoAlbums, demoGenres } from "./data/demo-library";
import { viewportLayout } from "./motion/viewport-layout";
import { DEFAULT_LIGHTING_PRESET } from "./rendering/music-row-lighting";
import { qualityPresets } from "./rendering/render-quality";
import { ArchiveScene } from "./rendering/scene";
import { MusicBoot } from "./ui/music-boot";
import { mountMusicWheelNavigation } from "./ui/music-wheel-navigation";

export type BangumiHandle = {
  setActive: (active: boolean) => void;
  dispose: () => void;
};

export const mountBangumi = (root: HTMLElement): BangumiHandle => {
  setMusicAlbums(demoAlbums, demoGenres, "genre");

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const canvasHost = document.createElement("div");
  canvasHost.className = "three-scene";
  canvasHost.style.opacity = "0";
  const status = document.createElement("p");
  status.className = "bangumi-status";
  status.textContent = "正在载入三维专辑架";
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
  root.append(canvasHost, status, copyright);

  let scene: ArchiveScene | undefined;
  let boot: MusicBoot | undefined;
  let wheel: { dispose: () => void } | undefined;
  let frame = 0;
  let disposed = false;
  let ready = false;
  let active = false;
  let bootStarted = false;
  let mode: "archive" | "detail" = "archive";
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
  };

  const stepAlbum = (direction: number) => {
    if (!records.length || !direction) return;
    const files = columnFiles(fileLocation(selected).lane);
    if (files.length < 2) return;
    const ordinal = files.indexOf(selected);
    const target = wrap(ordinal + direction, files.length);
    go(files[target] ?? selected, { axis: "row", direction });
  };

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
  };

  const openCover = () => {
    if (
      !scene ||
      !ready ||
      boot?.active ||
      mode === "detail" ||
      !records.length
    )
      return;
    mode = "detail";
    scene.setMode("detail");
  };

  const closeCover = () => {
    if (!scene || mode !== "detail") return;
    mode = "archive";
    scene.setMode("archive");
  };

  const fit = () => {
    root.dataset.layout = viewportLayout(
      root.clientWidth,
      root.clientHeight,
      coarse,
    ).kind;
    scene?.resize();
  };

  const suspend = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };

  const loop = (now: number) => {
    frame = 0;
    if (disposed || !active || document.hidden || !scene) return;
    const opening = boot?.update(now / 1000);
    if (opening?.renderScene !== false)
      scene.update(now / 1000, opening?.cinema);
    frame = requestAnimationFrame(loop);
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
    if (!frame) frame = requestAnimationFrame(loop);
  };

  const onKey = (event: KeyboardEvent) => {
    if (!active || !ready || boot?.active) return;
    const target = event.target;
    if (target instanceof Element) {
      if (target.closest("input, textarea, select, [contenteditable=true]"))
        return;
      const outside = target.closest("button, a");
      // Enter on the site tabs should activate that tab, not open a cover.
      if (outside && !root.contains(outside) && event.key === "Enter") return;
    }
    if (event.key === "Escape") {
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
      !(target instanceof Element && target.closest("button, a"))
    ) {
      event.preventDefault();
      openCover();
    }
  };

  const onVisibility = () => {
    if (document.hidden) suspend();
    else resume();
  };

  const observer = new ResizeObserver(() => fit());
  observer.observe(root);
  window.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);
  fit();

  const fail = (error: unknown) => {
    if (disposed) return;
    canvasHost.style.opacity = "0";
    status.textContent = `三维资源未能加载。${error instanceof Error ? error.message : ""}`;
  };

  void (async () => {
    try {
      if (disposed) return;
      scene = new ArchiveScene(canvasHost);
      scene.setMusicArrayMode("filled");
      scene.enableSelectionLighting();
      scene.setLightingExperiment(DEFAULT_LIGHTING_PRESET);
      scene.setReduced(reduced);
      await scene.load(undefined, selected);
      if (disposed) return;
      scene.setTheme("night");
      scene.setQuality(qualityPresets.original);
      scene.renderer.domElement.setAttribute(
        "aria-label",
        "三维专辑阵列，左右切流派，上下切专辑",
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
        },
      });
      scene.onSelect = (index, cell) => {
        if (!ready || boot?.active) return;
        if (mode === "detail") {
          if (index !== selected) go(index, cell ? { cell } : undefined);
          return;
        }
        if (index === selected) openCover();
        else go(index, cell ? { cell } : undefined);
      };
      scene.onNavigate = (axis, direction) => {
        if (!ready || boot?.active || mode !== "archive") return;
        if (axis === "lane") stepGenre(direction);
        else stepAlbum(direction);
      };
      wheel = mountMusicWheelNavigation(root, {
        enabled: () =>
          active &&
          ready &&
          !boot?.active &&
          columnFiles(fileLocation(selected).lane).length > 1,
        navigate: stepAlbum,
        context: () => fileLocation(selected).lane,
      });
      remember(selected);
      ready = true;
      resume();
    } catch (error) {
      console.error(error);
      fail(error);
    }
  })();

  return {
    setActive(next) {
      active = next;
      if (!ready) return;
      if (next) resume();
      else suspend();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      suspend();
      observer.disconnect();
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      wheel?.dispose();
      boot?.dispose();
      scene?.dispose();
      root.replaceChildren();
    },
  };
};
