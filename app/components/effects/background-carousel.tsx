"use client";

import Image from "next/image";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const BACKGROUNDS = {
  dark: [
    "/img/background/dark/01.webp",
    "/img/background/dark/02.webp",
    "/img/background/dark/03.webp",
    "/img/background/dark/04.webp",
  ],
  light: [
    "/img/background/light/01.webp",
    "/img/background/light/02.webp",
    "/img/background/light/03.webp",
    "/img/background/light/04.webp",
  ],
};

export function BackgroundCarousel() {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme } = useTheme();

  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setCount((c) => c + 1);
    }, 10_000);
    return () => clearInterval(id);
  }, [resolvedTheme]);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <>
      {(["dark", "light"] as const).map((mode) =>
        BACKGROUNDS[mode].map((src, i) => (
          <Image
            key={src}
            alt=""
            fill
            src={src}
            className={`pointer-events-none object-cover transition-opacity duration-1000 ${
              resolvedTheme === mode && i === count % BACKGROUNDS[mode].length
                ? "opacity-100"
                : "opacity-0"
            }`}
          />
        )),
      )}
    </>
  );
}
