"use client";

import { useState } from "react";
import { Bangumi } from "./bangumi";
import { Cursor } from "./components/cursor";
import { Loading } from "./components/loading";
import { NavTabs, type Tab } from "./components/nav-tabs";
import { Splash } from "./components/splash";
import { Hero } from "./hero";

const HomePage = () => {
  const [tab, setTab] = useState<Tab>("hero");
  const [pending, setPending] = useState<Tab | null>(null);
  const [splash, setSplash] = useState(true);
  const [entrance, setEntrance] = useState(true);

  const select = (next: Tab) => {
    if (next === tab || pending) return;
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
      {tab === "hero" ? <Hero entrance={entrance} /> : <Bangumi />}
      <NavTabs tab={tab} onSelect={select} />
      {splash && <Splash />}
      {pending && (
        <Loading onCovered={covered} onDone={() => setPending(null)} />
      )}
    </div>
  );
};

export default HomePage;
