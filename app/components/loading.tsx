"use client";

import { motion, type Transition } from "motion/react";
import { useRef } from "react";

const FADE_S = 0.4;
const HOLD_S = 1;
const TOTAL_S = FADE_S + HOLD_S + FADE_S;

const animate = { opacity: [0, 1, 1, 0] };

const transition: Transition = {
  duration: TOTAL_S,
  times: [0, FADE_S / TOTAL_S, (FADE_S + HOLD_S) / TOTAL_S, 1],
  ease: ["easeInOut", "linear", "easeInOut"],
};

type LoadingProps = {
  onCovered: () => void;
  onDone: () => void;
};

export const Loading = ({ onCovered, onDone }: LoadingProps) => {
  const covered = useRef(false);

  return (
    <motion.div
      aria-hidden
      className="fixed inset-0 z-50 bg-black"
      initial={{ opacity: 0 }}
      animate={animate}
      transition={transition}
      onUpdate={(latest) => {
        if (covered.current || Number(latest.opacity) < 1) return;
        covered.current = true;
        onCovered();
      }}
      onAnimationComplete={onDone}
    />
  );
};
