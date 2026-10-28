import type { Bangumi } from "./demo-library";

export interface ArchiveRecord {
  id: string;
  title: string;
  en: string;
  department: string;
  category: string;
  date: string;
  lead: string;
  clearance: string;
  abstract: string;
  findings: string[];
  source: string;
  coverUrl: string;
  bangumi: Bangumi;
}

export let records: ArchiveRecord[] = [];
export let archiveColumns: string[] = [];
// The existing scene uses this flag to select its glass case and cover mode.
export const musicLibrary = true;
export let slotStride = 32;
let filesByColumn: number[][] = [];

export function bangumiCoverUrl(image: string) {
  const url = new URL(image);
  if (url.hostname === "lain.bgm.tv") url.hostname = "api.bgm.tv";
  return url.toString();
}

export function setBangumi(items: readonly Bangumi[]) {
  const ordered = items
    .map((item, position) => ({ item, position }))
    .sort(
      (a, b) =>
        b.item.date.localeCompare(a.item.date) || a.position - b.position,
    )
    .map(({ item }) => item);
  const months = [...new Set(ordered.map((item) => item.date.slice(0, 7)))];
  archiveColumns = months.map((month) => {
    const [year, number] = month.split("-");
    return `${year}年${Number(number)}月`;
  });
  records = ordered.map((item) => ({
    id: `${item.date}:${item.name}:${item.image}`,
    title: item.name,
    en: item.name_cn,
    department: item.platform,
    category: archiveColumns[months.indexOf(item.date.slice(0, 7))],
    date: item.date,
    lead: item.name_cn,
    clearance: item.platform,
    abstract: item.summary,
    findings: [],
    source: item.image,
    coverUrl: bangumiCoverUrl(item.image),
    bangumi: item,
  }));
  filesByColumn = months.map((month) =>
    records.flatMap((record, index) =>
      record.date.slice(0, 7) === month ? [index] : [],
    ),
  );
  slotStride = Math.max(32, ...filesByColumn.map((files) => files.length + 12));
}

export function columnFiles(lane: number) {
  return filesByColumn[lane] ?? [];
}

export function fileLocation(index: number) {
  const lane = Math.max(
    0,
    filesByColumn.findIndex((files) => files.includes(index)),
  );
  const row = 12 + Math.max(0, columnFiles(lane).indexOf(index));
  return { lane, row, slot: lane * slotStride + row };
}

export function fileAtSlot(slot: number) {
  const files = columnFiles(Math.floor(slot / slotStride));
  return (
    files[Math.max(0, Math.min(files.length - 1, (slot % slotStride) - 12))] ??
    -1
  );
}
