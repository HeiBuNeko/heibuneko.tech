"use client";

import { Button } from "@heroui/react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { MdComputer, MdDarkMode, MdLightMode } from "react-icons/md";

export function ThemeSwitcher() {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme, theme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const activeTheme = theme === "system" ? resolvedTheme : theme;

  return (
    <div className="flex items-center gap-2">
      <Button
        isIconOnly
        variant={activeTheme === "light" ? "primary" : "secondary"}
        onPress={() => setTheme("light")}
      >
        <MdLightMode />
      </Button>
      <Button
        isIconOnly
        variant={activeTheme === "dark" ? "primary" : "secondary"}
        onPress={() => setTheme("dark")}
      >
        <MdDarkMode />
      </Button>
      <Button
        isIconOnly
        variant={theme === "system" ? "primary" : "secondary"}
        onPress={() => setTheme("system")}
      >
        <MdComputer />
      </Button>
    </div>
  );
}
