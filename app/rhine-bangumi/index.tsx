"use client";

import { useState } from "react";
import { BangumiCanvas } from "./rendering/scene-runtime";
import "@kitlangton/rolling-number/styles.css";
import "./styles/music-navigation-ruler.css";
import "./styles/music-overview.css";
import "./styles/stage.css";

type BangumiProps = { active: boolean };

/**
 * 承载番剧舞台和按需挂载的三维画布。
 *
 * 根据首页 Tab 的激活状态控制可访问性，并显示场景初始化错误。
 *
 * @param props 组件属性，包含首页 Tab 的激活状态。
 * @returns 番剧舞台的 React 元素。
 */
export const Bangumi = ({ active }: BangumiProps) => {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [canvasHost, setCanvasHost] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState("");

  return (
    <div
      ref={setRoot}
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
