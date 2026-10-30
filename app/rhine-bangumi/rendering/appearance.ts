import * as THREE from "three";
import { internalOpticsFragment } from "./internal-optics";
import type { MusicSelectionLighting } from "./music-lighting";
import { setMusicGlassClarity, shadeMusicGlass } from "./music-model";

type Surface = THREE.MeshPhysicalMaterial;
type Palette = { high: Surface; low?: Surface };

/**
 * 管理盒体材质克隆与展示状态。
 *
 * 为模型实例分配独立材质，更新清晰度和归位外观，并释放实例持有的材质。
 */
export class CardAppearance {
  musicLighting?: MusicSelectionLighting;
  private palettes = new Map<string, Palette>();

  register(name: string, high: Surface, low?: Surface) {
    this.palettes.set(name, { high, low });
  }

  /**
   * 为模型实例准备可独立更新的材质。
   *
   * 克隆注册的材质并安装 Shader 扩展，实例释放时须调用 dispose。
   *
   * @param group 需要更新或释放的 Three.js 对象组。
   */
  prepare(group: THREE.Group) {
    for (const child of group.children) {
      const mesh = child as THREE.Mesh;
      const name = mesh.userData.surface as string;
      const palette = this.palettes.get(name);
      if (!palette) continue;
      const mat = palette.high.clone();
      mesh.material = mat;
      if (mat.userData.opticalOrder)
        mesh.renderOrder = mat.userData.opticalOrder;
      mat.onBeforeCompile = (shader) => {
        if (mat.userData.opticalOrder)
          shader.fragmentShader = internalOpticsFragment(shader.fragmentShader);
        shadeMusicGlass(shader, name);
        this.musicLighting?.shade(shader, name);
      };
      mat.customProgramCacheKey = () => `music-surface-${name}`;
    }
  }

  setClarity(group: THREE.Group, value: number) {
    group.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        child.userData.surface === "Frosted_Polymer"
      )
        setMusicGlassClarity(child.material as Surface, value);
    });
  }

  /**
   * 把展示进度应用到盒体材质。
   *
   * 在高低细节材质之间同步物理参数，不改变共享材质模板。
   *
   * @param group 需要更新或释放的 Three.js 对象组。
   * @param value 当前输入或目标值。
   */
  apply(group: THREE.Group, value: number) {
    for (const child of group.children) {
      const mesh = child as THREE.Mesh;
      const palette = this.palettes.get(mesh.userData.surface);
      if (!palette) continue;
      const { high, low } = palette;
      if (!low) continue;
      const mat = mesh.material as Surface;
      mat.color.copy(low.color).lerp(high.color, value);
      if (
        mat.attenuationColor &&
        low.attenuationColor &&
        high.attenuationColor
      ) {
        mat.attenuationColor
          .copy(low.attenuationColor)
          .lerp(high.attenuationColor, value);
        mat.attenuationDistance =
          Number.isFinite(low.attenuationDistance) &&
          Number.isFinite(high.attenuationDistance)
            ? THREE.MathUtils.lerp(
                low.attenuationDistance,
                high.attenuationDistance,
                value,
              )
            : high.attenuationDistance;
      }
      for (const key of [
        "roughness",
        "metalness",
        "transmission",
        "thickness",
        "clearcoat",
        "clearcoatRoughness",
      ] as const) {
        mat[key] = THREE.MathUtils.lerp(low[key] ?? 0, high[key] ?? 0, value);
      }
      if (high.transmission > 0)
        mat.transmission = Math.max(0.000001, mat.transmission);
    }
  }

  setNight() {
    for (const [name, palette] of this.palettes) {
      for (const mat of [palette.high, palette.low]) {
        if (!mat) continue;
        if (["Frosted_Polymer", "Ivory_Edges"].includes(name)) {
          mat.color.set("#f6fbff");
          if (mat.attenuationColor) mat.attenuationColor.set("#dceafd");
        } else if (name === "Optical_Diffuser") {
          mat.color.set("#c6d6e5");
        } else if (name === "Index_Inlay") mat.color.set("#d7e9ff");
      }
    }
  }

  /**
   * 释放盒体实例克隆的材质资源。
   *
   * 不销毁注册的共享材质模板或外部持有的几何体。
   *
   * @param group 需要更新或释放的 Three.js 对象组。
   */
  dispose(group: THREE.Group) {
    for (const child of group.children) {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (mesh.userData.albumCover) mesh.userData.coverDisposed = true;
      if (!mesh.userData.surface) mat.map?.dispose();
      mat.dispose();
    }
  }
}
