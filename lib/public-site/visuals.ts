import type { Locale } from "@/lib/i18n/config";

export const PUBLIC_SITE_VISUAL_SLOTS = ["hero-product", "training-flow"] as const;

export type PublicSiteVisualSlot = (typeof PUBLIC_SITE_VISUAL_SLOTS)[number];

type PublicSiteVisualAsset = {
  src: string;
  width: number;
  height: number;
  /** Extra empty pixels to clip from the top so the framed inset matches the bottom. */
  cropTop?: number;
};

const PUBLIC_SITE_VISUALS: Record<
  PublicSiteVisualSlot,
  Record<Locale, PublicSiteVisualAsset>
> = {
  "hero-product": {
    ru: {
      src: "/images/landing/hero-negotiation-ai.jpg",
      width: 819,
      height: 1024,
    },
    en: {
      src: "/images/landing/hero-negotiation-ai.jpg",
      width: 819,
      height: 1024,
    },
  },
  "training-flow": {
    ru: {
      src: "/images/public-site/public-how-it-works-ru-no-heading.png",
      width: 2173,
      height: 724,
      cropTop: 63,
    },
    en: {
      src: "/images/public-site/public-how-it-works-en-no-heading.png",
      width: 2173,
      height: 724,
      cropTop: 36,
    },
  },
};

export function getPublicSiteVisual(
  slot: PublicSiteVisualSlot,
  locale: Locale,
): PublicSiteVisualAsset {
  return PUBLIC_SITE_VISUALS[slot][locale];
}
