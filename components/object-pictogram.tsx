import Image from "next/image";

import { cn } from "@/lib/cn";
import {
  getObjectPictogramThemePaths,
  type ObjectPictogramType,
} from "@/lib/object-pictograms";

type DecorativeObjectPictogramProps = {
  decorative?: true;
  alt?: never;
};

type InformativeObjectPictogramProps = {
  decorative: false;
  alt: string;
};

type ObjectPictogramProps = {
  objectType: ObjectPictogramType;
  size?: number;
  className?: string;
} & React.HTMLAttributes<HTMLSpanElement> &
  (DecorativeObjectPictogramProps | InformativeObjectPictogramProps);

export function ObjectPictogram({
  objectType,
  size = 32,
  className,
  decorative = true,
  alt,
  ...spanProps
}: ObjectPictogramProps) {
  const sources = getObjectPictogramThemePaths({
    objectType,
    requestedSize: size,
  });
  const altText = decorative ? "" : (alt ?? "");

  return (
    <span
      {...spanProps}
      className={cn("inline-flex items-center justify-center", className)}
      aria-hidden={decorative ? true : undefined}
    >
      <Image
        src={sources.light}
        alt={altText}
        width={size}
        height={size}
        className="block h-full w-full object-contain dark:hidden"
        loading="lazy"
      />
      <Image
        src={sources.dark}
        alt={altText}
        width={size}
        height={size}
        className="hidden h-full w-full object-contain dark:block"
        loading="lazy"
      />
    </span>
  );
}
