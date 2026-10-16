"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const BACKGROUNDS = [
  "/img/background/01.webp",
  "/img/background/02.webp",
  "/img/background/03.webp",
  "/img/background/04.webp",
];

export const Carousel = () => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setCount((c) => c + 1);
    }, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      {BACKGROUNDS.map((src, i) => (
        <Image
          key={src}
          alt=""
          fill
          src={src}
          className={`pointer-events-none object-cover transition-opacity duration-1000 ${
            i === count % BACKGROUNDS.length ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}
    </>
  );
};
