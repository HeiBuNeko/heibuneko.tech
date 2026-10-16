import Image from "next/image";

export const Artist = () => {
  return (
    <div className="flex flex-1 flex-col gap-1">
      <div className="font-thin">Artwork by</div>
      <div className="flex flex-row gap-3 p-1">
        <Image
          width={50}
          height={50}
          alt="_LM7_"
          src="/img/lm7.webp"
          className="h-12 w-12 object-cover"
        />
        <div className="flex flex-col justify-center gap-1 font-thin">
          <div>LM7</div>
          <div className="text-sm">https://x.com/__LM7__</div>
        </div>
      </div>
    </div>
  );
};
