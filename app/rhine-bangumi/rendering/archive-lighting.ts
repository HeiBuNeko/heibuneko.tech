import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export type LightingLook = "baseline" | "refined";

// Each renderer needs its own PMREM render target / WebGL texture.
export function createArchiveEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  look: LightingLook = "baseline",
) {
  const refined = look === "refined";
  renderer.toneMappingExposure = refined ? 1.0 : 1.05;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environmentTarget = pmrem.fromScene(room, 0.04);
  scene.environment = environmentTarget.texture;
  room.dispose();
  pmrem.dispose();
  scene.environmentIntensity = refined ? 0.52 : 0.48;
  return environmentTarget;
}
