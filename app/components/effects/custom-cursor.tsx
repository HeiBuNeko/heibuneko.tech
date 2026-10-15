"use client";

import { frame, motion, useMotionValue, useSpring } from "motion/react";
import { type RefObject, useEffect, useRef, useState } from "react";

const useFollowPointer = (ref: RefObject<HTMLDivElement | null>) => {
  const dotX = useMotionValue(0);
  const dotY = useMotionValue(0);
  const circleX = useSpring(dotX);
  const circleY = useSpring(dotY);

  useEffect(() => {
    const handlePointerMove = ({ clientX, clientY }: PointerEvent) => {
      const element = ref.current;
      if (!element) return;

      frame.read(() => {
        dotX.set(clientX - element.offsetWidth / 2);
        dotY.set(clientY - element.offsetHeight / 2);
      });
    };

    window.addEventListener("pointermove", handlePointerMove);

    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [ref, dotX, dotY]);

  return { dotX, dotY, circleX, circleY };
};

export const CustomCursor = () => {
  const ref = useRef<HTMLDivElement>(null);
  const { dotX, dotY, circleX, circleY } = useFollowPointer(ref);

  // Press State
  const [pressed, setPressed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const onDown = () => setPressed(true);
    const onUp = () => setPressed(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  useEffect(() => {
    const show = () => setVisible(true);
    const hide = () => setVisible(false);
    const root = document.documentElement;

    root.addEventListener("pointerenter", show);
    root.addEventListener("pointerleave", hide);
    window.addEventListener("pointermove", show);

    return () => {
      root.removeEventListener("pointerenter", show);
      root.removeEventListener("pointerleave", hide);
      window.removeEventListener("pointermove", show);
    };
  }, []);

  useEffect(() => {
    const onOver = (event: PointerEvent) => {
      const target = event.target as Element;
      setHovered(Boolean(target.closest("a, button")));
    };
    const onLeave = () => setHovered(false);
    window.addEventListener("pointerover", onOver);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointerover", onOver);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <>
      {/* CIRCLE */}
      <motion.div
        className="pointer-events-none absolute z-45 h-2 w-2 rounded-full bg-white"
        animate={{
          scale: hovered || pressed ? 6 : 1,
          opacity: visible ? 0.5 : 0,
        }}
        style={{ x: circleX, y: circleY }}
      />
      {/* DOT */}
      <motion.div
        ref={ref}
        className="pointer-events-none absolute z-50 h-2 w-2 rounded-full bg-white"
        animate={{
          scale: hovered || pressed ? 0.6 : 1,
          opacity: visible ? 1 : 0,
        }}
        style={{ x: dotX, y: dotY }}
      />
    </>
  );
};
