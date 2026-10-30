"use client";

import { useState } from "react";
import { BangumiCanvas } from "./rendering/scene-runtime";
import "@kitlangton/rolling-number/styles.css";
import "./styles/music-navigation-ruler.css";
import "./styles/stage.css";

type BangumiProps = { active: boolean };

export const Bangumi = ({ active }: BangumiProps) => {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [canvasHost, setCanvasHost] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState("");

  return (
    <div
      ref={setRoot}
      data-theme="night"
      aria-hidden={!active}
      inert={!active}
      className={`bangumi-stage music-app absolute inset-0 z-0${active ? "" : "pointer-events-none invisible"}`}
    >
      <div ref={setCanvasHost} className="three-scene">
        {root && canvasHost && (
          <BangumiCanvas
            root={root}
            canvasHost={canvasHost}
            active={active}
            onError={setError}
          />
        )}
      </div>
      {error && <p className="bangumi-status">三维资源未能加载。{error}</p>}
    </div>
  );
};
