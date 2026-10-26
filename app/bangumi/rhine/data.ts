import type { MusicAlbum, MusicGenre } from "./music-types";

export type MusicSortMode = "genre" | "artist" | "album";

const collator = new Intl.Collator("zh-CN-u-co-pinyin", {
  usage: "sort",
  sensitivity: "base",
  numeric: true,
});
const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("zh-CN");
const stableCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Formatting differences share a column without rewriting artist metadata. */
const musicArtistKey = (album: MusicAlbum) => normalize(album.artist);

/** Return a new view order, retaining each album and its original metadata. */
export function orderMusicAlbums(
  albums: readonly MusicAlbum[],
  mode: MusicSortMode = "genre",
) {
  const ordered = [...albums];
  if (mode === "genre") return ordered;
  return ordered.sort((a, b) => {
    if (mode === "artist") {
      const artistA = musicArtistKey(a),
        artistB = musicArtistKey(b);
      // Keep distinct artist keys contiguous even when locale collation treats
      // their spellings as equivalent; album IDs resolve equivalent titles.
      const artist =
        collator.compare(artistA, artistB) || stableCompare(artistA, artistB);
      if (artist) return artist;
    }
    return (
      collator.compare(normalize(a.title), normalize(b.title)) ||
      stableCompare(a.id, b.id)
    );
  });
}

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
  album?: MusicAlbum;
}

export let records: ArchiveRecord[] = [];
export let categories = ["全部专辑"];
export let archiveColumns: string[] = [];
export let musicLibrary = false;
export let slotStride = 32;
let filesByColumn: number[][] = [];

/** Replace the view model atomically; audio files and their metadata stay intact. */
export function setMusicAlbums(
  albums: MusicAlbum[],
  genres: MusicGenre[] = [],
  sortMode: MusicSortMode = "genre",
) {
  musicLibrary = true;
  const ordered = orderMusicAlbums(albums, sortMode);
  const usedGenres = new Set(ordered.map((album) => album.genreId));
  const names = new Map(genres.map((genre) => [genre.id, genre.name]));
  const genreIds = [
    ...genres.map((genre) => genre.id).filter((id) => usedGenres.has(id)),
    ...usedGenres,
  ].filter((id, index, all) => all.indexOf(id) === index);
  const genreNames = genreIds.map((id) => names.get(id) ?? id ?? "未分类");
  categories = ["全部专辑", ...genreNames];
  records = ordered.map((album) => ({
    id: album.id,
    title: album.title,
    en: album.artist,
    department: album.artist,
    category: names.get(album.genreId) ?? album.genreId ?? "未分类",
    date: album.year ? String(album.year) : "年份未知",
    lead: album.artist,
    clearance: album.offline ? "音乐库离线" : `${album.tracks.length} 首歌曲`,
    abstract: album.folder,
    findings: album.rawGenres,
    source: album.online?.sourceUrl ?? "本地音乐库",
    album,
  }));
  if (sortMode === "artist") {
    const artists = new Map<string, { name: string; files: number[] }>();
    ordered.forEach((album, index) => {
      const key = musicArtistKey(album);
      let group = artists.get(key);
      if (!group) {
        group = {
          name: album.artist.trim().replace(/\s+/g, " ") || "未知歌手",
          files: [],
        };
        artists.set(key, group);
      }
      group.files.push(index);
    });
    archiveColumns = [...artists.values()].map((group) => group.name);
    filesByColumn = [...artists.values()].map((group) => group.files);
  } else if (sortMode === "album") {
    archiveColumns = [];
    filesByColumn = [];
    for (let start = 0; start < ordered.length; start += 12) {
      const end = Math.min(start + 12, ordered.length);
      archiveColumns.push(
        `${String(start + 1).padStart(2, "0")}–${String(end).padStart(2, "0")}`,
      );
      filesByColumn.push(
        Array.from({ length: end - start }, (_, offset) => start + offset),
      );
    }
  } else {
    archiveColumns = genreNames;
    // Use stable genre IDs even when custom genres share a display name.
    filesByColumn = genreIds.map((id) =>
      ordered.flatMap((album, index) => (album.genreId === id ? [index] : [])),
    );
  }
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
