"use client";

import { ConnectionState } from "livekit-client";
import { useRoomContext } from "@livekit/components-react";
import { useEffect, useState } from "react";

import { GradientButton } from "@/components/ui/buttons";
import { useI18n } from "@/lib/i18n/useI18n";

type LiveKitReconnectBannerProps = {
  onManualRejoin?: () => void;
};

export function LiveKitReconnectBanner({
  onManualRejoin,
}: LiveKitReconnectBannerProps) {
  const room = useRoomContext();
  const { t } = useI18n();
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    room.state,
  );
  const [showReconnected, setShowReconnected] = useState(false);
  const [manualFailed, setManualFailed] = useState(false);

  useEffect(() => {
    const handleStateChange = (state: ConnectionState) => {
      setConnectionState((previous) => {
        if (
          (previous === ConnectionState.Reconnecting ||
            previous === ConnectionState.Disconnected) &&
          state === ConnectionState.Connected
        ) {
          setShowReconnected(true);
          setManualFailed(false);
          window.setTimeout(() => setShowReconnected(false), 3000);
        }

        if (state === ConnectionState.Disconnected) {
          window.setTimeout(() => {
            setManualFailed((current) => {
              if (room.state === ConnectionState.Disconnected) {
                return true;
              }

              return current;
            });
          }, 12_000);
        }

        return state;
      });
    };

    handleStateChange(room.state);
    room.on("connectionStateChanged", handleStateChange);

    return () => {
      room.off("connectionStateChanged", handleStateChange);
    };
  }, [room]);

  if (connectionState === ConnectionState.Connected && !showReconnected) {
    return null;
  }

  const isReconnecting =
    connectionState === ConnectionState.Reconnecting ||
    (connectionState === ConnectionState.Disconnected && !manualFailed);

  return (
    <div className="absolute inset-x-0 top-0 z-20 border-b border-amber-500/30 bg-amber-950/90 px-4 py-2 text-center text-sm text-amber-100 backdrop-blur-sm">
      {showReconnected ? (
        <p>{t("rejoin.reconnected")}</p>
      ) : isReconnecting ? (
        <p>{t("rejoin.connectionLost")}</p>
      ) : (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <p>{t("rejoin.couldNotReconnect")}</p>
          <GradientButton
            type="button"
            className="px-3 py-1 text-xs"
            onClick={() => {
              if (onManualRejoin) {
                onManualRejoin();
                return;
              }

              window.location.reload();
            }}
          >
            {t("rejoin.rejoinRoom")}
          </GradientButton>
        </div>
      )}
    </div>
  );
}
