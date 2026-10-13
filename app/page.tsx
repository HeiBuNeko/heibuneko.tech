import AnimatedCursor from "react-animated-cursor";
import { BackgroundCarousel } from "./components/background-carousel";
import { HeiBuNekoProfile } from "./components/heibuneko-profile";
import { ThemeSwitcher } from "./components/theme-switcher";

export default function Home() {
  return (
    <div className="relative h-screen w-screen overflow-hidden p-8">
      <AnimatedCursor
        color="255, 255, 255"
        innerStyle={{ mixBlendMode: "difference" }}
        outerStyle={{ mixBlendMode: "difference" }}
      />
      <BackgroundCarousel />
      {/* Mask */}
      <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-white/70 via-white/25 to-transparent dark:from-black/70 dark:via-black/25 dark:to-transparent" />
      {/* Hero */}
      <div className="relative flex items-start justify-between">
        <HeiBuNekoProfile />
        <ThemeSwitcher />
      </div>
    </div>
  );
}
