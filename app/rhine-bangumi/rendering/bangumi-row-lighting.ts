import { bangumiIntroLightRow } from "../motion/bangumi-intro-motion";
import { BANGUMI_COLUMN_SPACING } from "./bangumi-model";

export type RowLightingFrame = {
  row: number;
  lane: number;
  introTime?: number;
};

export type RowLightMotion = { value: number; velocity: number };

/**
 * 按临界阻尼推进选中行的灯光位置。
 *
 * 保留同向速度并限制过冲，反向导航时重新收敛。
 *
 * @param state 需要原位更新的运动状态。
 * @param target 当前动画或灯光的目标值。
 * @param dt 本次更新的时间步长，单位为秒。
 * @param duration 运动收敛所需的时间，单位为秒。
 * @returns 更新后的行坐标。
 */
export function followRowLight(
  state: RowLightMotion,
  target: number,
  dt: number,
  duration: number,
) {
  const previous = state.value;
  const distance = target - previous;
  if (!distance) {
    state.velocity = 0;
    return previous;
  }
  const rate = 4.743864518390578 / duration;
  const direction = Math.sign(distance);
  const speed = Math.min(
    Math.max(0, state.velocity * direction),
    rate * Math.abs(distance),
  );
  const velocity = speed * direction;
  const elapsed = Math.max(0, dt);
  const impulse = velocity - rate * distance;
  const decay = Math.exp(-rate * elapsed);
  const next = target + (-distance + impulse * elapsed) * decay;
  state.value = Math.min(
    Math.max(next, Math.min(previous, target)),
    Math.max(previous, target),
  );
  state.velocity =
    state.value === target || state.value !== next
      ? 0
      : (velocity - rate * impulse * elapsed) * decay;
  return state.value;
}

export const introRowOffset = bangumiIntroLightRow;

export const ROW_LIGHTING = {
  rowSpacing: 0.62,
  laneSpacing: BANGUMI_COLUMN_SPACING,
  laneRadius: 27,
  gaussianHalfMaximum: Math.LN2,
} as const;

export const DEFAULT_LIGHTING_PRESET = {
  strength: 1.3,
  width: 1.35,
  offset: 0.3,
  transitionDuration: 1.1,
} as const;

export const ROW_LIGHTING_GLSL = `
  uniform vec3 bangumiRowColumn;
  uniform vec3 bangumiRowSettings;
  uniform float bangumiRowDetail;
  float bangumiRowField(vec3 origin, vec3 column) {
    float row = (origin.z - column.z - bangumiRowSettings.z * ${ROW_LIGHTING.rowSpacing}) /
      (0.5 * bangumiRowSettings.y * ${ROW_LIGHTING.rowSpacing});
    float lane = (origin.x - column.x) / ${ROW_LIGHTING.laneRadius.toFixed(1)};
    float lane2 = lane * lane;
    return exp(-${ROW_LIGHTING.gaussianHalfMaximum} * row * row) *
      exp(-lane2 * lane2 * lane2);
  }
`;
