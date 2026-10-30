export function musicFogDistances(distance: number, detail: number) {
  const t = Math.min(1, Math.max(0, detail));
  return {
    near: distance + 5 - 6 * t,
    far: distance + 25 - 13 * t,
  };
}
