"use client";

import { motion } from "motion/react";
import { Carousel } from "./components/effects/carousel";
import { Cursor } from "./components/effects/cursor";
import { Splash } from "./components/effects/splash";
import { Artist } from "./components/sections/artist";
import { Profile } from "./components/sections/profile";

const HomePage = () => {
  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <Cursor />

      <Carousel />
      <motion.div
        className="relative flex h-full flex-col justify-between p-8"
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        transition={{
          delay: 1,
          duration: 1,
          ease: "easeInOut",
        }}
      >
        <Profile />

        <div className="relative flex flex-col justify-between gap-1">
          <Artist />
          <footer className="text-center font-thin text-white text-xs">
            © Atlantis National Geographic · Designed by HeiBuNeko · Built with
            Next.js
          </footer>
        </div>
      </motion.div>

      <Splash />
    </div>
  );
};

export default HomePage;
