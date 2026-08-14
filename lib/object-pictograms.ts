export const OBJECT_PICTOGRAM_TYPES = ["event", "room", "case"] as const;
export type ObjectPictogramType = (typeof OBJECT_PICTOGRAM_TYPES)[number];

export const OBJECT_PICTOGRAM_THEMES = ["light", "dark"] as const;
export type ObjectPictogramTheme = (typeof OBJECT_PICTOGRAM_THEMES)[number];

const AVAILABLE_SIZES = [32, 48, 64, 128, 256] as const;
type AvailableSize = (typeof AVAILABLE_SIZES)[number];

function nearestAvailableSize(requestedSize: number): AvailableSize {
  return AVAILABLE_SIZES.reduce<AvailableSize>(
    (closest, candidate) => {
      const candidateDistance = Math.abs(candidate - requestedSize);
      const closestDistance = Math.abs(closest - requestedSize);
      if (candidateDistance < closestDistance) {
        return candidate;
      }
      if (candidateDistance === closestDistance && candidate > closest) {
        return candidate;
      }
      return closest;
    },
    AVAILABLE_SIZES[0],
  );
}

export function getObjectPictogramPath(params: {
  objectType: ObjectPictogramType;
  theme: ObjectPictogramTheme;
  requestedSize: number;
}): string {
  const resolvedSize = nearestAvailableSize(params.requestedSize);
  return `/icons/objects/${params.theme}/${params.objectType}-${resolvedSize}.png`;
}

export function getObjectPictogramThemePaths(params: {
  objectType: ObjectPictogramType;
  requestedSize: number;
}): { light: string; dark: string } {
  return {
    light: getObjectPictogramPath({
      objectType: params.objectType,
      theme: "light",
      requestedSize: params.requestedSize,
    }),
    dark: getObjectPictogramPath({
      objectType: params.objectType,
      theme: "dark",
      requestedSize: params.requestedSize,
    }),
  };
}
