import * as THREE from "three";

export const BANGUMI_MODEL = {
  width: 3.996,
  height: 3.35,
  depth: 0.14,
  center: { x: 0, y: 1.85, z: 0 },
} as const;

export const BANGUMI_COLUMN_GAP = 0.75;
export const BANGUMI_COLUMN_SPACING = BANGUMI_MODEL.width + BANGUMI_COLUMN_GAP;

export const BANGUMI_COVER = {
  width: 2.98,
  height: 2.98,
  x: 0.14,
  y: BANGUMI_MODEL.center.y,
  z: 0.027,
} as const;

type GlassFinish = Pick<
  THREE.MeshPhysicalMaterial,
  "transmission" | "thickness" | "roughness" | "attenuationDistance"
>;
const BANGUMI_GLASS_FINISH: Record<string, GlassFinish> = {
  Frosted_Polymer: {
    transmission: 0.96,
    thickness: 0.018,
    roughness: 0.34,
    attenuationDistance: 5,
  },
  Ivory_Edges: {
    transmission: 0.88,
    thickness: 0.06,
    roughness: 0.25,
    attenuationDistance: 4.5,
  },
  Optical_Diffuser: {
    transmission: 0.8,
    thickness: 0.038,
    roughness: 0.38,
    attenuationDistance: 4.5,
  },
};

/**
 * 初始化盒体几何体的边界数据。
 *
 * 仅执行一次边界计算，不缩放已有模型坐标。
 *
 * @param geometry 需要计算边界的盒体几何体。
 * @returns 原几何体实例。
 */
export function normalizeBangumiGeometry(geometry: THREE.BufferGeometry) {
  if (geometry.userData.bangumiDimensions) return geometry;
  geometry.userData.bangumiDimensions = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * 配置盒体使用的玻璃与内衬材质。
 *
 * 统一透射、粗糙度和封面间隙，使阵列和详情共享同一物理尺寸。
 *
 * @param surface 当前盒体表面的材质名称。
 * @param material 需要配置的 Three.js 材质。
 */
export function configureBangumiGlass(
  surface: string,
  material: THREE.MeshPhysicalMaterial,
) {
  material.color.set("#fffdfa");
  material.metalness = 0;
  material.envMapIntensity = 0.65;
  material.ior = 1.46;
  material.attenuationColor.set("#f3e9db");
  material.attenuationDistance = 4.5;
  material.clearcoat = surface === "Ivory_Edges" ? 0.16 : 0.08;
  material.clearcoatRoughness = surface === "Ivory_Edges" ? 0.2 : 0.38;
  material.side = THREE.FrontSide;
  const finish = BANGUMI_GLASS_FINISH[surface];
  if (finish) Object.assign(material, finish);
  const compile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shadeBangumiGlass(shader, surface);
  };
  material.customProgramCacheKey = () =>
    `bangumi-case-v4-zoned-frost-${surface}`;
}

/**
 * 向盒体玻璃 Shader 注入封面邻域处理。
 *
 * 通过纸张邻近度控制透射模糊，避免玻璃覆盖区域冲淡封面。
 *
 * @param shader 待注入 uniform 或片段的 Three.js Shader。
 * @param surface 当前盒体表面的材质名称。
 */
export function shadeBangumiGlass(
  shader: THREE.WebGLProgramParametersWithUniforms,
  surface: string,
) {
  if (
    surface !== "Frosted_Polymer" ||
    shader.fragmentShader.includes("bangumiThinLid")
  )
    return;
  shader.vertexShader = `varying vec2 vBangumiLidPosition;\n${shader.vertexShader}`;
  shader.vertexShader = shader.vertexShader.replace(
    "#include <begin_vertex>",
    "#include <begin_vertex>\nvBangumiLidPosition = position.xy;",
  );
  shader.fragmentShader = `
    varying vec2 vBangumiLidPosition;
    float bangumiPaperProximity() {
      vec2 paperEdge = abs(vBangumiLidPosition - vec2(${BANGUMI_COVER.x}, ${BANGUMI_COVER.y}))
        - vec2(${BANGUMI_COVER.width / 2}, ${BANGUMI_COVER.height / 2});
      return 1.0 - smoothstep(0.015, 0.15, max(paperEdge.x, paperEdge.y));
    }
  ${shader.fragmentShader}`;
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <transmission_pars_fragment>",
    THREE.ShaderChunk.transmission_pars_fragment.replace(
      "float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );",
      `// bangumiThinLid: preserve nearby paper; diffuse the uncovered margin.
      float paperProximity = bangumiPaperProximity();
      float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior )
        * mix(1.0, 0.16, paperProximity);`,
    ),
  );
}

/**
 * 按详情进度调整盒体玻璃清晰度。
 *
 * 只改变当前材质的光学参数，不修改共享模板。
 *
 * @param material 需要配置的 Three.js 材质。
 * @param clarity 封面当前的清晰度目标。
 */
export function setBangumiGlassClarity(
  material: THREE.MeshPhysicalMaterial,
  clarity: number,
) {
  material.roughness = THREE.MathUtils.lerp(
    BANGUMI_GLASS_FINISH.Frosted_Polymer.roughness,
    0.27,
    THREE.MathUtils.clamp(clarity, 0, 1),
  );
}

/**
 * 创建与场景光照一致的封面印刷材质。
 *
 * 安装漫反射 Shader 扩展；调用方负责释放返回的材质。
 *
 * @param map 封面印刷使用的纹理。
 * @returns 新建的封面材质。
 */
export function createAlbumPrintMaterial(map: THREE.Texture) {
  const material = new THREE.MeshLambertMaterial({
    map,
    alphaTest: 0.025,
    toneMapped: false,
    fog: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      "outgoingLight = min(outgoingLight, diffuseColor.rgb);\n#include <opaque_fragment>",
    );
  };
  material.customProgramCacheKey = () => "album-diffuse-print-v4";
  return material;
}
