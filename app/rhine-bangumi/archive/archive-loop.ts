import { archiveColumns, columnFiles, fileLocation } from "../data/data";

export type ArchiveCell = { lane: number; row: number };
export type ArchiveNavigation =
  | {
      axis: "row" | "lane";
      direction: number;
      row?: number;
    }
  | { cell: ArchiveCell; guided?: boolean };

export const LOOP_COLUMNS = 9;
export const LOOP_ROWS = 32;
export const MUSIC_LOOP_ROWS = 68;
export const COLUMN_SPACING = 5.2;
export const ROW_SPACING = 0.62;
const POOL_LANES = [0, 1, 2, 3, 4, -2, -1, 5, 6];

export function wrap(value: number, count: number) {
  if (count <= 0) return 0;
  return ((value % count) + count) % count;
}

export function nearestOccurrence(
  value: number,
  center: number,
  period: number,
) {
  if (period <= 0) return value;
  return value + Math.floor((center - value + period / 2) / period) * period;
}

export function fileAtCell({ lane, row }: ArchiveCell) {
  const files = columnFiles(wrap(lane, archiveColumns.length));
  return files[wrap(row - 12, files.length)] ?? -1;
}

/**
 * 计算导航目标在循环阵列中的实体单元。
 *
 * 根据当前单元与导航方向选择最近的循环副本，保持列和行移动连续。
 *
 * @param index 目标番剧在档案中的索引。
 * @param current 当前选中的阵列单元。
 * @param navigation 本次选片的导航上下文。
 * @returns 目标阵列单元。
 */
export function selectionCell(
  index: number,
  current: ArchiveCell,
  navigation?: ArchiveNavigation,
): ArchiveCell {
  if (navigation && "cell" in navigation) return { ...navigation.cell };
  const next = fileLocation(index);
  const row = nearestOccurrence(
    next.row,
    current.row,
    columnFiles(next.lane).length,
  );
  if (navigation?.axis === "row") {
    return { lane: current.lane, row: current.row + navigation.direction };
  }
  const laneRow = navigation?.row;
  return {
    lane:
      navigation?.axis === "lane"
        ? current.lane + navigation.direction
        : nearestOccurrence(next.lane, current.lane, archiveColumns.length),
    row:
      navigation?.axis === "lane" &&
      typeof laneRow === "number" &&
      Number.isFinite(laneRow)
        ? Math.round(laneRow)
        : row,
  };
}

export function poolCell(index: number, rows = LOOP_ROWS): ArchiveCell {
  return {
    lane: POOL_LANES[Math.floor(index / rows)],
    row: (index % rows) - (rows - LOOP_ROWS) / 2,
  };
}

export function visibleCell(
  index: number,
  center: ArchiveCell,
  rows = LOOP_ROWS,
): ArchiveCell {
  const cell = poolCell(index, rows);
  return {
    lane: nearestOccurrence(cell.lane, center.lane, LOOP_COLUMNS),
    row: nearestOccurrence(cell.row, center.row, rows),
  };
}

export function cellKey(cell: ArchiveCell) {
  return `${cell.lane}:${cell.row}`;
}

export function sameCell(a: ArchiveCell, b: ArchiveCell) {
  return a.lane === b.lane && a.row === b.row;
}
