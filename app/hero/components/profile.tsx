"use client";

import { Button } from "@heroui/react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { SiGithub, SiNextdotjs, SiReact, SiX } from "react-icons/si";

export const Profile = () => {
  const [now, setNow] = useState<Date>();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="flex flex-col gap-4 font-thin">
      {/* HeiBuNeko's Avatar and Name */}
      <div className="flex items-center gap-4">
        <Image
          src="/img/avatar.webp"
          alt="HeiBuNeko"
          width={48}
          height={48}
          className="size-12 rounded-full object-cover"
        />
        <h1 className="text-4xl">HeiBuNeko</h1>
      </div>
      {/* HeiBuNeko's Description */}
      <p className="text-2xl">Scientist working on creating NekoMusume</p>
      {/* HeiBuNeko's Social Media Links */}
      <nav className="flex items-center gap-4">
        <SiGithub
          size={20}
          onClick={() => window.open("https://github.com/HeiBuNeko")}
        />
        <SiX size={20} onClick={() => window.open("https://x.com/HeiBuNeko")} />
        <Button
          variant="tertiary"
          onPress={() => window.open("https://react.dev")}
        >
          <SiReact color="#61DAFB" />
          React
        </Button>
        <Button
          variant="tertiary"
          onPress={() => window.open("https://nextjs.org")}
        >
          <SiNextdotjs />
          Next.js
        </Button>
      </nav>
      {/* HeiBuNeko's Current Time */}
      <time dateTime={now?.toISOString()} suppressHydrationWarning>
        {new Intl.DateTimeFormat("en-US", {
          dateStyle: "full",
          timeStyle: "full",
        }).format(now)}
      </time>
    </header>
  );
};
