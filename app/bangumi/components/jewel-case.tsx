"use client";

import {
  Bounds,
  Center,
  Environment,
  OrbitControls,
  useGLTF,
  useTexture,
} from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useMemo } from "react";
import { Mesh, type MeshStandardMaterial, SRGBColorSpace } from "three";

const MODEL_SRC = "/models/cd-jewel-case/model.gltf";

const COVERS = [
  "/img/kv/kv01-yanineko.webp",
  "/img/kv/kv02-otomekaiju.webp",
  "/img/kv/kv03-yumemita.webp",
  "/img/kv/kv04-fxkurumi.webp",
  "/img/kv/kv05-nama-anaru.webp",
];

const JewelCaseModel = () => {
  const { scene, nodes } = useGLTF(MODEL_SRC);
  const textures = useTexture(COVERS);
  nodes.Case_Front_0.rotation.set(0, 0, -1.57);
  nodes.CD_1.position.set(0, 0, -0.1);

  const cases = useMemo(() => {
    return textures.map((texture) => {
      const image = texture.image as { width: number; height: number };
      const aspect = image.width / image.height;
      texture.colorSpace = SRGBColorSpace;

      texture.repeat.set(aspect > 1 ? 1 / aspect : 1, aspect > 1 ? 1 : aspect);
      texture.offset.set(
        (1 - texture.repeat.x) / 2,
        (1 - texture.repeat.y) / 2,
      );

      const root = scene.clone(true);
      root.traverse((child) => {
        if (!(child instanceof Mesh) || Array.isArray(child.material)) return;

        if (child.material.name === "Cover") {
          const material = child.material.clone() as MeshStandardMaterial;
          material.map = texture;
          material.roughnessMap = null;
          material.metalnessMap = null;
          material.roughness = 0.25;
          material.metalness = 0;
          child.material = material;
          return;
        }
      });
      return root;
    });
  }, [scene, textures]);

  return (
    <Bounds fit>
      <Center>
        {cases.map((object, index) => (
          <primitive
            key={COVERS[index]}
            object={object}
            position={[-index * 0.5, index * 0.25, -index * 0.25]}
          />
        ))}
      </Center>
    </Bounds>
  );
};

export const JewelCase = () => {
  return (
    <Canvas orthographic camera={{ position: [4, 1, -1] }}>
      <color attach="background" args={["#000"]} />
      <JewelCaseModel />
      <Environment environmentIntensity={0.5} preset="studio" />

      <OrbitControls makeDefault />
      <EffectComposer>
        <Bloom />
      </EffectComposer>
    </Canvas>
  );
};
