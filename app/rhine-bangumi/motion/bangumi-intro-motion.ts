import { smooth } from "./motion";

export const BANGUMI_INTRO_SHOT_START = 21.92;
export const BANGUMI_INTRO_SAMPLE_RATE = 25;
export const BANGUMI_INTRO_LAST_FRAME = 120;
export const BANGUMI_INTRO_LANE_DELAY = 4;

const progress = (frame: number, start: number, end: number) =>
  smooth((frame - start) / (end - start));
const lerp = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;
const bell = (distance: number, width: number) =>
  Math.exp(-0.5 * (distance / width) ** 2);

export function bangumiIntroFrame(shot: number) {
  return 1 + (shot - BANGUMI_INTRO_SHOT_START) * BANGUMI_INTRO_SAMPLE_RATE;
}

function localFrame(relativeLane: number, shot: number) {
  return bangumiIntroFrame(shot) + relativeLane * BANGUMI_INTRO_LANE_DELAY;
}

type Key = readonly [frame: number, value: number];
function track(frame: number, keys: readonly Key[]) {
  if (frame <= keys[0][0]) return keys[0][1];
  for (let index = 1; index < keys.length; index++) {
    const [end, value] = keys[index];
    const [start, previous] = keys[index - 1];
    if (frame <= end) return lerp(previous, value, progress(frame, start, end));
  }
  return keys[keys.length - 1][1];
}

/**
 * 计算开场影片的阵列与镜头关键姿态。
 *
 * 按作者设定的采样区间连接镜头、阵列和选中盒体的运动。
 *
 * @param shot 开场影片中的当前时间。
 * @returns 指定时刻的开场姿态。
 */
export function bangumiIntroPose(shot: number) {
  const frame = bangumiIntroFrame(shot);
  return {
    yaw: track(frame, [
      [1, 89],
      [44, 85],
      [80, 59],
    ]),
    elevation: track(frame, [
      [1, 36],
      [45, 40],
      [80, 25],
    ]),
    span: track(frame, [
      [1, 10.8],
      [44, 10.3],
      [80, 7.33],
    ]),
    distance: track(frame, [
      [1, 38],
      [44, 42],
      [88, 140],
    ]),
    aimX: -1.091,
    aimY: track(frame, [
      [1, -2.55],
      [44, -1.7],
      [112, -0.045],
    ]),
    aimZ: track(frame, [
      [1, 22],
      [15, 2],
      [32, 4],
      [76, 2],
      [112, 0.481],
    ]),
    settle: progress(frame, 76, 112),
    lift: 0.9 * progress(frame, 89, BANGUMI_INTRO_LAST_FRAME),
  };
}

/**
 * 计算某列开场运动与浏览波场的交接比例。
 *
 * 列间延迟使用相同时间轴，确保接管时不出现高度跳变。
 *
 * @param relativeLane 相对选中列的横向距离。
 * @param shot 开场影片中的当前时间。
 * @returns 当前列的交接比例。
 */
export function bangumiIntroLaneSettle(relativeLane: number, shot: number) {
  return progress(localFrame(relativeLane, shot), 76, 104);
}

function packets(frame: number) {
  return {
    forwardRow: (frame - 24) * 1.2,
    forwardGain: progress(frame, 10, 19) * (1 - progress(frame, 29, 43)),
    returnRow: lerp(31, 0, progress(frame, 44, 84)),
    returnGain: 0.76 * progress(frame, 43, 53) * (1 - progress(frame, 69, 89)),
  };
}

/**
 * 计算开场期间单元的延迟波场。
 *
 * 按实体列和行的位置延迟同一条波形，并在交接时与浏览波场衔接。
 *
 * @param relativeRow 相对选中行的纵向距离。
 * @param relativeLane 相对选中列的横向距离。
 * @param shot 开场影片中的当前时间。
 * @returns 指定单元的位移值。
 */
export function bangumiIntroWave(
  relativeRow: number,
  relativeLane: number,
  shot: number,
) {
  const frame = localFrame(relativeLane, shot);
  const { forwardRow, forwardGain, returnRow, returnGain } = packets(frame);
  const forward =
    2.2 * bell(relativeRow - forwardRow, 5) -
    0.3 * bell(relativeRow - forwardRow + 7, 4.4);
  const returning =
    2.2 * bell(relativeRow - returnRow, 5) -
    0.3 * bell(relativeRow - returnRow - 7, 4.4);
  return forward * forwardGain + returning * returnGain;
}

/**
 * 计算开场光带相对选中行的偏移。
 *
 * 让光带跟随开场波峰移动，并在末段返回选择位置。
 *
 * @param shot 开场影片中的当前时间。
 * @returns 以阵列行数表示的偏移。
 */
export function bangumiIntroLightRow(shot: number) {
  const frame = bangumiIntroFrame(shot);
  const { forwardRow, returnRow } = packets(frame);
  const forward = Math.max(-26, forwardRow);
  const row = lerp(forward, returnRow, progress(frame, 35, 47));
  return row * (1 - progress(frame, 76, 104));
}
