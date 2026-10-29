"use client";

import { motion } from "motion/react";

const TABS = [
  { id: "hero", label: "Hero" },
  { id: "bangumi", label: "RhineBangumi" },
] as const;

export type Tab = (typeof TABS)[number]["id"];

type NavTabsProps = {
  tab: Tab;
  onSelect: (tab: Tab) => void;
};

export const NavTabs = ({ tab, onSelect }: NavTabsProps) => {
  return (
    <nav className="fixed top-8 right-8 z-50 flex gap-6">
      {TABS.map((item) => {
        const active = tab === item.id;

        return (
          <button
            key={item.id}
            type="button"
            className="relative bg-transparent p-0 text-sm font-thin text-white"
            onClick={() => onSelect(item.id)}
          >
            <motion.span className="inline-block" whileHover={{ scale: 1.06 }}>
              {item.label}
            </motion.span>
            {active && (
              <motion.span
                layoutId="nav-underline"
                className="absolute inset-x-0 -bottom-1 h-px bg-white"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
};
