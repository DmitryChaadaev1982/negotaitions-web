import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createDroppedCauseReporter,
  installVoxReInviteSchemeSanitizer,
  sanitizeReInviteScheme,
  VI_CONF_INFO_ADDED,
  VI_CONF_INFO_REMOVED,
  VI_CONF_INFO_UPDATED,
  type ReInviteSchemeLike,
} from "@/lib/voximplant/reinvite-scheme-sanitizer";

// ─── Fixtures ────────────────────────────────────────────────────────────────
//
// Structures below are the WebSDK wire form (`endpoints[id].mids`) of two real
// ReInvite messages captured in provider session 4916072620 / conference
// negotiation-cms55o9i900040cua7tu2hkvo (local dev account). Display names and
// provider usernames are replaced with neutral placeholders; endpoint ids, mids,
// place indexes, cause order and politeIndex are verbatim.
//
// Both messages are the initial full-roster ReInvite delivered to a client that
// joined while the VoxEngine conference audio recorder was already established.
// The recorder is announced as a `vi/conf-info-added` cause but has no
// `endpoints` entry, because the SDK protocol models only `type: "call"`
// endpoints. Neither client returned an AcceptReInvite in the provider log.

const RECORDER_ENDPOINT_ID = "87Qpc2OyTJ6SRYcBPB3GTzgj0MctLEP0papBjZ5vO7o";
const PARTICIPANT_ENDPOINT_ID = "A5D7577513BAFE3E.1785273388.515872";
const FACILITATOR_ENDPOINT_ID = "C54D589237763F9D.1785273440.515910";
const DEPARTED_ENDPOINT_ID = "F1530A56FC39CD22.1785273390.515881";

const REJOINING_PARTICIPANT_CALL_ID = "13DB3072737C63BD.1785273494.515952";
const REJOINING_FACILITATOR_CALL_ID = "C54D589237763F9D.1785273440.515910";

/** ReInvite delivered to the rejoining participant (provider log line 352). */
function participantRejoinScheme() {
  return {
    conferenceCall: true,
    politeIndex: -6,
    endpoints: {
      [PARTICIPANT_ENDPOINT_ID]: {
        mids: { a2: "audio", v0: "video" },
        tracks: {},
        place: 1,
        type: "call",
      },
      [FACILITATOR_ENDPOINT_ID]: {
        mids: { a3: "audio" },
        tracks: {},
        place: 4,
        type: "call",
      },
    },
    reinviteCauses: [
      {
        displayName: "Participant A",
        event: VI_CONF_INFO_ADDED,
        id: PARTICIPANT_ENDPOINT_ID,
        place: 1,
        sipURI: "",
        username: "ng_u_participant_a",
      },
      { event: VI_CONF_INFO_ADDED, id: RECORDER_ENDPOINT_ID },
      {
        displayName: "Facilitator",
        event: VI_CONF_INFO_ADDED,
        id: FACILITATOR_ENDPOINT_ID,
        place: 0,
        sipURI: "",
        username: "ng_u_facilitator",
      },
    ],
  };
}

/** ReInvite delivered to the rejoining facilitator (provider log line 266). */
function facilitatorRejoinScheme() {
  return {
    conferenceCall: true,
    politeIndex: -5,
    endpoints: {
      [PARTICIPANT_ENDPOINT_ID]: {
        mids: { a1: "audio", v0: "video" },
        tracks: {},
        place: 1,
        type: "call",
      },
      [DEPARTED_ENDPOINT_ID]: {
        mids: { a2: "audio" },
        tracks: {},
        place: 2,
        type: "call",
      },
    },
    reinviteCauses: [
      {
        displayName: "Participant A",
        event: VI_CONF_INFO_ADDED,
        id: PARTICIPANT_ENDPOINT_ID,
        place: 1,
        sipURI: "",
        username: "ng_u_participant_a",
      },
      {
        displayName: "Participant B",
        event: VI_CONF_INFO_ADDED,
        id: DEPARTED_ENDPOINT_ID,
        place: 2,
        sipURI: "",
        username: "ng_u_participant_b",
      },
      { event: VI_CONF_INFO_ADDED, id: RECORDER_ENDPOINT_ID },
    ],
  };
}

function reInviteMessage(callId: string, scheme: unknown) {
  return {
    type: "message",
    payload: {
      name: "handleReInvite",
      params: { id: callId, headers: {}, sdp: "v=0\r\n<offer>", scheme },
    },
  };
}

// ─── Real WebSDK source harness ──────────────────────────────────────────────
//
// The harness executes the shipped `handleCurrentConferenceReInvite` body from
// the installed browser bundle rather than a reimplementation, so the failing
// expression is the real one. Extraction failure is the upgrade tripwire: it
// means the SDK source changed and the sanitizer must be re-evaluated.

const SDK_BUNDLE_PATH = path.resolve(
  process.cwd(),
  "node_modules/@voximplant/websdk/modules/conference-manager/conference-manager.esm.min.js",
);
const SDK_METHOD_ANCHOR = "handleCurrentConferenceReInvite(e){";

function extractShippedReInviteHandlerSource(): string {
  const bundle = readFileSync(SDK_BUNDLE_PATH, "utf8");
  const start = bundle.indexOf(SDK_METHOD_ANCHOR);
  assert.notEqual(
    start,
    -1,
    `Could not find "${SDK_METHOD_ANCHOR}" in ${SDK_BUNDLE_PATH}. ` +
      "The installed @voximplant/websdk conference-manager changed shape: re-run the " +
      "ReInvite forensic analysis and confirm whether lib/voximplant/reinvite-scheme-sanitizer.ts " +
      "is still required.",
  );

  let depth = 0;
  for (let i = start + SDK_METHOD_ANCHOR.length - 1; i < bundle.length; i += 1) {
    if (bundle[i] === "{") depth += 1;
    else if (bundle[i] === "}") {
      depth -= 1;
      if (depth === 0) return bundle.slice(start, i + 1);
    }
  }
  throw new Error(`Unbalanced braces while extracting ${SDK_METHOD_ANCHOR}`);
}

const shippedHandlerSource = extractShippedReInviteHandlerSource();

type HarnessEndpoint = {
  id: string;
  userName: string;
  displayName: string;
  midData: Map<string, string>;
  streams: Map<string, { mid: string }>;
  removeMedia: (mid: string) => void;
  updateMidData: (mids: Record<string, string>) => void;
};

type Harness = {
  run: (params: unknown) => void;
  endpoints: Map<string, HarnessEndpoint>;
  dispatched: { name: string; payload: Record<string, unknown> }[];
  queuedActions: { callId: string; eventParams: unknown }[];
  removedMedia: string[];
};

class HarnessMidNotFoundError extends Error {
  constructor(mid: string) {
    super(`Mid - ${mid} is not found`);
    this.name = "MidNotFoundError";
  }
}

class HarnessEndpointNotFoundError extends Error {
  constructor(id: string) {
    super(`Endpoint - ${id} is not found`);
    this.name = "EndpointNotFoundError";
  }
}

/**
 * Builds a conference double whose `handleCurrentConferenceReInvite` is the
 * unmodified source shipped in node_modules.
 */
function createShippedHandlerHarness(options?: {
  conferenceCallId?: string;
  existingEndpoints?: { id: string; mids: Record<string, string>; withStreams?: boolean }[];
}): Harness {
  const dispatched: Harness["dispatched"] = [];
  const queuedActions: Harness["queuedActions"] = [];
  const removedMedia: string[] = [];
  const endpoints = new Map<string, HarnessEndpoint>();

  const makeEndpoint = (input: {
    id: string;
    userName?: string;
    displayName?: string;
    midData: Map<string, string>;
    withStreams?: boolean;
  }): HarnessEndpoint => {
    const endpoint: HarnessEndpoint = {
      id: input.id,
      userName: input.userName ?? "",
      displayName: input.displayName ?? "",
      midData: input.midData,
      streams: new Map(),
      removeMedia(mid) {
        if (!this.streams.has(mid)) throw new HarnessMidNotFoundError(mid);
        this.streams.delete(mid);
        this.midData.delete(mid);
        removedMedia.push(`${this.id}:${mid}`);
      },
      updateMidData(mids) {
        const nextMids = Object.keys(mids);
        const removed = [...this.midData.keys()].filter((mid) => !nextMids.includes(mid));
        const added = nextMids.filter((mid) => !this.midData.has(mid));
        for (const mid of removed) this.removeMedia(mid);
        for (const mid of added) this.midData.set(mid, mids[mid]);
      },
    };
    if (input.withStreams) {
      for (const mid of input.midData.keys()) endpoint.streams.set(mid, { mid });
    }
    return endpoint;
  };

  for (const existing of options?.existingEndpoints ?? []) {
    endpoints.set(
      existing.id,
      makeEndpoint({
        id: existing.id,
        midData: new Map(Object.entries(existing.mids)),
        withStreams: existing.withStreams ?? true,
      }),
    );
  }

  const conferenceDouble = {
    id: options?.conferenceCallId ?? REJOINING_PARTICIPANT_CALL_ID,
    pc: {},
    container: {},
    screenSharing: { value: null as { endpointId?: string } | null },
    logger: { info: () => {} },
    dispatchEvent: (event: { name: string; payload: Record<string, unknown> }) => {
      dispatched.push(event);
    },
    reInviteQueue: {
      add: (action: { callId: string; eventParams: unknown }) => {
        queuedActions.push(action);
      },
    },
    endpointManager: {
      createEndpoint: (input: {
        id: string;
        userName: string;
        displayName: string;
        midData: Map<string, string>;
      }) => {
        const endpoint = makeEndpoint(input);
        endpoints.set(endpoint.id, endpoint);
        return endpoint;
      },
      removeEndpoint: (id: string) => {
        const endpoint = endpoints.get(id);
        if (!endpoint) return null;
        endpoints.delete(id);
        return endpoint;
      },
      getEndpointById: (id: string) => endpoints.get(id) ?? null,
    },
  };

  // Free identifiers referenced by the shipped method body.
  const isSelfScreenSharingEvent = (
    params: { scheme: { reinviteCauses: { id?: string }[] } },
    screenSharing: { endpointId?: string } | null,
  ) => params.scheme.reinviteCauses.some((cause) => cause.id === screenSharing?.endpointId);
  const ConferenceEvent = {
    EndpointAdded: "EndpointAdded",
    EndpointRemoved: "EndpointRemoved",
  };
  class HandleReInviteConferenceAction {
    callId: string;
    eventParams: unknown;
    constructor(input: { callId: string; eventParams: unknown }) {
      this.callId = input.callId;
      this.eventParams = input.eventParams;
    }
  }

  const factory = new Function(
    "isSelfScreenSharingEvent",
    "ConferenceEvent",
    "EndpointNotFoundError",
    "HandleReInviteConferenceAction",
    `return function ${shippedHandlerSource};`,
  ) as (
    ...deps: unknown[]
  ) => (this: typeof conferenceDouble, params: unknown) => void;

  const shippedHandler = factory(
    isSelfScreenSharingEvent,
    ConferenceEvent,
    HarnessEndpointNotFoundError,
    HandleReInviteConferenceAction,
  );

  return {
    run: (params: unknown) => shippedHandler.call(conferenceDouble, params),
    endpoints,
    dispatched,
    queuedActions,
    removedMedia,
  };
}

// ─── Phase 3: original fixture fails against original SDK behavior ───────────

test("shipped WebSDK handler throws the reported TypeError on the raw rejoin fixture", () => {
  const harness = createShippedHandlerHarness();
  const params = reInviteMessage(REJOINING_PARTICIPANT_CALL_ID, participantRejoinScheme())
    .payload.params;

  assert.throws(
    () => harness.run(params),
    (error: unknown) =>
      error instanceof TypeError && /reading '?mids'?/.test((error as Error).message),
    "unmodified SDK behavior must still reproduce the .mids TypeError",
  );

  // The throw aborts before reInviteQueue.add, so the SDP offer is never applied
  // and no AcceptReInvite is returned — matching the provider log.
  assert.equal(harness.queuedActions.length, 0);
  // Causes after the unresolvable one are lost.
  assert.deepEqual([...harness.endpoints.keys()], [PARTICIPANT_ENDPOINT_ID]);
});

test("shipped WebSDK handler throws on the raw facilitator rejoin fixture", () => {
  const harness = createShippedHandlerHarness({
    conferenceCallId: REJOINING_FACILITATOR_CALL_ID,
  });
  const params = reInviteMessage(REJOINING_FACILITATOR_CALL_ID, facilitatorRejoinScheme())
    .payload.params;

  assert.throws(() => harness.run(params), TypeError);
  assert.equal(harness.queuedActions.length, 0);
});

// ─── Phase 3/7: the fix prevents the exception and restores negotiation ──────

test("sanitized rejoin fixture no longer throws and reaches the SDP negotiation step", () => {
  const scheme = participantRejoinScheme();
  const params = reInviteMessage(REJOINING_PARTICIPANT_CALL_ID, scheme).payload.params;

  const result = sanitizeReInviteScheme(scheme);
  assert.equal(result.changed, true);
  assert.equal(result.keptCauseCount, 2);
  assert.deepEqual(result.dropped, [
    {
      event: VI_CONF_INFO_ADDED,
      id: RECORDER_ENDPOINT_ID,
      reason: "missing_endpoint_entry",
    },
  ]);

  const harness = createShippedHandlerHarness();
  harness.run(params);

  // Participant appears once, facilitator appears once, recorder is absent.
  assert.deepEqual(
    [...harness.endpoints.keys()].sort(),
    [PARTICIPANT_ENDPOINT_ID, FACILITATOR_ENDPOINT_ID].sort(),
  );
  assert.equal(harness.endpoints.has(RECORDER_ENDPOINT_ID), false);

  // Exactly one EndpointAdded per real participant.
  assert.deepEqual(
    harness.dispatched.map((event) => event.name),
    ["EndpointAdded", "EndpointAdded"],
  );
  assert.deepEqual(
    harness.dispatched.map((event) => event.payload.newEndpointId),
    [PARTICIPANT_ENDPOINT_ID, FACILITATOR_ENDPOINT_ID],
  );

  // The ReInvite action is queued exactly once: SDP is applied and
  // AcceptReInvite is sent, so remote media can flow.
  assert.equal(harness.queuedActions.length, 1);
  assert.equal(harness.queuedActions[0].callId, REJOINING_PARTICIPANT_CALL_ID);
  assert.equal(harness.queuedActions[0].eventParams, params);
});

test("sanitized fixture keeps audio and video mid types for each endpoint", () => {
  const scheme = participantRejoinScheme();
  const params = reInviteMessage(REJOINING_PARTICIPANT_CALL_ID, scheme).payload.params;
  sanitizeReInviteScheme(scheme);

  const harness = createShippedHandlerHarness();
  harness.run(params);

  const videoParticipant = harness.endpoints.get(PARTICIPANT_ENDPOINT_ID);
  assert.ok(videoParticipant);
  assert.deepEqual([...videoParticipant.midData.entries()].sort(), [
    ["a2", "audio"],
    ["v0", "video"],
  ]);

  const audioOnlyParticipant = harness.endpoints.get(FACILITATOR_ENDPOINT_ID);
  assert.ok(audioOnlyParticipant);
  assert.deepEqual([...audioOnlyParticipant.midData.entries()], [["a3", "audio"]]);
});

test("sanitized facilitator rejoin fixture produces both participants once", () => {
  const scheme = facilitatorRejoinScheme();
  const params = reInviteMessage(REJOINING_FACILITATOR_CALL_ID, scheme).payload.params;
  sanitizeReInviteScheme(scheme);

  const harness = createShippedHandlerHarness({
    conferenceCallId: REJOINING_FACILITATOR_CALL_ID,
  });
  harness.run(params);

  assert.deepEqual(
    [...harness.endpoints.keys()],
    [PARTICIPANT_ENDPOINT_ID, DEPARTED_ENDPOINT_ID],
  );
  assert.equal(harness.queuedActions.length, 1);
});

// ─── Phase 3/7: scheme-shape coverage ───────────────────────────────────────

test("endpoints and politeIndex are never modified by sanitization", () => {
  const scheme = participantRejoinScheme();
  const endpointsBefore = JSON.stringify(scheme.endpoints);
  sanitizeReInviteScheme(scheme);
  assert.equal(JSON.stringify(scheme.endpoints), endpointsBefore);
  assert.equal(scheme.politeIndex, -6);
  assert.equal(scheme.conferenceCall, true);
});

test("conf-info-removed causes are preserved even when the endpoint is absent", () => {
  const scheme: ReInviteSchemeLike = {
    endpoints: { [PARTICIPANT_ENDPOINT_ID]: { mids: { a1: "audio" } } },
    reinviteCauses: [
      { event: VI_CONF_INFO_REMOVED, id: DEPARTED_ENDPOINT_ID },
      { event: VI_CONF_INFO_ADDED, id: PARTICIPANT_ENDPOINT_ID },
    ],
  };

  const result = sanitizeReInviteScheme(scheme);
  assert.equal(result.changed, false);
  assert.equal(scheme.reinviteCauses?.length, 2);

  const harness = createShippedHandlerHarness();
  harness.run({ scheme, sdp: "v=0", headers: {} });
  assert.deepEqual([...harness.endpoints.keys()], [PARTICIPANT_ENDPOINT_ID]);
  assert.equal(harness.queuedActions.length, 1);
});

test("later endpoint removal still removes the endpoint and clears its mids", () => {
  const scheme: ReInviteSchemeLike = {
    endpoints: {},
    reinviteCauses: [{ event: VI_CONF_INFO_REMOVED, id: PARTICIPANT_ENDPOINT_ID }],
  };
  sanitizeReInviteScheme(scheme);

  const harness = createShippedHandlerHarness({
    existingEndpoints: [
      { id: PARTICIPANT_ENDPOINT_ID, mids: { a2: "audio", v0: "video" } },
    ],
  });
  harness.run({ scheme, sdp: "v=0", headers: {} });

  assert.equal(harness.endpoints.has(PARTICIPANT_ENDPOINT_ID), false);
  assert.deepEqual(harness.removedMedia.sort(), [
    `${PARTICIPANT_ENDPOINT_ID}:a2`,
    `${PARTICIPANT_ENDPOINT_ID}:v0`,
  ]);
  assert.deepEqual(
    harness.dispatched.map((event) => event.name),
    ["EndpointRemoved"],
  );
  assert.equal(harness.queuedActions.length, 1);
});

test("resolvable conf-info-updated cause is preserved and leaves no stale mids", () => {
  const scheme: ReInviteSchemeLike = {
    endpoints: { [PARTICIPANT_ENDPOINT_ID]: { mids: { a5: "audio" } } },
    reinviteCauses: [{ event: VI_CONF_INFO_UPDATED, id: PARTICIPANT_ENDPOINT_ID }],
  };
  const result = sanitizeReInviteScheme(scheme);
  assert.equal(result.changed, false);

  const harness = createShippedHandlerHarness({
    existingEndpoints: [{ id: PARTICIPANT_ENDPOINT_ID, mids: { a2: "audio" } }],
  });
  harness.run({ scheme, sdp: "v=0", headers: {} });

  const endpoint = harness.endpoints.get(PARTICIPANT_ENDPOINT_ID);
  assert.ok(endpoint);
  assert.deepEqual([...endpoint.midData.entries()], [["a5", "audio"]]);
  assert.deepEqual(harness.removedMedia, [`${PARTICIPANT_ENDPOINT_ID}:a2`]);
  assert.equal(harness.queuedActions.length, 1);
});

test("unresolvable conf-info-updated cause is dropped instead of aborting the ReInvite", () => {
  const scheme: ReInviteSchemeLike = {
    endpoints: { [PARTICIPANT_ENDPOINT_ID]: { mids: { a1: "audio" } } },
    reinviteCauses: [
      { event: VI_CONF_INFO_UPDATED, id: RECORDER_ENDPOINT_ID },
      { event: VI_CONF_INFO_ADDED, id: PARTICIPANT_ENDPOINT_ID },
    ],
  };

  const unsanitized = structuredClone(scheme);
  assert.throws(
    () => createShippedHandlerHarness().run({ scheme: unsanitized, sdp: "v=0", headers: {} }),
    TypeError,
  );

  const result = sanitizeReInviteScheme(scheme);
  assert.deepEqual(result.dropped, [
    {
      event: VI_CONF_INFO_UPDATED,
      id: RECORDER_ENDPOINT_ID,
      reason: "missing_endpoint_entry",
    },
  ]);

  const harness = createShippedHandlerHarness();
  harness.run({ scheme, sdp: "v=0", headers: {} });
  assert.deepEqual([...harness.endpoints.keys()], [PARTICIPANT_ENDPOINT_ID]);
  assert.equal(harness.queuedActions.length, 1);
});

test("an endpoint entry present but without a mids object is treated as unresolvable", () => {
  const scheme: ReInviteSchemeLike = {
    endpoints: { [RECORDER_ENDPOINT_ID]: { place: 3, type: "recorder" } as never },
    reinviteCauses: [{ event: VI_CONF_INFO_ADDED, id: RECORDER_ENDPOINT_ID }],
  };
  const result = sanitizeReInviteScheme(scheme);
  assert.deepEqual(result.dropped, [
    { event: VI_CONF_INFO_ADDED, id: RECORDER_ENDPOINT_ID, reason: "missing_mids" },
  ]);
  assert.equal(scheme.reinviteCauses?.length, 0);
});

test("cause order is preserved and unresolvable causes are dropped in any position", () => {
  const build = (): ReInviteSchemeLike => ({
    endpoints: {
      first: { mids: { a1: "audio" } },
      second: { mids: { a2: "audio" } },
    },
    reinviteCauses: [
      { event: VI_CONF_INFO_ADDED, id: RECORDER_ENDPOINT_ID },
      { event: VI_CONF_INFO_ADDED, id: "first" },
      { event: VI_CONF_INFO_ADDED, id: "missing-tail" },
      { event: VI_CONF_INFO_ADDED, id: "second" },
    ],
  });

  const scheme = build();
  const result = sanitizeReInviteScheme(scheme);
  assert.equal(result.dropped.length, 2);
  assert.deepEqual(
    scheme.reinviteCauses?.map((cause) => cause.id),
    ["first", "second"],
  );

  const harness = createShippedHandlerHarness();
  harness.run({ scheme, sdp: "v=0", headers: {} });
  assert.deepEqual([...harness.endpoints.keys()], ["first", "second"]);
  assert.equal(harness.queuedActions.length, 1);
});

test("add-then-remove of the same endpoint in one ReInvite stays deterministic", () => {
  const scheme: ReInviteSchemeLike = {
    endpoints: { [PARTICIPANT_ENDPOINT_ID]: { mids: { a1: "audio" } } },
    reinviteCauses: [
      { event: VI_CONF_INFO_ADDED, id: PARTICIPANT_ENDPOINT_ID },
      { event: VI_CONF_INFO_ADDED, id: RECORDER_ENDPOINT_ID },
      { event: VI_CONF_INFO_REMOVED, id: PARTICIPANT_ENDPOINT_ID },
    ],
  };
  sanitizeReInviteScheme(scheme);

  const harness = createShippedHandlerHarness();
  harness.run({ scheme, sdp: "v=0", headers: {} });

  assert.equal(harness.endpoints.size, 0);
  assert.deepEqual(
    harness.dispatched.map((event) => event.name),
    ["EndpointAdded", "EndpointRemoved"],
  );
  assert.equal(harness.queuedActions.length, 1);
});

test("sanitization is idempotent and a second pass reports no change", () => {
  const scheme = participantRejoinScheme();
  const first = sanitizeReInviteScheme(scheme);
  const second = sanitizeReInviteScheme(scheme);
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(scheme.reinviteCauses.length, 2);
});

test("missing, empty or malformed schemes are handled without throwing", () => {
  assert.deepEqual(sanitizeReInviteScheme(undefined), {
    changed: false,
    keptCauseCount: 0,
    dropped: [],
  });
  assert.deepEqual(sanitizeReInviteScheme({}), {
    changed: false,
    keptCauseCount: 0,
    dropped: [],
  });
  assert.deepEqual(sanitizeReInviteScheme({ reinviteCauses: [] }), {
    changed: false,
    keptCauseCount: 0,
    dropped: [],
  });

  const noEndpoints: ReInviteSchemeLike = {
    reinviteCauses: [{ event: VI_CONF_INFO_ADDED, id: "x" }],
  };
  assert.deepEqual(sanitizeReInviteScheme(noEndpoints).dropped, [
    { event: VI_CONF_INFO_ADDED, id: "x", reason: "no_endpoints_record" },
  ]);

  const badId: ReInviteSchemeLike = {
    endpoints: {},
    reinviteCauses: [{ event: VI_CONF_INFO_ADDED, id: 42 }],
  };
  assert.deepEqual(sanitizeReInviteScheme(badId).dropped, [
    { event: VI_CONF_INFO_ADDED, id: "", reason: "invalid_cause_id" },
  ]);

  const unknownEvent: ReInviteSchemeLike = {
    endpoints: {},
    reinviteCauses: [{ event: "vi/conf-info-future", id: "x" }, { id: "y" }],
  };
  assert.equal(sanitizeReInviteScheme(unknownEvent).changed, false);
});

test("inherited object keys are not accepted as endpoint entries", () => {
  const scheme: ReInviteSchemeLike = {
    endpoints: {},
    reinviteCauses: [{ event: VI_CONF_INFO_ADDED, id: "toString" }],
  };
  assert.deepEqual(sanitizeReInviteScheme(scheme).dropped, [
    { event: VI_CONF_INFO_ADDED, id: "toString", reason: "missing_endpoint_entry" },
  ]);
});

// ─── Phase 3/7: connection wiring ───────────────────────────────────────────

function createConnectionDouble() {
  const subscribers = new Map<string, ((message: never) => void | Promise<void>)[]>();
  return {
    subscribers,
    subscribeMessage(name: "handleReInvite", subscriber: (message: never) => void | Promise<void>) {
      const current = subscribers.get(name) ?? [];
      subscribers.set(name, [...current, subscriber]);
    },
    unsubscribeMessage(
      name: "handleReInvite",
      subscriber: (message: never) => void | Promise<void>,
    ) {
      const current = subscribers.get(name) ?? [];
      subscribers.set(
        name,
        current.filter((entry) => entry !== subscriber),
      );
    },
    /** Mirrors ConnectionImpl.notifySubscribers: ordered, first subscriber runs first. */
    async notifySubscribers(name: string, message: unknown) {
      const current = subscribers.get(name);
      if (!current) return;
      await Promise.all(current.map(async (subscriber) => (subscriber as (m: unknown) => void)(message)));
    },
  };
}

test("sanitizer installed before the conference manager repairs the shared params object", async () => {
  const connection = createConnectionDouble();
  const dropped: string[] = [];

  const install = installVoxReInviteSchemeSanitizer({
    connection,
    onDropped: (causes) => dropped.push(...causes.map((cause) => cause.id)),
  });
  assert.equal(install.installed, true);

  // The conference manager subscribes after us, exactly as registerModules does.
  const harness = createShippedHandlerHarness();
  let handlerError: unknown = null;
  connection.subscribeMessage("handleReInvite", ((message: {
    payload: { params: unknown };
  }) => {
    try {
      harness.run(message.payload.params);
    } catch (error) {
      handlerError = error;
    }
  }) as never);

  await connection.notifySubscribers(
    "handleReInvite",
    reInviteMessage(REJOINING_PARTICIPANT_CALL_ID, participantRejoinScheme()),
  );

  assert.equal(handlerError, null);
  assert.deepEqual(dropped, [RECORDER_ENDPOINT_ID]);
  assert.deepEqual(
    [...harness.endpoints.keys()].sort(),
    [PARTICIPANT_ENDPOINT_ID, FACILITATOR_ENDPOINT_ID].sort(),
  );
  assert.equal(harness.queuedActions.length, 1);
});

test("repeated installation on the same connection is idempotent", () => {
  const connection = createConnectionDouble();
  const first = installVoxReInviteSchemeSanitizer({ connection });
  const second = installVoxReInviteSchemeSanitizer({ connection });

  assert.equal(first.installed, true);
  assert.equal(second.installed, false);
  assert.equal(second.reason, "already_installed");
  assert.equal(connection.subscribers.get("handleReInvite")?.length, 1);
});

test("uninstall removes the subscriber and allows a later reinstall", async () => {
  const connection = createConnectionDouble();
  const install = installVoxReInviteSchemeSanitizer({ connection });
  install.uninstall();
  assert.equal(connection.subscribers.get("handleReInvite")?.length, 0);

  const reinstalled = installVoxReInviteSchemeSanitizer({ connection });
  assert.equal(reinstalled.installed, true);

  // Teardown mid-flight: a message delivered after uninstall must not throw.
  reinstalled.uninstall();
  await connection.notifySubscribers(
    "handleReInvite",
    reInviteMessage(REJOINING_PARTICIPANT_CALL_ID, participantRejoinScheme()),
  );
});

test("installation degrades to a no-op when the connection seam is unavailable", () => {
  assert.deepEqual(
    { ...installVoxReInviteSchemeSanitizer({ connection: null }), uninstall: undefined },
    { installed: false, reason: "no_connection", uninstall: undefined },
  );
  assert.equal(
    installVoxReInviteSchemeSanitizer({ connection: {} as never }).installed,
    false,
  );
});

test("sanitizer tolerates malformed handleReInvite messages", async () => {
  const connection = createConnectionDouble();
  installVoxReInviteSchemeSanitizer({ connection });
  await connection.notifySubscribers("handleReInvite", {});
  await connection.notifySubscribers("handleReInvite", { payload: null });
  await connection.notifySubscribers("handleReInvite", { payload: { params: null } });
});

test("dropped-cause reporter emits once per event/reason pair", () => {
  const messages: string[] = [];
  const report = createDroppedCauseReporter((message) => messages.push(message));
  const dropped = [
    {
      event: VI_CONF_INFO_ADDED,
      id: RECORDER_ENDPOINT_ID,
      reason: "missing_endpoint_entry" as const,
    },
  ];

  report(dropped, REJOINING_PARTICIPANT_CALL_ID);
  report(dropped, REJOINING_PARTICIPANT_CALL_ID);

  assert.equal(messages.length, 1);
  assert.match(messages[0], /dropped unresolvable ReInvite cause/);
  assert.match(messages[0], new RegExp(RECORDER_ENDPOINT_ID));
});

// ─── Phase 5 control: install must precede conference module registration ───

test("every WebSDK init site installs the sanitizer before registerModules", () => {
  const sites = [
    "lib/voximplant/use-voximplant-room.ts",
    "components/event-lobby-voximplant-room.tsx",
    "components/voximplant-test-client.tsx",
  ];

  for (const site of sites) {
    const source = readFileSync(path.resolve(process.cwd(), site), "utf8");
    const installIndex = source.indexOf("installVoxReInviteSchemeSanitizer(");
    const registerIndex = source.indexOf("registerModules(");

    assert.notEqual(installIndex, -1, `${site} must install the ReInvite sanitizer`);
    assert.notEqual(registerIndex, -1, `${site} is expected to register SDK modules`);
    assert.ok(
      installIndex < registerIndex,
      `${site} must install the ReInvite sanitizer before registerModules so the ` +
        "sanitizer is the first handleReInvite subscriber",
    );
  }
});
