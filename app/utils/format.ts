const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/**
 * 按 1024 进位，把字节数格式化成带单位的整数。
 *
 * @param bytes 字节数。非有限值按 0 处理
 * @returns 形如 `2 KB` 的字符串
 * @example formatBytes(1536) // "2 KB"
 */
export const formatBytes = (bytes: number): string => {
  let value = Number.isFinite(bytes) ? Math.abs(bytes) : 0;
  let unit = 0;

  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${Math.round(value)} ${UNITS[unit]}`;
};
