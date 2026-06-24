"use client";

import { Track } from "livekit-client";
import {
  DisconnectButton,
  MediaDeviceMenu,
  TrackToggle,
  useLocalParticipantPermissions,
  usePersistentUserChoices,
} from "@livekit/components-react";
import { useCallback, useMemo } from "react";

import { useI18n } from "@/lib/i18n/useI18n";

type RestrictedControlBarProps = {
  micAllowed: boolean;
  onLeave: () => void;
};

export function RestrictedControlBar({
  micAllowed,
  onLeave,
}: RestrictedControlBarProps) {
  const { t } = useI18n();
  const localPermissions = useLocalParticipantPermissions();
  const { saveAudioInputEnabled, saveVideoInputEnabled, saveAudioInputDeviceId, saveVideoInputDeviceId } =
    usePersistentUserChoices({ preventSave: false });

  const visibleControls = useMemo(() => {
    if (!localPermissions) {
      return { microphone: false, camera: false, leave: true };
    }

    const canPublishSource = (source: Track.Source) =>
      localPermissions.canPublish &&
      (localPermissions.canPublishSources.length === 0 ||
        localPermissions.canPublishSources.includes(
          source === Track.Source.Camera ? 1 : source === Track.Source.Microphone ? 2 : 0,
        ));

    return {
      microphone: micAllowed && canPublishSource(Track.Source.Microphone),
      camera: canPublishSource(Track.Source.Camera),
      leave: true,
    };
  }, [localPermissions, micAllowed]);

  const microphoneOnChange = useCallback(
    (enabled: boolean, isUserInitiated: boolean) =>
      isUserInitiated ? saveAudioInputEnabled(enabled) : null,
    [saveAudioInputEnabled],
  );

  const cameraOnChange = useCallback(
    (enabled: boolean, isUserInitiated: boolean) =>
      isUserInitiated ? saveVideoInputEnabled(enabled) : null,
    [saveVideoInputEnabled],
  );

  return (
    <div className="lk-control-bar">
      {visibleControls.microphone ? (
        <div className="lk-button-group">
          <TrackToggle
            source={Track.Source.Microphone}
            showIcon
            onChange={microphoneOnChange}
          >
            {t("room.microphone")}
          </TrackToggle>
          <div className="lk-button-group-menu">
            <MediaDeviceMenu
              kind="audioinput"
              onActiveDeviceChange={(_kind, deviceId) =>
                saveAudioInputDeviceId(deviceId ?? "default")
              }
            />
          </div>
        </div>
      ) : null}

      {visibleControls.camera ? (
        <div className="lk-button-group">
          <TrackToggle
            source={Track.Source.Camera}
            showIcon
            onChange={cameraOnChange}
          >
            {t("room.camera")}
          </TrackToggle>
          <div className="lk-button-group-menu">
            <MediaDeviceMenu
              kind="videoinput"
              onActiveDeviceChange={(_kind, deviceId) =>
                saveVideoInputDeviceId(deviceId ?? "default")
              }
            />
          </div>
        </div>
      ) : null}

      {visibleControls.leave ? (
        <DisconnectButton onClick={onLeave}>{t("room.leave")}</DisconnectButton>
      ) : null}
    </div>
  );
}
