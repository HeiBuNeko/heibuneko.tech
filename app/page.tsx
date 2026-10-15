import { BackgroundCarousel } from "./components/effects/background-carousel";
import { CustomCursor } from "./components/effects/custom-cursor";
import { ProfileCard } from "./components/sections/profile-card";
import { ThemeSwitcher } from "./components/ui/theme-switcher";

export default function Home() {
  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <CustomCursor />
      <BackgroundCarousel />
      {/* Hero */}
      <div className="relative flex items-start justify-between p-8">
        <ProfileCard />
        <ThemeSwitcher />
      </div>
    </div>
  );
}
