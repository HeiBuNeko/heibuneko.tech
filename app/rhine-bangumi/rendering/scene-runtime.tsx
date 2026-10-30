import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { type BangumiHandle, mountBangumi } from "../mount";
import { ArchiveScene } from "./scene";
import { SceneShell } from "./scene-shell";

type CanvasProps = {
  root: HTMLDivElement;
  canvasHost: HTMLDivElement;
  active: boolean;
  onError: (message: string) => void;
};

/**
 * 在 R3F 画布内挂载命令式番剧场景。
 *
 * 接管场景句柄、可见性帧循环与卸载清理；Canvas 仍由 R3F 持有。
 *
 * @param props R3F 场景挂载所需的容器、激活状态和错误回调。
 * @returns 场景所需的声明式 React 元素。
 */
function SceneRuntime({ root, canvasHost, active, onError }: CanvasProps) {
  const { gl, scene, camera, setDpr, setFrameloop } = useThree();
  const content = useMemo(() => new THREE.Group(), []);
  const keyLight = useRef<THREE.DirectionalLight>(null);
  const floor =
    useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>>(null);
  const stars =
    useRef<THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>>(null);
  const handleRef = useRef<BangumiHandle | null>(null);
  const [failed, setFailed] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  /**
   * 在 R3F 对象就绪后建立命令式场景。
   *
   * 卸载时释放场景句柄持有的监听、后处理和 GPU 资源；Canvas 仍由 R3F 管理。
   */
  useEffect(() => {
    if (!keyLight.current || !floor.current || !stars.current) return;
    let archive: ArchiveScene | undefined;
    try {
      archive = new ArchiveScene(canvasHost, {
        renderer: gl,
        scene,
        camera: camera as THREE.PerspectiveCamera,
        content,
        key: keyLight.current,
        floor: floor.current,
        stars: stars.current,
        setDpr,
      });
      const handle = mountBangumi(root, canvasHost, archive, () =>
        setFailed(true),
      );
      handleRef.current = handle;
      handle.setActive(activeRef.current);
    } catch (error) {
      archive?.dispose();
      setFailed(true);
      onError(error instanceof Error ? error.message : "三维场景初始化失败");
    }
    return () => {
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [camera, canvasHost, content, gl, onError, root, scene, setDpr]);

  useEffect(() => {
    handleRef.current?.setActive(active);
  }, [active]);

  /**
   * 根据 Tab 状态和页面可见性控制 R3F 帧循环。
   *
   * 依赖变化时重设循环策略，卸载时解除页面可见性监听。
   */
  useEffect(() => {
    const sync = () =>
      setFrameloop(active && !failed && !document.hidden ? "always" : "never");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [active, failed, setFrameloop]);

  /**
   * 在每帧将时间传给命令式场景控制器。
   *
   * 场景内部直接更新 Three.js 对象，避免逐帧写入 React 状态。
   */
  useFrame(() => {
    handleRef.current?.tick(performance.now() / 1000);
  }, 1);

  return (
    <SceneShell
      content={content}
      keyLight={keyLight}
      floor={floor}
      stars={stars}
    />
  );
}

/**
 * 创建番剧场景的 R3F 画布。
 *
 * 由 R3F 持有渲染器、相机和帧循环，并将生命周期交给内部运行组件。
 *
 * @param props 画布挂载容器、激活状态与错误回调。
 * @returns 三维画布的 React 元素。
 */
export function BangumiCanvas(props: CanvasProps) {
  return (
    <Canvas
      fallback={<p className="bangumi-status">三维渲染不可用。</p>}
      camera={{ fov: 34, near: 5, far: 300 }}
      dpr={1.5}
      gl={{
        alpha: false,
      }}
      frameloop={props.active ? "always" : "never"}
    >
      <SceneRuntime {...props} />
    </Canvas>
  );
}
