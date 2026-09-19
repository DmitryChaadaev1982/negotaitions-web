/**
 * Conference / generation callback ownership.
 *
 * Old-generation Conference callbacks and unsubscribed state watchers must
 * not mutate current runtime or Layer-3 projection. Reconnect-episode
 * observation is permitted only while the watcher still owns the current
 * Conference object (R1 pending-incident flush).
 */

export function shouldApplyConferenceCallback(input: {
  eventGeneration: number;
  currentGeneration: number;
  callbackConference: object | null | undefined;
  currentConference: object | null | undefined;
  stale?: boolean;
  mounted?: boolean;
}): boolean {
  if (input.mounted === false) return false;
  if (input.stale) return false;
  if (input.eventGeneration !== input.currentGeneration) return false;
  if (!input.callbackConference || !input.currentConference) return false;
  return input.callbackConference === input.currentConference;
}

export function isAuthoritativeConferenceStateWatcher(input: {
  watcherConference: object | null | undefined;
  currentConference: object | null | undefined;
  watcherEpoch: number;
  currentEpoch: number;
}): boolean {
  if (!input.watcherConference || !input.currentConference) return false;
  if (input.watcherEpoch !== input.currentEpoch) return false;
  return input.watcherConference === input.currentConference;
}

export type ConferenceStateWatcherOwner = {
  claim(conference: object): number;
  release(conference?: object | null): void;
  isAuthoritative(conference: object, watcherEpoch: number): boolean;
  wrap<T>(
    conference: object,
    watcherEpoch: number,
    listener: (next: T) => void,
  ): (next: T) => void;
};

/**
 * Object-identity + epoch token for one Conference state.watch subscription.
 * A late callback from a released watcher must not write current state.
 */
export function createConferenceStateWatcherOwner(): ConferenceStateWatcherOwner {
  let epoch = 0;
  let owner: object | null = null;
  let ownerEpoch = 0;

  const isAuthoritative = (conference: object, watcherEpoch: number) =>
    isAuthoritativeConferenceStateWatcher({
      watcherConference: conference,
      currentConference: owner,
      watcherEpoch,
      currentEpoch: ownerEpoch,
    });

  return {
    claim(conference: object): number {
      epoch += 1;
      owner = conference;
      ownerEpoch = epoch;
      return epoch;
    },
    release(conference?: object | null): void {
      if (conference && owner !== conference) return;
      owner = null;
      epoch += 1;
      ownerEpoch = epoch;
    },
    isAuthoritative,
    wrap<T>(
      conference: object,
      watcherEpoch: number,
      listener: (next: T) => void,
    ): (next: T) => void {
      return (next: T) => {
        if (!isAuthoritative(conference, watcherEpoch)) return;
        listener(next);
      };
    },
  };
}

export function wrapConferenceEventCallback<TArgs extends unknown[]>(
  input: {
    eventGeneration: number;
    callbackConference: object;
    getCurrentGeneration: () => number;
    getCurrentConference: () => object | null | undefined;
    getStale?: () => boolean;
    getMounted?: () => boolean;
  },
  handler: (...args: TArgs) => void,
): (...args: TArgs) => void {
  return (...args: TArgs) => {
    if (
      !shouldApplyConferenceCallback({
        eventGeneration: input.eventGeneration,
        currentGeneration: input.getCurrentGeneration(),
        callbackConference: input.callbackConference,
        currentConference: input.getCurrentConference(),
        stale: input.getStale?.() ?? false,
        mounted: input.getMounted?.() ?? true,
      })
    ) {
      return;
    }
    handler(...args);
  };
}
