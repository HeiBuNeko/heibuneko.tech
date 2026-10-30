import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/**
 * 创建档案场景使用的环境光照贴图。
 *
 * 通过 PMREM 生成 GPU 环境目标，临时环境场景和生成器在函数内释放；返回目标由调用方释放。
 *
 * @param renderer 场景使用的 WebGL 渲染器。
 * @param scene 需要绘制或配置的 Three.js 场景。
 * @returns 需要由场景持有并释放的环境渲染目标。
 */
export function createArchiveEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
) {
  renderer.toneMappingExposure = 1.05;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environmentTarget = pmrem.fromScene(room, 0.04);
  scene.environment = environmentTarget.texture;
  room.dispose();
  pmrem.dispose();
  scene.environmentIntensity = 0.48;
  return environmentTarget;
}
