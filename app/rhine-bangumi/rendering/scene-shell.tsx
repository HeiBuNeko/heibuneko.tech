import { type RefObject, useMemo } from "react";
import type * as THREE from "three";

type SceneShellProps = {
  content: THREE.Group;
  keyLight: RefObject<THREE.DirectionalLight | null>;
  floor: RefObject<THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.MeshStandardMaterial
  > | null>;
  stars: RefObject<THREE.Points<
    THREE.BufferGeometry,
    THREE.PointsMaterial
  > | null>;
};

/**
 * 生成场景背景星点的位置数组。
 *
 * 使用稳定的确定性分布，避免 React 重渲染时出现随机跳变。
 * @returns 供星点几何体使用的位置数据。
 */
function starPositions() {
  const positions = new Float32Array(140 * 3);
  let seed = 417;
  for (let i = 0; i < 140; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    positions[i * 3] = (seed / 4294967296) * 2 - 1;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    positions[i * 3 + 1] = (seed / 4294967296) * 2 - 1;
    positions[i * 3 + 2] = 0;
  }
  return positions;
}

/**
 * 声明场景基础灯光、地面和星点对象。
 *
 * 把对象引用交给命令式场景控制器，资源随 R3F 组件卸载。
 *
 * @param props 场景内容及灯光、地面、星点对象引用。
 * @returns 场景基础对象的 React 元素。
 */
export function SceneShell({
  content,
  keyLight,
  floor,
  stars,
}: SceneShellProps) {
  const positions = useMemo(starPositions, []);

  return (
    <>
      <hemisphereLight args={["#fffaf5", "#b4a18c", 0.65]} />
      <directionalLight
        ref={keyLight}
        color="#fff7ed"
        intensity={1.4}
        position={[-6, 14, -5]}
        castShadow
      />
      <directionalLight
        color="#ffffff"
        intensity={0.6}
        position={[7, 8, -10]}
      />
      <mesh
        ref={floor}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -4.63, 0]}
        receiveShadow
      >
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#d8c9b9" roughness={0.95} />
      </mesh>
      <points ref={stars} visible={false} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color="#dbeaff"
          size={1.5}
          sizeAttenuation={false}
          transparent
          opacity={0}
          depthWrite={false}
          fog={false}
        />
      </points>
      <primitive object={content} dispose={null} />
    </>
  );
}
