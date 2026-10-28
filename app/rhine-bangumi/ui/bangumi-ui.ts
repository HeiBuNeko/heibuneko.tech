import type { ArchiveNavigation } from "../archive/archive-loop";
import {
  archiveColumns,
  columnFiles,
  fileLocation,
  records,
} from "../data/data";
import { escapeHtml } from "./html";
import { setupMusicRuler } from "./music-ruler";
import { setupMusicTextMotion } from "./music-text-motion";
import { setupMusicTitleLayout } from "./music-title";
import { createSurfaceTransition } from "./ui-transitions";

type Actions = {
  select: (index: number, navigation?: ArchiveNavigation) => void;
  step: (direction: number) => void;
  month: (direction: number) => void;
  open: () => void;
  back: () => void;
};

export function setupBangumiUI(
  root: HTMLElement,
  reduced: boolean,
  actions: Actions,
) {
  const surface = document.createElement("div");
  surface.className = "bangumi-interface";
  surface.innerHTML = `
    <div class="music-vignette" aria-hidden="true"></div>
    <header class="music-header">
      <div class="music-identity"><div class="music-brand"><strong>RHINE LAB</strong><span>BANGUMI ARCHIVE <i>／</i> 番剧档案</span></div></div>
    </header>
    <section id="music-browse" class="music-browse" aria-label="番剧浏览" hidden inert>
      <div class="music-browse-veil" aria-hidden="true"></div>
      <div class="album-callout">
        <p class="music-eyebrow">BANGUMI ARCHIVE <span>／</span> <span id="selection-genre"></span></p>
        <div class="selection-rule"><span>BANGUMI <span id="selection-code-number">001</span></span><span id="selection-format"></span></div>
        <h1 id="selection-title"></h1><p id="selection-artist" class="selection-artist"></p>
        <div class="selection-meta" id="selection-meta"></div>
        <button type="button" class="open-album" data-action="open">查看番剧详情 <span>↗</span></button>
      </div>
      <div class="music-navigation">
        <div class="music-counter"><span class="music-eyebrow">BANGUMI / SELECT</span><div><b id="selection-number">01</b><span>/ <i id="selection-total">00</i></span></div></div>
        <div class="album-stepper"><button type="button" data-action="prev" aria-label="上一部番剧">↑</button><div id="album-ticks"></div><button type="button" data-action="next" aria-label="下一部番剧">↓</button></div>
        <div class="genre-stepper"><button type="button" data-action="month-prev" aria-label="上一个月份">←</button><div><small>MONTH <span id="genre-index">01</span> / <span id="genre-total">00</span></small><span id="genre-name"></span></div><button type="button" data-action="month-next" aria-label="下一个月份">→</button></div>
      </div>
      <div class="music-keyhint">← → 切月份 <span>／</span> ↑ ↓ 或滚轮切番剧 <span>／</span> ENTER 查看详情</div>
    </section>
    <section id="music-detail" class="music-detail" aria-label="番剧详情" hidden inert>
      <button type="button" class="music-back" data-action="back">← 返回番剧架 <kbd>ESC</kbd></button>
      <div class="card-caption"><span id="detail-card-id"></span><small>拖动盒子，查看完整封面</small></div>
      <article id="album-detail-content" tabindex="-1"></article>
    </section>
  `;
  root.append(surface);
  const find = <T extends HTMLElement>(selector: string) => {
    const element = surface.querySelector<T>(selector);
    if (!element) throw new Error(`Missing Bangumi UI element: ${selector}`);
    return element;
  };
  const browse = find<HTMLElement>("#music-browse");
  const detail = find<HTMLElement>("#music-detail");
  const article = find<HTMLElement>("#album-detail-content");
  const titleMotion = setupMusicTitleLayout(surface);
  const textMotion = setupMusicTextMotion(surface);
  const tickMotion = setupMusicRuler(find("#album-ticks"));
  const browseTransition = createSurfaceTransition(
    browse,
    undefined,
    720,
    140,
    "up",
    "cubic-bezier(0.45, 0, 0.25, 1)",
    [
      find(".music-browse-veil"),
      find(".album-callout"),
      find(".music-navigation"),
      find(".music-keyhint"),
    ],
  );
  const detailTransition = createSurfaceTransition(
    detail,
    article,
    360,
    240,
    "right",
  );
  let shown: "none" | "archive" | "detail" = "none";
  let current = 0;

  function renderDetail(index: number) {
    const record = records[index];
    if (!record) return;
    const item = record.bangumi;
    find("#detail-card-id").textContent =
      `BANGUMI / ${String(index + 1).padStart(3, "0")}`;
    article.innerHTML = `
      <div class="detail-overline"><span>BANGUMI ${String(index + 1).padStart(3, "0")}</span><span>RHINE ARCHIVE / ${escapeHtml(record.category)}</span></div>
      <h1>${escapeHtml(item.name)}</h1>
      <p class="detail-artist">${escapeHtml(item.name_cn)}</p>
      <div class="album-facts">
        <div><small>DATE / 首播日期</small><span>${escapeHtml(item.date)}</span></div>
        <div><small>PLATFORM / 放送平台</small><span>${escapeHtml(item.platform)}</span></div>
      </div>
      <section class="bangumi-image-field" aria-label="封面地址">
        <small>IMAGE / 封面</small>
        <div><img src="${escapeHtml(record.coverUrl)}" alt="${escapeHtml(item.name_cn || item.name)}的封面" loading="lazy"><a href="${escapeHtml(item.image)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.image)}</a></div>
      </section>
      <section class="album-about"><small>SUMMARY / 番剧简介</small><p>${escapeHtml(item.summary)}</p></section>
      <nav class="detail-album-navigation" aria-label="切换番剧"><button type="button" data-action="prev">↑ 上一部</button><button type="button" data-action="next">下一部 ↓</button></nav>
    `;
    article.scrollTop = 0;
  }

  function updateSelection(index: number, navigation?: ArchiveNavigation) {
    const record = records[index];
    if (!record) return;
    current = index;
    const location = fileLocation(index);
    const files = columnFiles(location.lane);
    const animated = shown === "archive" && !reduced;
    textMotion.update(
      {
        number: files.indexOf(index) + 1,
        total: files.length,
        code: index + 1,
        genreIndex: location.lane + 1,
        genresTotal: archiveColumns.length,
        genre: record.category,
        genreName: record.category,
        format: `PLATFORM / ${record.bangumi.platform}`,
        artist: record.bangumi.name_cn,
        meta: `DATE / ${record.bangumi.date}`,
      },
      animated,
      navigation,
    );
    titleMotion.update(record.bangumi.name, animated);
    tickMotion.update(
      files.map((file) => ({
        index: file,
        id: records[file].id,
        title: records[file].title,
      })),
      index,
      reduced,
      navigation,
      true,
    );
    renderDetail(index);
  }

  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>(
      "button[data-action], button[data-select]",
    );
    if (!button || !surface.contains(button)) return;
    if (button.dataset.select !== undefined) {
      const index = Number(button.dataset.select);
      const direction = Number(button.dataset.rulerStep || 0);
      if (index === current) actions.open();
      else
        actions.select(
          index,
          direction ? { axis: "row", direction } : undefined,
        );
      return;
    }
    switch (button.dataset.action) {
      case "open":
        actions.open();
        break;
      case "back":
        actions.back();
        break;
      case "prev":
        actions.step(-1);
        break;
      case "next":
        actions.step(1);
        break;
      case "month-prev":
        actions.month(-1);
        break;
      case "month-next":
        actions.month(1);
        break;
    }
  };
  surface.addEventListener("click", onClick);
  updateSelection(0);

  return {
    updateSelection,
    setLayout(kind: string) {
      surface.dataset.layout = kind;
    },
    showBrowse() {
      shown = "archive";
      root.dataset.mode = "archive";
      detail.inert = true;
      detailTransition.hide(reduced);
      browse.inert = false;
      browseTransition.show(reduced);
      updateSelection(current);
    },
    showDetail() {
      if (shown === "detail") return;
      shown = "detail";
      root.dataset.mode = "detail";
      browse.inert = true;
      browseTransition.hide(reduced);
      renderDetail(current);
      detail.inert = false;
      detailTransition.show(reduced, 0, () => {
        article.focus({ preventScroll: true });
      });
    },
    dispose() {
      surface.removeEventListener("click", onClick);
      titleMotion.destroy();
      textMotion.destroy();
      tickMotion.destroy();
      browseTransition.dispose();
      detailTransition.dispose();
      surface.remove();
    },
  };
}
