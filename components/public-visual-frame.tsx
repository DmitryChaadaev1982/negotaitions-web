import Image from "next/image";

import { cn } from "@/lib/cn";
import type { Locale } from "@/lib/i18n/config";
import {
  getPublicSiteVisual,
  type PublicSiteVisualSlot,
} from "@/lib/public-site/visuals";

type PublicVisualFrameProps = {
  slot: PublicSiteVisualSlot;
  locale: Locale;
  alt: string;
  className?: string;
  priority?: boolean;
};

export function PublicVisualFrame({
  slot,
  locale,
  alt,
  className,
  priority = false,
}: PublicVisualFrameProps) {
  const visual = getPublicSiteVisual(slot, locale);
  const isWideFlow = slot === "training-flow";
  const cropTop = visual.cropTop ?? 0;
  const fittedHeight = visual.height - cropTop;

  return (
    <div
      data-public-visual-slot={slot}
      className={cn(
        "glass-hero relative min-w-0 w-full max-w-full overflow-hidden rounded-2xl",
        className,
      )}
      style={
        isWideFlow
          ? { aspectRatio: `${visual.width} / ${fittedHeight}` }
          : undefined
      }
    >
      <Image
        src={visual.src}
        alt={alt}
        width={visual.width}
        height={visual.height}
        priority={priority}
        sizes={
          isWideFlow
            ? "(min-width: 1152px) 1152px, 100vw"
            : "(min-width: 1024px) 46vw, 100vw"
        }
        className={
          isWideFlow
            ? "absolute inset-0 h-full w-full object-cover object-bottom"
            : "h-auto w-full max-w-full object-contain object-center"
        }
      />
    </div>
  );
}
