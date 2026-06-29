export type VideoProvider = "livekit" | "voximplant";

export type VoximplantRecordingAudioMode = "lossless" | "hd_mp3";

export type VoximplantRecordingConfig = {
  enabled: boolean;
  audioOnly: boolean;
  audioMode: VoximplantRecordingAudioMode;
  pauseEnabled: boolean;
};

export type VoximplantConfig = {
  accountName: string | null;
  applicationName: string | null;
  userDomain: string | null;
  scenarioName: string | null;
  ruleName: string | null;
  apiKeyPath: string | null;
  recordingStorage: string | null;
  recording: VoximplantRecordingConfig;
};
