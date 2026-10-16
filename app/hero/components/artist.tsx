import Image from "next/image";

export const Artist = () => {
  return (
    <figure className="flex flex-1 flex-col gap-1">
      <figcaption className="font-thin">Artwork by</figcaption>
      <div className="flex flex-row gap-3 p-1">
        <Image
          width={50}
          height={50}
          alt="LM7"
          src="/img/lm7.webp"
          className="h-12 w-12 object-cover"
        />
        <div className="flex flex-col justify-center gap-1 font-thin">
          <p>LM7</p>
          <a
            href="https://x.com/__LM7__"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm"
          >
            https://x.com/__LM7__
          </a>
        </div>
      </div>
    </figure>
  );
};
