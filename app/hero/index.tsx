"use client";

import { motion } from "motion/react";
import { Artist } from "./components/artist";
import { Carousel } from "./components/carousel";
import { Profile } from "./components/profile";

type HeroProps = {
  entrance: boolean;
};

export const Hero = ({ entrance }: HeroProps) => {
  return (
    <>
      <Carousel />
      <motion.main
        className="relative flex h-full flex-col justify-between p-8"
        initial={entrance ? { scale: 0.95 } : false}
        animate={{ scale: 1 }}
        transition={
          entrance
            ? { delay: 1, duration: 1, ease: "easeInOut" }
            : { duration: 0 }
        }
      >
        <Profile />

        <footer className="flex flex-col justify-between gap-1">
          <Artist />
          <p className="text-center font-thin text-white text-xs">
            © Atlantis National Geographic · Designed by HeiBuNeko · Built with
            Next.js
          </p>
        </footer>
      </motion.main>
    </>
  );
};
