import {
  MUSIC_BOOT_SCENE_REVEAL_TIME,
  MUSIC_BOOT_SCENE_START,
} from "./music-boot-timing";

export const MUSIC_OPENING_CAPTION = "ONE BANGUMI AT A TIME";

const unit = (time: number, from: number, to: number) =>
  Math.max(0, Math.min(1, (time - from) / (to - from)));
const smooth = (t: number) => t * t * (3 - 2 * t);

/** A still, centered caption fades in and out before the live shelf takes over.
 * Both fades use the bounded film clock, including after a suspended tab. */
export function musicOpeningFrame(time: number) {
  const t = Number.isFinite(time) ? Math.max(0, time) : 0;
  const phase: "slogan" | "array" =
    t < MUSIC_BOOT_SCENE_START ? "slogan" : "array";
  return {
    phase,
    background: 1 - smooth(unit(t, MUSIC_BOOT_SCENE_REVEAL_TIME, 2.16)),
    caption:
      smooth(unit(t, 0, 0.6)) *
      (1 - smooth(unit(t, 1.1, MUSIC_BOOT_SCENE_REVEAL_TIME))),
  };
}

export class MusicOpening {
  readonly root = document.createElement("div");
  private readonly paper: HTMLElement;
  private readonly caption: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root.className = "music-opening";
    this.root.setAttribute("aria-hidden", "true");
    this.root.innerHTML = `
      <div class="music-opening-paper" data-opening="paper"></div>
      <div class="music-opening-caption" data-opening="caption">${MUSIC_OPENING_CAPTION}</div>`;
    parent.appendChild(this.root);
    const paper = this.root.querySelector<HTMLElement>(
      '[data-opening="paper"]',
    );
    const caption = this.root.querySelector<HTMLElement>(
      '[data-opening="caption"]',
    );
    if (!paper || !caption) throw new Error("Opening markup is missing.");
    this.paper = paper;
    this.caption = caption;
    this.update(0);
  }

  update(time: number) {
    const frame = musicOpeningFrame(time);
    this.root.hidden = frame.background === 0;
    this.root.dataset.phase = frame.phase;
    this.paper.style.opacity = String(frame.background);
    this.caption.style.opacity = String(frame.caption);
  }
}
