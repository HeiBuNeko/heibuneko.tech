"use client";

import Image from "next/image";
import { useTheme } from "next-themes";
import { useLayoutEffect } from "react";
import { Avatar } from "./components/avatar";

export const Gura = () => {
  const { setTheme } = useTheme();

  useLayoutEffect(() => {
    setTheme("light");
  }, []);

  return (
    <>
      <Image
        src="/img/gura/gura-live-1.png"
        alt="Gura live background"
        fill
        className="object-cover"
      />
      <Avatar />
      <footer className="text-foreground absolute inset-x-0 bottom-0 p-8 text-center text-xs font-thin">
        3D Model: Gawr Gura · © COVER Corp. / hololive production COVER
      </footer>
    </>
  );
};
