import * as THREE from "three";
import { damp, type Spring, smooth } from "./motion";
import { isPortraitViewport } from "./viewport-layout";

export function musicArchiveOffset(width: number, height: number) {
  if (isPortraitViewport(width, height)) return { x: 0, y: 0 };
  const aspect = Math.max(1, width) / Math.max(1, height);
  const wide = smooth((aspect - 16 / 9) / (21 / 9 - 16 / 9));
  return { x: 0.035 * wide, y: 0.08 + 0.02 * wide };
}

export function musicExtractionAnchor(shot: number) {
  const extraction = smooth((shot - 27.3) / 1.25);
  return {
    x: 518 - 98 * extraction,
    y: 288 + 42 * extraction,
  };
}

/**
 * 计算开场影片中的镜头姿态。
 *
 * 按开场时间插值镜头位置和注视点。
 *
 * @param shot 开场影片中的当前时间。
 * @param arrayYaw 阵列当前的水平旋转角。
 * @param arrayElevation 阵列当前的俯仰角。
 * @returns 当前时间的镜头目标姿态。
 */
export function musicCinematicPose(
  shot: number,
  arrayYaw = 59,
  arrayElevation = 19,
) {
  const approach = smooth((shot - 27.3) / 1.55);
  const centered = smooth((shot - 32.72) / 1.84);
  return {
    yaw: THREE.MathUtils.lerp(arrayYaw, 27, approach) * (1 - centered),
    elevation:
      THREE.MathUtils.lerp(arrayElevation, 14, approach) * (1 - centered),
    centered,
    detail: 0.55 * smooth((shot - 27.3) / 1.65) + 0.45 * centered,
  };
}

export type MusicPresentationPhase =
  | "hidden"
  | "returning-array"
  | "archive"
  | "placing"
  | "presented"
  | "returning-center";

type ArchiveTracks = "rail" | "column" | "shoulder" | "lane";
export function musicArchiveTracksSettled(
  tracks: Record<ArchiveTracks, Spring>,
  targets: Record<ArchiveTracks, number>,
) {
  return (["rail", "column", "shoulder", "lane"] as const).every(
    (key) =>
      Math.abs(tracks[key].value - targets[key]) < 0.008 &&
      Math.abs(tracks[key].velocity) < 0.025,
  );
}

/**
 * 管理盒体从阵列到详情位置的共享进度。
 *
 * 预览、详情与归位使用同一过渡状态。
 */
export class MusicPlacementMotion {
  value = 0;
  velocity = 0;
  acceleration = 0;
  private target = 0;
  private readonly duration = 1.45 / 1.05;
  private elapsed = this.duration;
  private coefficients = [0, 0, 0, 0, 0, 0];

  get settled() {
    return this.elapsed >= this.duration;
  }

  /**
   * 推进盒体展示进度。
   *
   * 根据目标状态和时间步长更新弹簧，减少动态效果时直接到达终点。
   *
   * @param target 当前动画或灯光的目标值。
   * @param dt 本次更新的时间步长，单位为秒。
   * @param reduced 是否启用减少动态效果。
   * @returns 当前展示进度。
   */
  update(target: number, dt: number, reduced: boolean) {
    if (reduced) {
      this.target = this.value = target;
      this.velocity = this.acceleration = 0;
      this.elapsed = this.duration;
      return this.value;
    }
    if (target !== this.target) {
      this.target = target;
      this.elapsed = 0;
      const t = this.duration;
      const distance =
        target -
        this.value -
        this.velocity * t -
        (this.acceleration * t * t) / 2;
      const velocity = -this.velocity - this.acceleration * t;
      const acceleration = -this.acceleration;
      this.coefficients = [
        this.value,
        this.velocity,
        this.acceleration / 2,
        (10 * distance - 4 * velocity * t + (acceleration * t * t) / 2) /
          t ** 3,
        (-15 * distance + 7 * velocity * t - acceleration * t * t) / t ** 4,
        (6 * distance - 3 * velocity * t + (acceleration * t * t) / 2) / t ** 5,
      ];
    }
    this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dt));
    if (this.settled) {
      this.value = this.target;
      this.velocity = this.acceleration = 0;
    } else {
      const [a, b, c, d, e, f] = this.coefficients;
      const t = this.elapsed;
      this.value =
        a + b * t + c * t ** 2 + d * t ** 3 + e * t ** 4 + f * t ** 5;
      this.velocity =
        b + 2 * c * t + 3 * d * t ** 2 + 4 * e * t ** 3 + 5 * f * t ** 4;
      this.acceleration = 2 * c + 6 * d * t + 12 * e * t ** 2 + 20 * f * t ** 3;
    }
    return this.value;
  }
}

/**
 * 管理档案、详情及归位之间的展示阶段。
 *
 * 记录详情是否就绪，并在手动旋转的盒体归位后放行阶段切换。
 */
export class MusicPresentation {
  phase: MusicPresentationPhase = "hidden";
  private settledFor = 0;

  /**
   * 请求切换盒体的展示阶段。
   *
   * 详情归位需要等待盒体位置和旋转完成，避免提前恢复阵列。
   *
   * @param mode 目标场景或过渡模式。
   */
  request(mode: "hidden" | "archive" | "detail") {
    const previous = this.phase;
    if (mode === "hidden") this.phase = "hidden";
    else if (mode === "detail") {
      if (this.phase !== "placing" && this.phase !== "presented")
        this.phase = "placing";
    } else if (this.phase !== "archive" && this.phase !== "returning-array") {
      this.phase =
        this.phase === "hidden" ? "returning-array" : "returning-center";
    }
    if (this.phase !== previous) this.settledFor = 0;
  }

  /**
   * 标记详情中的选片变化。
   *
   * 重置新盒体的就绪状态，保留正在进行的轨道运动。
   */
  selectionChanged() {
    if (this.phase === "placing" || this.phase === "presented") {
      this.phase = "placing";
      this.settledFor = 0;
    } else if (this.phase === "archive" || this.phase === "returning-array") {
      this.phase = "returning-array";
      this.settledFor = 0;
    }
  }

  get holdsDetail() {
    return (
      this.phase === "placing" ||
      this.phase === "presented" ||
      this.phase === "returning-center"
    );
  }
  get placed() {
    return this.phase === "placing" || this.phase === "presented";
  }

  /**
   * 在盒体转正后继续归位。
   *
   * 仅在归位阶段响应，避免旋转中的盒体与阵列相交。
   *
   * @param aligned 盒体是否已转回可进入阵列的朝向。
   */
  returnWhenAligned(aligned: boolean) {
    if (this.phase === "returning-center" && aligned) {
      this.phase = "returning-array";
      this.settledFor = 0;
    }
  }

  update(
    dt: number,
    cameraSettled: boolean,
    liftSettled: boolean,
    reduced: boolean,
  ) {
    this.settledFor =
      cameraSettled && liftSettled ? this.settledFor + Math.max(0, dt) : 0;
    if (!cameraSettled || !liftSettled || (!reduced && this.settledFor < 0.08))
      return;
    const previous = this.phase;
    if (this.phase === "placing") this.phase = "presented";
    else if (this.phase === "returning-array") this.phase = "archive";
    if (previous !== this.phase) this.settledFor = 0;
  }
}

/**
 * 保持镜头移动与视角变化连续。
 *
 * 记录相机当前位置和速度，在开场结束后衔接普通浏览。
 */
export class MusicCameraMotion {
  private positionVelocity = new THREE.Vector3();
  private aimVelocity = new THREE.Vector3();
  private lastPosition = new THREE.Vector3();
  private lastAim = new THREE.Vector3();
  private span = { value: 0, velocity: 0 };
  private elevation = { value: 0, velocity: 0 };
  private initialized = false;

  navigationElevation(
    rowSpeed: number,
    detail: number,
    dt: number,
    reduced: boolean,
  ) {
    const elevation =
      THREE.MathUtils.clamp(rowSpeed / 3, -1, 1) * 0.006 * (1 - detail);
    if (reduced) {
      this.elevation.value = this.elevation.velocity = 0;
    } else {
      damp(this.elevation, elevation, 6, dt);
    }
    return this.elevation.value;
  }

  /**
   * 从当前相机姿态同步镜头运动状态。
   *
   * 用于开场交接，避免普通浏览第一帧出现镜头跳变。
   *
   * @param camera 需要读取或更新姿态的相机。
   * @param aim 相机当前注视点。
   * @param dt 本次更新的时间步长，单位为秒。
   */
  observe(camera: THREE.PerspectiveCamera, aim: THREE.Vector3, dt: number) {
    const span =
      2 *
      camera.position.distanceTo(aim) *
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    if (this.initialized && dt > 0) {
      this.positionVelocity
        .copy(camera.position)
        .sub(this.lastPosition)
        .divideScalar(dt);
      this.aimVelocity.copy(aim).sub(this.lastAim).divideScalar(dt);
      this.span.velocity = (span - this.span.value) / dt;
    }
    this.span.value = span;
    this.remember(camera, aim);
  }

  /**
   * 更新浏览或详情的目标镜头。
   *
   * 按目标位置、注视点和可见高度推进相机，不随盒体局部抬升漂移。
   *
   * @param camera 需要读取或更新姿态的相机。
   * @param aim 相机当前注视点。
   * @param targetPosition 相机期望的位置。
   * @param targetAim 相机期望的注视点。
   * @param targetSpan 相机期望覆盖的可见高度。
   * @param dt 本次更新的时间步长，单位为秒。
   * @param reduced 是否启用减少动态效果。
   */
  update(
    camera: THREE.PerspectiveCamera,
    aim: THREE.Vector3,
    targetPosition: THREE.Vector3,
    targetAim: THREE.Vector3,
    targetSpan: number,
    dt: number,
    reduced: boolean,
  ) {
    if (!this.initialized) this.observe(camera, aim, 0);
    if (reduced) {
      camera.position.copy(targetPosition);
      aim.copy(targetAim);
      this.positionVelocity.set(0, 0, 0);
      this.aimVelocity.set(0, 0, 0);
      this.span.value = targetSpan;
      this.span.velocity = 0;
    } else {
      for (const axis of ["x", "y", "z"] as const) {
        const position = {
          value: camera.position[axis],
          velocity: this.positionVelocity[axis],
        };
        const focus = { value: aim[axis], velocity: this.aimVelocity[axis] };
        damp(position, targetPosition[axis], 9, dt);
        damp(focus, targetAim[axis], 9, dt);
        camera.position[axis] = position.value;
        this.positionVelocity[axis] = position.velocity;
        aim[axis] = focus.value;
        this.aimVelocity[axis] = focus.velocity;
      }
      damp(this.span, targetSpan, 9, dt);
    }
    const distance = Math.max(1, camera.position.distanceTo(aim));
    camera.fov = THREE.MathUtils.radToDeg(
      2 * Math.atan(Math.max(0.1, this.span.value) / (2 * distance)),
    );
    camera.lookAt(aim);
    this.remember(camera, aim);
  }

  isSettled(
    camera: THREE.PerspectiveCamera,
    aim: THREE.Vector3,
    targetPosition: THREE.Vector3,
    targetAim: THREE.Vector3,
    targetSpan: number,
  ) {
    return (
      camera.position.distanceTo(targetPosition) < 0.035 &&
      aim.distanceTo(targetAim) < 0.006 &&
      Math.abs(this.span.value - targetSpan) < 0.008 &&
      this.positionVelocity.length() < 0.09 &&
      this.aimVelocity.length() < 0.035 &&
      Math.abs(this.span.velocity) < 0.035
    );
  }

  private remember(camera: THREE.PerspectiveCamera, aim: THREE.Vector3) {
    this.lastPosition.copy(camera.position);
    this.lastAim.copy(aim);
    this.initialized = true;
  }
}
