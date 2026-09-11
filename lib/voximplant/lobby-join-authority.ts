/**
 * Event-lobby conference membership authority.
 *
 * Successful `conference.join()` for this mount's conference instance is the
 * only authoritative join edge. SDK `Connected` may be observed and used for
 * later reconciliation; it is not independently sufficient to expose joined
 * media UI.
 */

export type LobbyJoinAuthorityState = {
  joined: boolean;
  conferenceConnected: boolean;
  sdkConnectedObserved: boolean;
};

export type LobbyJoinAuthorityEvent =
  | "sdk_connected"
  | "conference_join_resolved"
  | "disconnected"
  | "cleanup"
  | "join_failed";

export const INITIAL_LOBBY_JOIN_AUTHORITY: LobbyJoinAuthorityState = {
  joined: false,
  conferenceConnected: false,
  sdkConnectedObserved: false,
};

export function reduceLobbyJoinAuthority(
  state: LobbyJoinAuthorityState,
  event: LobbyJoinAuthorityEvent,
): LobbyJoinAuthorityState {
  switch (event) {
    case "sdk_connected":
      return {
        ...state,
        sdkConnectedObserved: true,
      };
    case "conference_join_resolved":
      return {
        ...state,
        joined: true,
        conferenceConnected: true,
      };
    case "disconnected":
    case "cleanup":
    case "join_failed":
      return {
        joined: false,
        conferenceConnected: false,
        sdkConnectedObserved: false,
      };
  }
}

export function lobbyJoinAuthorityBecameTrue(
  previous: LobbyJoinAuthorityState,
  next: LobbyJoinAuthorityState,
): boolean {
  return !previous.joined && next.joined && next.conferenceConnected;
}

export function shouldExposeLobbyMediaUi(state: Pick<LobbyJoinAuthorityState, "joined" | "conferenceConnected">): boolean {
  return state.joined && state.conferenceConnected;
}

export function shouldStartRemoteAudioPlayback(conferenceConnected: boolean): boolean {
  return conferenceConnected;
}

export type LobbyRemoteAudioElement = {
  pause: () => void;
  srcObject: MediaProvider | null;
};

export function releaseLobbyRemoteAudioElements(
  elements: Iterable<LobbyRemoteAudioElement>,
): void {
  for (const audio of elements) {
    audio.pause();
    audio.srcObject = null;
  }
}
