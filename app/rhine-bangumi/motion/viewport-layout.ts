export const PORTRAIT_ASPECT = 1.05;

export function isPortraitViewport(width: number, height: number) {
  return Math.max(1, width) / Math.max(1, height) < PORTRAIT_ASPECT;
}

/**
 * 根据容器尺寸和指针类型选择舞台布局。
 *
 * 同步场景与 DOM 使用的横竖屏边界。
 *
 * @param width 视口或渲染区域的宽度。
 * @param height 视口或渲染区域的高度。
 * @param coarse 输入设备是否使用粗指针。
 * @param cinematic 当前开场影片的渲染状态。
 * @returns 布局类型及对应几何参数。
 */
export function viewportLayout(
  width: number,
  height: number,
  coarse: boolean,
  cinematic = false,
) {
  width = Math.max(1, width);
  height = Math.max(1, height);
  if (cinematic)
    return {
      width: 1920,
      height: 1080,
      scale: Math.min(width / 1920, height / 1080),
      kind: "cinematic" as const,
    };
  const portrait = isPortraitViewport(width, height);
  const compact = portrait || width < 1100 || (coarse && height < 600);
  const scale = compact ? 1 : height / 1080;
  return {
    width: width / scale,
    height: height / scale,
    scale,
    kind: portrait
      ? ("portrait" as const)
      : compact
        ? ("compact" as const)
        : ("desktop" as const),
  };
}

/**
 * 计算当前视口的档案镜头构图。
 *
 * 只调整相机视野和目标位置，不改变盒体几何体。
 *
 * @param width 视口或渲染区域的宽度。
 * @param height 视口或渲染区域的高度。
 * @param span 相机需要覆盖的可见高度。
 * @param detail 详情展示的过渡进度。
 * @param compact 是否采用紧凑布局。
 * @returns 可用于镜头更新的构图参数。
 */
export function archiveFraming(
  width: number,
  height: number,
  span: number,
  detail: number,
  compact: boolean,
) {
  width = Math.max(1, width);
  height = Math.max(1, height);
  const aspect = width / height;
  const portrait = isPortraitViewport(width, height);
  const baseSpan = span + (5.9 - span) * detail;
  const portraitDetailSpan = Math.max(
    6.3 / aspect,
    (3.7 * height) / Math.max(100, 0.54 * height - 156),
  );
  const viewSpan = portrait
    ? Math.max(
        baseSpan,
        8.4 / aspect + (portraitDetailSpan - 8.4 / aspect) * detail,
      )
    : Math.max(baseSpan, (baseSpan * (16 / 9)) / aspect);
  return {
    span: viewSpan,
    portrait,
    previewY: portrait ? 0.36 : 0.5,
    detailY: portrait ? 0.27 + 34 / height : compact ? 0.49 : 560 / 1080,
  };
}

export function swipeDirection(dx: number, dy: number, elapsed: number) {
  const major = Math.max(Math.abs(dx), Math.abs(dy));
  const minor = Math.min(Math.abs(dx), Math.abs(dy));
  if (major < 36 || major < minor * 1.3 || elapsed > 1400) return null;
  return {
    axis: Math.abs(dx) > Math.abs(dy) ? ("lane" as const) : ("row" as const),
    direction: (Math.abs(dx) > Math.abs(dy) ? dx : dy) < 0 ? 1 : -1,
  };
}
