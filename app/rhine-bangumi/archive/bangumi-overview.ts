import * as THREE from "three";
import { damp, smooth } from "../motion/motion";

/**
 * 管理总览相机与阵列共用的过渡进度。
 *
 * 使用同一进度控制镜头展开和盒体归位，避免两个动画脱节。
 */
export class BangumiOverviewMotion {
  private progress = { value: 0, velocity: 0 };
  active = false;
  get value() {
    return THREE.MathUtils.clamp(this.progress.value, 0, 1);
  }
  update(dt: number, reduced: boolean) {
    if (reduced) this.progress = { value: Number(this.active), velocity: 0 };
    else damp(this.progress, Number(this.active), 6.5, Math.max(0, dt));
    return this.value;
  }
  reset() {
    this.active = false;
    this.progress = { value: 0, velocity: 0 };
  }
}

/**
 * 计算总览镜头的目标构图。
 *
 * 按视口宽高比确定可见列数所需的跨度与镜头距离。
 *
 * @param width 视口或渲染区域的宽度。
 * @param height 视口或渲染区域的高度。
 * @returns 总览镜头的构图参数。
 */
export function overviewFraming(width: number, height: number) {
  const aspect = Math.max(1, width) / Math.max(1, height);
  return {
    span: Math.max(16.8, 18.5 / aspect),
    distance: 172,
    yaw: 28,
    elevation: 43,
    aimColumns: 1,
  };
}

export interface OverviewColumn {
  lane: number;
  physicalLane?: number;
  name: string;
  count: number;
  x: number;
  y: number;
  selected: boolean;
  extent?: number;
}

export function overviewLabelMetrics(width: number) {
  return {
    width: width < 600 ? 104 : 144,
    height: width < 600 ? 42 : 46,
    entry: 32,
    stem: 18,
  };
}

interface OverviewRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export interface OverviewBounds {
  top: number;
  bottom: number;
  obstacles?: OverviewRect[];
}

/**
 * 建立投影名牌及引线的碰撞矩形。
 *
 * 箭头预留宽度计入名牌，细引线单独占用一条窄矩形。
 *
 * @param column 待检查的月份投影列。
 * @param width 当前视口宽度，用于选择响应式名牌尺寸。
 * @returns 名牌和引线各自的碰撞矩形。
 */
function labelRects(column: OverviewColumn, width: number): OverviewRect[] {
  const size = overviewLabelMetrics(width);
  return [
    {
      left: column.x - size.width / 2,
      right: column.x + size.width / 2 + size.entry,
      top: column.y - size.height,
      bottom: column.y,
    },
    {
      left: column.x,
      right: column.x + 1,
      top: column.y,
      bottom: column.y + size.stem,
    },
  ];
}
function rectClearance(a: OverviewRect, b: OverviewRect) {
  return Math.max(
    b.left - a.right,
    a.left - b.right,
    b.top - a.bottom,
    a.top - b.bottom,
  );
}

/**
 * 计算名牌到视口安全边界的最小净空。
 *
 * 同时检查名牌、箭头预留区与引线，负值表示已越界。
 *
 * @param column 待检查的月份投影列。
 * @param width 视口或渲染区域的宽度。
 * @param height 视口或渲染区域的高度。
 * @param bounds 名牌可显示的视口边界。
 * @returns 以 CSS 像素计的最小净空。
 */
export function overviewBoundaryClearance(
  column: OverviewColumn,
  width: number,
  height: number,
  bounds: OverviewBounds = { top: 115, bottom: height - 112 },
) {
  if (!Number.isFinite(column.x) || !Number.isFinite(column.y))
    return -Infinity;
  const size = overviewLabelMetrics(width);
  let distance = Math.min(
    column.x - size.width / 2 - 12,
    width - 12 - column.x - size.width / 2 - size.entry,
    column.y - size.height - bounds.top,
    bounds.bottom - column.y - size.stem,
  );
  for (const obstacle of bounds.obstacles ?? [])
    for (const rect of labelRects(column, width))
      distance = Math.min(distance, rectClearance(rect, obstacle) - 16);
  return distance;
}

export function overviewLabelClearance(
  a: OverviewColumn,
  b: OverviewColumn,
  width: number,
) {
  return Math.min(
    ...labelRects(a, width).flatMap((first) =>
      labelRects(b, width).map((second) => rectClearance(first, second)),
    ),
  );
}

/**
 * 从投影列中筛选可显示的月份名牌。
 *
 * 优先保留展开和选中的名牌，并按边界及相互碰撞检查确定显示集合。
 *
 * @param columns 场景提供的月份投影集合。
 * @param width 视口或渲染区域的宽度。
 * @param height 视口或渲染区域的高度。
 * @param retained 上一帧仍显示的月份列集合。
 * @param expandedLane 当前已展开的月份列索引。
 * @param bounds 名牌可显示的视口边界。
 * @returns 可以同时显示的投影列。
 */
export function visibleOverviewLabels(
  columns: OverviewColumn[],
  width: number,
  height: number,
  retained: ReadonlySet<number> = new Set(),
  expandedLane: number | null = null,
  bounds: OverviewBounds = { top: 115, bottom: height - 112 },
): OverviewColumn[] {
  const accepted: OverviewColumn[] = [];
  const ordered = [...columns].sort(
    (a, b) =>
      Number(b.lane === expandedLane) - Number(a.lane === expandedLane) ||
      Number(b.selected) - Number(a.selected) ||
      Number(retained.has(b.lane)) - Number(retained.has(a.lane)) ||
      (retained.has(a.lane) && retained.has(b.lane)
        ? a.lane - b.lane
        : Number(b.selected) - Number(a.selected) ||
          Math.abs(a.x - width / 2) - Math.abs(b.x - width / 2)),
  );
  for (const column of ordered) {
    const keep = retained.has(column.lane);
    if ((column.extent ?? 1) <= (keep ? 0.98 : 0.995)) continue;
    if (
      overviewBoundaryClearance(column, width, height, bounds) <= (keep ? 4 : 8)
    )
      continue;
    if (
      accepted.some(
        (other) =>
          overviewLabelClearance(column, other, width) <= (keep ? 8 : 10),
      )
    )
      continue;
    accepted.push(column);
  }
  return accepted;
}

/**
 * 计算总览中循环池边缘列的展开比例。
 *
 * 在阵列副本回收边界前收起列高，避免突然切换可见几何体。
 *
 * @param lane 目标月份列在阵列中的索引。
 * @param centerLane 当前镜头对齐的阵列列坐标。
 * @param overview 总览镜头与阵列的过渡进度。
 * @returns 零到一之间的列高比例。
 */
export function bangumiOverviewColumnExtent(
  lane: number,
  centerLane: number,
  overview: number,
) {
  const edge = smooth(4.5 - Math.abs(lane - centerLane));
  return 1 - smooth(overview / 0.65) * (1 - edge);
}

export const BANGUMI_OVERVIEW_PICK_EXTENT = 0.12;
