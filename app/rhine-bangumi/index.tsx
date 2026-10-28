"use client";

import { useEffect, useRef } from "react";
import type { BangumiHandle } from "./mount";
import "@kitlangton/rolling-number/styles.css";
import "./styles/music-navigation-ruler.css";
import "./styles/stage.css";

type BangumiProps = {
  active: boolean;
};

export const Bangumi = ({ active }: BangumiProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<BangumiHandle | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let handle: BangumiHandle | undefined;
    let cancelled = false;

    void import("./mount").then(({ mountBangumi }) => {
      if (cancelled || !rootRef.current) return;
      handle = mountBangumi(rootRef.current);
      handleRef.current = handle;
      handle.setActive(activeRef.current);
    });

    return () => {
      cancelled = true;
      handle?.dispose();
      handleRef.current = null;
    };
  }, []);

  useEffect(() => {
    handleRef.current?.setActive(active);
  }, [active]);

  return (
    <div
      ref={rootRef}
      data-theme="night"
      aria-hidden={!active}
      inert={!active}
      className={`bangumi-stage music-app absolute inset-0 z-0${active ? "" : "pointer-events-none invisible"}`}
    />
  );
};
