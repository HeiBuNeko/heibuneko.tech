import { JewelCase } from "./components/jewel-case";

export const Bangumi = () => {
  return (
    <>
      <JewelCase />
      <p className="pointer-events-none absolute bottom-8 z-10 w-full text-center font-thin text-white text-xs">
        This work is based on “CD + Jewel Case” (
        <a
          href="https://sketchfab.com/3d-models/cd-jewel-case-f6c8386e76e54918b551ebdd276479dd"
          target="_blank"
          rel="noopener noreferrer"
          className="pointer-events-auto underline"
        >
          Sketchfab
        </a>
        ) by blue man group, licensed under CC-BY-4.0
      </p>
    </>
  );
};
