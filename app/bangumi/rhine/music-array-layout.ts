export type MusicArrayMode = "filled" | "realistic";

/** A real shelf contains precisely one cell for each actual album. */
export function isRealAlbumCell(
  lane: number,
  row: number,
  counts: readonly number[],
) {
  return (
    Number.isInteger(lane) &&
    Number.isInteger(row) &&
    lane >= 0 &&
    lane < counts.length &&
    row >= 12 &&
    row < 12 + counts[lane]
  );
}
