import { Canvas } from "@react-three/fiber";
import { Model } from "./model";

export const Avatar = () => {
  return (
    <div className="absolute right-0 bottom-0 h-full w-[75%]">
      <Canvas
        orthographic
        camera={{ position: [0, 15, 5], rotation: [0, 0, 0], zoom: 100 }}
      >
        <Model />
      </Canvas>
    </div>
  );
};
