import * as THREE from "three";
import { bangumiIntroLightRow } from "../motion/bangumi-intro-motion";
import { BANGUMI_MODEL } from "./bangumi-model";
import type { RowLightingFrame } from "./bangumi-row-lighting";
import {
  DEFAULT_LIGHTING_PRESET,
  followRowLight,
  ROW_LIGHTING,
  ROW_LIGHTING_GLSL,
} from "./bangumi-row-lighting";

/**
 * 管理选中盒体与阵列的动态照明。
 *
 * 持有局部聚光灯和共享 Shader uniform，并在每帧同步行、列光带的位置。
 */
export class BangumiSelectionLighting {
  readonly spot = new THREE.SpotLight("#ffe3b2", 70 * 64, 0, 0.32, 0.95, 2);
  private readonly rowSettings = {
    value: new THREE.Vector3(
      DEFAULT_LIGHTING_PRESET.strength,
      DEFAULT_LIGHTING_PRESET.width,
      DEFAULT_LIGHTING_PRESET.offset,
    ),
  };
  private readonly rowDetail = { value: 0 };
  private readonly worldOrigin = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly anchorVelocity = new THREE.Vector3();
  private readonly columnVelocity = new THREE.Vector3();
  private initialized = false;
  private readonly column = { value: new THREE.Vector3() };
  private readonly rowColumn = { value: new THREE.Vector3() };
  private readonly rowMotion = { value: 0, velocity: 0 };
  private readonly laneMotion = { value: 0, velocity: 0 };
  private rowInitialized = false;
  private rowIntro = false;
  private readonly scatterColor = { value: new THREE.Color("#ffdba3") };
  private readonly scatterStrength = { value: 0.12 };
  private readonly printAmbient = { value: 0.94 };
  private readonly shellBounds = {
    value: new THREE.Vector4(
      BANGUMI_MODEL.center.x - BANGUMI_MODEL.width / 2,
      BANGUMI_MODEL.center.y - BANGUMI_MODEL.height / 2,
      BANGUMI_MODEL.center.y + BANGUMI_MODEL.height / 2,
      1 / BANGUMI_MODEL.height,
    ),
  };
  private readonly edgeFalloff = { value: new THREE.Vector2(1.7, 24) };

  constructor(
    private readonly scene: THREE.Scene,
    lightRoot: THREE.Object3D = scene,
  ) {
    this.spot.name = "Selected album soft key";
    this.spot.castShadow = false;
    this.spot.visible = false;
    lightRoot.add(this.spot, this.spot.target);
  }

  resetRowMotion() {
    this.rowInitialized = false;
    this.rowIntro = false;
    this.rowMotion.velocity = this.laneMotion.velocity = 0;
  }

  setNight(key: THREE.DirectionalLight) {
    this.scene.environmentIntensity = 0.16;
    key.intensity = 0.3;
    for (const child of this.scene.children) {
      if (child instanceof THREE.HemisphereLight) child.intensity = 0.21;
      if (child instanceof THREE.DirectionalLight && child !== key)
        child.intensity = 0.045;
    }
    this.spot.color.set("#dbe9ff");
    this.spot.intensity = 130 * 64;
    this.scatterColor.value.set("#cee5ff");
    this.scatterStrength.value = 0.72;
    this.printAmbient.value = 0.12;
  }

  /**
   * 为封面印刷材质注入漫反射光带。
   *
   * 只调制已有漫反射能量，避免印刷封面产生额外自发光。
   *
   * @param shader 待注入 uniform 或片段的 Three.js Shader。
   */
  shadePrint(shader: THREE.WebGLProgramParametersWithUniforms) {
    shader.uniforms.bangumiPrintLightColumn = this.column;
    shader.uniforms.bangumiPrintAmbient = this.printAmbient;
    shader.uniforms.bangumiRowSettings = this.rowSettings;
    shader.uniforms.bangumiRowDetail = this.rowDetail;
    shader.uniforms.bangumiRowColumn = this.rowColumn;
    shader.vertexShader = `varying vec3 vBangumiPrintOrigin;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
      #include <begin_vertex>
      vec4 bangumiPrintOrigin = vec4(0.0, 0.0, 0.0, 1.0);
      #ifdef USE_INSTANCING
        bangumiPrintOrigin = instanceMatrix * bangumiPrintOrigin;
      #endif
      vBangumiPrintOrigin = (modelMatrix * bangumiPrintOrigin).xyz;
    `,
    );
    shader.fragmentShader = `
      varying vec3 vBangumiPrintOrigin;
      uniform vec3 bangumiPrintLightColumn;
      uniform float bangumiPrintAmbient;
      ${ROW_LIGHTING_GLSL}
    ${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `
      vec3 printDistance = (vBangumiPrintOrigin - bangumiPrintLightColumn) / vec3(6.0, 3.35, 5.5);
      float printLight = exp(-dot(printDistance, printDistance));
      float rowField = bangumiRowField(vBangumiPrintOrigin, bangumiRowColumn);
      float baselineExposure = mix(bangumiPrintAmbient, 1.0, printLight);
      float guidedGain = clamp(bangumiRowSettings.x * rowField, 0.0, 1.0);
      float shelfExposure = mix(baselineExposure, 1.0, guidedGain);
      outgoingLight *= mix(shelfExposure, baselineExposure, bangumiRowDetail);
      #include <opaque_fragment>
    `,
    );
  }

  /**
   * 为盒体表面注入局部光带与散射计算。
   *
   * 按表面类型选择 Shader 分支，共享当前行列位置与详情进度。
   *
   * @param shader 待注入 uniform 或片段的 Three.js Shader。
   * @param surface 当前盒体表面的材质名称。
   */
  shade(shader: THREE.WebGLProgramParametersWithUniforms, surface: string) {
    if (surface === "Album_Print") return;
    shader.uniforms.bangumiLightColumn = this.column;
    shader.uniforms.bangumiScatterColor = this.scatterColor;
    shader.uniforms.bangumiScatterStrength = this.scatterStrength;
    shader.uniforms.bangumiShellBounds = this.shellBounds;
    shader.uniforms.bangumiEdgeFalloff = this.edgeFalloff;
    shader.uniforms.bangumiRowColumn = this.rowColumn;
    shader.uniforms.bangumiRowSettings = this.rowSettings;
    shader.uniforms.bangumiRowDetail = this.rowDetail;
    const declarations = `
      varying vec3 vBangumiLocal;
      varying vec3 vBangumiOrigin;
    `;
    shader.vertexShader = declarations + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
      #include <begin_vertex>
      vBangumiLocal = position;
      vec4 bangumiOrigin = vec4(0.0, 0.0, 0.0, 1.0);
      #ifdef USE_INSTANCING
        bangumiOrigin = instanceMatrix * bangumiOrigin;
      #endif
      vBangumiOrigin = (modelMatrix * bangumiOrigin).xyz;
    `,
    );
    shader.fragmentShader =
      declarations +
      `
      uniform vec3 bangumiLightColumn;
      uniform vec3 bangumiScatterColor;
      uniform float bangumiScatterStrength;
      uniform vec4 bangumiShellBounds;
      uniform vec2 bangumiEdgeFalloff;
      ${ROW_LIGHTING_GLSL}
    ` +
      shader.fragmentShader;
    const glass = surface === "Frosted_Polymer";
    const spine = surface === "Ivory_Edges";
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `
      vec3 bangumiOriginalOutgoing = outgoingLight;
      float laneDistance = abs(vBangumiOrigin.x - bangumiLightColumn.x);
      float laneRadius = laneDistance / 3.2;
      float coreLight = exp(-laneRadius * laneRadius * laneRadius * laneRadius);
      float spillRadius = laneDistance / 7.2;
      float spillLight = exp(-spillRadius * spillRadius * spillRadius * spillRadius);
      float laneLight = 0.58 * coreLight + 0.42 * spillLight;
      float rowDistance = (vBangumiOrigin.z - bangumiLightColumn.z) / 5.5;
      float rowLight = exp(-rowDistance * rowDistance);
      float hotDistance = (vBangumiOrigin.z - bangumiLightColumn.z) / 1.1;
      float hotLight = exp(-hotDistance * hotDistance);
      float neighborDistance = (vBangumiOrigin.z - bangumiLightColumn.z) / 2.4;
      float neighborLight = exp(-neighborDistance * neighborDistance);
      float guidedLight = 0.58 * coreLight * mix(0.12, 1.0, rowLight)
                        + 0.42 * spillLight * neighborLight;
      outgoingLight *= mix(0.96, 1.04, guidedLight);
      ${
        glass || spine
          ? `
        float fromSpine = max(0.0, vBangumiLocal.x - bangumiShellBounds.x);
        float edgeTransport = exp(-fromSpine * bangumiEdgeFalloff.x);
        float panelHeight = clamp((vBangumiLocal.y - bangumiShellBounds.y) * bangumiShellBounds.w, 0.0, 1.0);
        float lowerLight = mix(1.0, 0.62, panelHeight);
        float topRim = exp(-max(0.0, bangumiShellBounds.z - vBangumiLocal.y) * bangumiEdgeFalloff.y);
        float grazing = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
        float edgeScatter = ${spine ? "0.30" : "0.14"} * edgeTransport + ${spine ? "0.016" : "0.003"};
        outgoingLight += bangumiScatterColor * bangumiScatterStrength * guidedLight * edgeScatter * lowerLight;
        float ribbon = topRim * (0.22 + 0.78 * edgeTransport) + ${spine ? "0.18" : "0.035"} * edgeTransport * grazing;
        outgoingLight += bangumiScatterColor * bangumiScatterStrength * laneLight * hotLight * ribbon * 0.8;
      `
          : ""
      }
      {
        vec3 bangumiSelectedOutgoing = outgoingLight;
        outgoingLight = bangumiOriginalOutgoing;
        float rowField = bangumiRowField(vBangumiOrigin, bangumiRowColumn);
        float rowGain = rowField * bangumiRowSettings.x;
        float shellAmbient = mix(0.96, 1.04, guidedLight);
        float shelfExposure = mix(shellAmbient, 1.08, clamp(rowGain, 0.0, 1.0));
        outgoingLight *= shelfExposure;
        ${
          glass || spine
            ? `
          float fromSpine = max(0.0, vBangumiLocal.x - bangumiShellBounds.x);
          float edgeTransport = exp(-fromSpine * bangumiEdgeFalloff.x);
          float topRim = exp(-max(0.0, bangumiShellBounds.z - vBangumiLocal.y) * bangumiEdgeFalloff.y);
          float grazing = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
          float panelHeight = clamp((vBangumiLocal.y - bangumiShellBounds.y) * bangumiShellBounds.w, 0.0, 1.0);
          float panelScatter = ${spine ? "0.30" : "0.12"} * edgeTransport + ${spine ? "0.05" : "0.025"};
          float rimScatter = topRim * (0.55 + 0.45 * edgeTransport) +
            ${spine ? "0.24" : "0.07"} * edgeTransport * grazing;
          float scatter = panelScatter * mix(1.0, 0.78, panelHeight) + rimScatter * 1.25;
          outgoingLight += bangumiScatterColor * bangumiScatterStrength * rowGain * scatter;
        `
            : ""
        }
        outgoingLight = mix(outgoingLight, bangumiSelectedOutgoing, bangumiRowDetail);
      }
      #include <opaque_fragment>
    `,
    );
  }

  private follow(
    value: THREE.Vector3,
    velocity: THREE.Vector3,
    target: THREE.Vector3,
    dt: number,
  ) {
    const rate = 5.0;
    const decay = Math.exp(-rate * dt);
    for (const axis of ["x", "y", "z"] as const) {
      const delta = value[axis] - target[axis];
      const impulse = velocity[axis] + rate * delta;
      value[axis] = target[axis] + (delta + impulse * dt) * decay;
      velocity[axis] = (velocity[axis] - rate * impulse * dt) * decay;
    }
  }

  /**
   * 更新局部光源和 Shader uniform。
   *
   * 跟随当前模型与镜头，并用同一时间步长推进光带，避免重复滤波。
   *
   * @param model 当前选中的盒体模型。
   * @param camera 需要读取或更新姿态的相机。
   * @param dt 本次更新的时间步长，单位为秒。
   * @param visible 局部灯光是否应参与当前帧。
   * @param reduced 是否启用减少动态效果。
   * @param cinematic 当前开场影片的渲染状态。
   * @param detail 详情展示的过渡进度。
   * @param frame 当前动画或灯光帧。
   */
  update(
    model: THREE.Object3D,
    camera: THREE.Camera,
    dt: number,
    visible: boolean,
    reduced: boolean,
    cinematic = false,
    detail = 0,
    frame?: RowLightingFrame,
  ) {
    this.spot.visible = visible;
    this.rowDetail.value = THREE.MathUtils.smoothstep(detail, 0, 1);
    if (!visible) {
      this.initialized = false;
      this.resetRowMotion();
      return;
    }
    model.updateWorldMatrix(true, false);
    model.getWorldPosition(this.worldOrigin);
    const columnTarget = this.worldOrigin;
    this.aim
      .set(
        BANGUMI_MODEL.center.x - BANGUMI_MODEL.width / 2 + 0.14,
        BANGUMI_MODEL.center.y + BANGUMI_MODEL.height * 0.12,
        BANGUMI_MODEL.center.z,
      )
      .applyMatrix4(model.matrixWorld);
    if (!this.initialized || reduced || cinematic) {
      this.anchor.copy(this.aim);
      this.column.value.copy(columnTarget);
      this.anchorVelocity.set(0, 0, 0);
      this.columnVelocity.set(0, 0, 0);
    } else {
      this.follow(this.anchor, this.anchorVelocity, this.aim, dt);
      this.follow(this.column.value, this.columnVelocity, columnTarget, dt);
    }
    this.initialized = true;
    const targetRow =
      frame?.row ?? this.worldOrigin.z / ROW_LIGHTING.rowSpacing;
    const targetLane =
      frame?.lane ?? this.worldOrigin.x / ROW_LIGHTING.laneSpacing;
    const introTime = frame?.introTime;
    const opening = !reduced && introTime !== undefined;
    if (!this.rowInitialized || reduced || cinematic || this.rowIntro) {
      this.rowMotion.value = targetRow;
      this.laneMotion.value = targetLane;
      this.rowMotion.velocity = this.laneMotion.velocity = 0;
    } else {
      followRowLight(
        this.rowMotion,
        targetRow,
        dt,
        DEFAULT_LIGHTING_PRESET.transitionDuration,
      );
      followRowLight(
        this.laneMotion,
        targetLane,
        dt,
        DEFAULT_LIGHTING_PRESET.transitionDuration,
      );
    }
    if (opening)
      this.rowMotion.value = targetRow + bangumiIntroLightRow(introTime);
    this.rowIntro = opening;
    this.rowInitialized = true;
    this.rowColumn.value.copy(this.worldOrigin);
    this.rowColumn.value.z +=
      (this.rowMotion.value - targetRow) * ROW_LIGHTING.rowSpacing;
    this.rowColumn.value.x +=
      (this.laneMotion.value - targetLane) * ROW_LIGHTING.laneSpacing;
    this.spot.target.position.copy(this.anchor);
    this.offset
      .set(-6, -2.2, 4.5)
      .multiplyScalar(8)
      .applyQuaternion(camera.quaternion);
    this.spot.position.copy(this.anchor).add(this.offset);
  }
}
