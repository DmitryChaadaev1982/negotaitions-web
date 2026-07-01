export type CameraEnablePlan = {
  shouldReuseExistingTrack: boolean;
  shouldCreateVideoStream: boolean;
  shouldAddStreamToConference: boolean;
};

export function buildCameraEnablePlan(params: {
  hasLocalVideoStream: boolean;
  hasReusableTrack: boolean;
  videoStreamAlreadyAdded: boolean;
}): CameraEnablePlan {
  if (params.hasLocalVideoStream && params.hasReusableTrack) {
    return {
      shouldReuseExistingTrack: true,
      shouldCreateVideoStream: false,
      shouldAddStreamToConference: false,
    };
  }

  return {
    shouldReuseExistingTrack: false,
    shouldCreateVideoStream: true,
    shouldAddStreamToConference: !params.videoStreamAlreadyAdded,
  };
}

export function isDuplicateVideoStreamError(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();
  return normalized.includes("stream with type video already exists");
}
