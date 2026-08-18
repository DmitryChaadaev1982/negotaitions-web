"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  scheduleYandexMetricaDestruct,
  syncYandexMetrica,
} from "@/lib/analytics/yandex-metrica-client";
import {
  YANDEX_METRICA_SCRIPT_SRC,
  parseYandexMetricaCounterId,
  shouldLoadYandexMetrica,
} from "@/lib/analytics/yandex-metrica";
import {
  COOKIE_CONSENT_CHANGED_EVENT,
  hasCookieConsent,
} from "@/lib/consent/cookie-consent";

export function PublicSiteAnalytics({
  counterId,
}: {
  counterId: string | null;
}) {
  const pathname = usePathname();
  const [analyticsConsent, setAnalyticsConsent] = useState(false);
  const validCounterId = parseYandexMetricaCounterId(counterId);
  const enabled = shouldLoadYandexMetrica({
    counterId: validCounterId,
    analyticsConsent,
  });

  useEffect(() => {
    const sync = () => {
      setAnalyticsConsent(hasCookieConsent("analytics"));
    };
    sync();
    window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, sync);
      scheduleYandexMetricaDestruct();
    };
  }, []);

  useEffect(() => {
    syncYandexMetrica({
      counterId: validCounterId,
      analyticsConsent: enabled,
      pathname,
    });
  }, [enabled, validCounterId, pathname]);

  if (!enabled || !validCounterId) {
    return null;
  }

  return (
    <>
      <span data-testid="yandex-metrica-active" hidden />
      <Script
        id="yandex-metrica-tag"
        src={YANDEX_METRICA_SCRIPT_SRC}
        strategy="afterInteractive"
        onLoad={() => {
          syncYandexMetrica({
            counterId: validCounterId,
            analyticsConsent: true,
            pathname,
          });
        }}
      />
    </>
  );
}
