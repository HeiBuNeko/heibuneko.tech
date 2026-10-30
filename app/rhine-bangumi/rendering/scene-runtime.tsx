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

  useEffect(() => {
    const sync = () =>
      setFrameloop(active && !failed && !document.hidden ? "always" : "never");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [active, failed, setFrameloop]);

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

export function BangumiCanvas(props: CanvasProps) {
  return (
    <Canvas
      fallback={<p className="bangumi-status">三维渲染不可用。</p>}
      camera={{ fov: 34, near: 5, far: 300 }}
      dpr={1.5}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      }}
      frameloop={props.active ? "always" : "never"}
    >
      <SceneRuntime {...props} />
    </Canvas>
  );
}
