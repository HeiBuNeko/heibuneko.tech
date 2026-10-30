import * as THREE from "three";
import type { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";

export const RENDER_QUALITY = {
  pixelRatio: 1.5,
  shadows: 2048,
  anisotropy: 16,
} as const;

/**
 * 计算满足设备与像素预算的渲染尺寸。
 *
 * 同时限制 DPR、最大纹理尺寸和全分辨率目标像素数。
 *
 * @param width 视口或渲染区域的宽度。
 * @param height 视口或渲染区域的高度。
 * @param stageScale 舞台在页面中的显示缩放比例。
 * @param deviceRatio 设备像素比。
 * @param maxTextureSize 设备支持的最大纹理尺寸。
 * @returns 实际像素比与宽高。
 */
export function renderDimensions(
  width: number,
  height: number,
  stageScale: number,
  deviceRatio: number,
  maxTextureSize: number,
) {
  const requested =
    Math.min(deviceRatio, RENDER_QUALITY.pixelRatio) * stageScale;
  const ratio = Math.min(
    requested,
    Math.sqrt(8_294_400 / Math.max(1, width * height)),
    maxTextureSize / Math.max(1, width, height),
  );
  return {
    ratio,
    width: Math.max(1, Math.floor(width * ratio)),
    height: Math.max(1, Math.floor(height * ratio)),
  };
}

/**
 * 设置模型纹理的各向异性过滤。
 *
 * 遍历材质引用的纹理，同时尊重封面图集自己的过滤上限。
 *
 * @param root 当前场景或界面的根 DOM 元素。
 * @param renderer 场景使用的 WebGL 渲染器。
 */
export function applyTextureQuality(
  root: THREE.Object3D,
  renderer: THREE.WebGLRenderer,
) {
  const maximum = Math.min(
    RENDER_QUALITY.anisotropy,
    renderer.capabilities.getMaxAnisotropy(),
  );
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !value.isRenderTargetTexture)
          textures.add(value);
      }
    }
  });
  for (const texture of textures) {
    const limit = texture.userData.maxAnisotropy;
    const anisotropy =
      typeof limit === "number" && Number.isFinite(limit)
        ? Math.min(maximum, Math.max(1, limit))
        : maximum;
    if (texture.anisotropy === anisotropy) continue;
    texture.anisotropy = anisotropy;
    texture.needsUpdate = true;
  }
}

/**
 * 同步渲染器和后处理目标尺寸。
 *
 * 根据容器实际显示比例更新 DPR 与 Composer，避免缩放时尺寸不一致。
 *
 * @param renderer 场景使用的 WebGL 渲染器。
 * @param composer 持有后处理通道的 Composer。
 * @param host 后处理所对应的 DOM 容器。
 * @param setDpr 更新 R3F 画布像素比的回调。
 * @returns 最终渲染尺寸。
 */
export function resizeQuality(
  renderer: THREE.WebGLRenderer,
  composer: EffectComposer,
  host: HTMLElement,
  setDpr: (ratio: number) => void,
) {
  const width = Math.max(1, host.clientWidth),
    height = Math.max(1, host.clientHeight);
  const dimensions = renderDimensions(
    width,
    height,
    host.getBoundingClientRect().width / width,
    devicePixelRatio,
    renderer.capabilities.maxTextureSize,
  );
  setDpr(dimensions.ratio);
  composer.setPixelRatio(dimensions.ratio);
  composer.setSize(width, height);
  return dimensions;
}
