"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Cursor } from "./components/cursor";
import { Loading } from "./components/loading";
import { NavTabs, type Tab } from "./components/nav-tabs";
import { Splash } from "./components/splash";
import { Hero } from "./hero";

const Bangumi = dynamic(
  () => import("./rhine-bangumi").then((module) => module.Bangumi),
  { ssr: false },
);

const HomePage = () => {
  const [tab, setTab] = useState<Tab>("hero");
  const [pending, setPending] = useState<Tab | null>(null);
  const [splash, setSplash] = useState(true);
  const [entrance, setEntrance] = useState(true);
  const [bangumiMounted, setBangumiMounted] = useState(false);

  const select = (next: Tab) => {
    if (next === tab || pending) return;
    if (next === "bangumi") setBangumiMounted(true);
    setPending(next);
  };

  const covered = () => {
    if (!pending) return;
    if (pending !== "hero") setEntrance(false);
    setSplash(false);
    setTab(pending);
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <Cursor />
      {tab === "hero" && <Hero entrance={entrance} />}
      {bangumiMounted && <Bangumi active={tab === "bangumi"} />}
      <NavTabs tab={tab} onSelect={select} />
      {splash && <Splash />}
      {pending && (
        <Loading onCovered={covered} onDone={() => setPending(null)} />
      )}
    </div>
  );
};

export default HomePage;
