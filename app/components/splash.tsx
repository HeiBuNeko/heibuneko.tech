"use client";

import { motion } from "motion/react";

export const Splash = () => {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black font-thin text-6xl text-white"
      animate={{
        display: "none",
        opacity: 0,
        filter: "blur(10px)",
        scale: 1.5,
      }}
      transition={{
        delay: 1,
        duration: 1,
        ease: "easeInOut",
      }}
    >
      Atlantis National Geographic
    </motion.div>
  );
};
