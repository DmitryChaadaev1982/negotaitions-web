import { connect as netConnect } from "node:net";
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type Server,
} from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Local reverse proxy that reproduces the committed production nginx contract.
 *
 * Source of truth:
 *   - `deploy/nginx/trusted-client-ip-snippet.conf`
 *   - `docs/audits/stage-3-13c-proxy-readiness/nginx-header-flow.md`
 *
 * The production vhost sets `Host $host`, so the host Next receives is exactly
 * the host the browser sent, and the target snippet overwrites
 * `X-Forwarded-Host $host`, `X-Forwarded-Proto $scheme`, `X-Real-IP`,
 * `X-Forwarded-For`, and `X-NegotAItions-Client-IP` from `$remote_addr`.
 * Browser-supplied values for those headers are discarded, never appended.
 *
 * Documented difference from production: the local listener is plain HTTP, so a
 * faithful `$scheme` is `http` rather than `https`. `forwardedProtoOverride`
 * exists so a test can assert the production `https` relationship explicitly,
 * and `forwardedHostOverride` exists only for the negative mismatch test.
 */
export type ProductionProxyOptions = {
  /** Origin of the running Next server, e.g. `http://127.0.0.1:3100`. */
  upstreamOrigin: string;
  /** Overrides `X-Forwarded-Proto`; defaults to the incoming scheme. */
  forwardedProtoOverride?: string;
  /**
   * Overrides `X-Forwarded-Host`. Production nginx always uses `$host`, so this
   * is only used to build an intentionally mismatched forwarded host.
   */
  forwardedHostOverride?: string;
  /** Overrides the dedicated client-IP header; defaults to the peer address. */
  clientIpOverride?: string;
};

export type ProductionProxy = {
  origin: string;
  port: number;
  /** Sanitized record of what the proxy forwarded, for assertions. */
  forwarded: ForwardedRecord[];
  close: () => Promise<void>;
};

/**
 * Deliberately bounded and PII-free: method, path, the host/origin relationship
 * and the upstream status only. No cookies, tokens, headers beyond the proxy
 * contract, and no request or response bodies are ever retained.
 */
export type ForwardedRecord = {
  method: string;
  path: string;
  browserHost: string | null;
  browserOrigin: string | null;
  forwardedHost: string;
  forwardedProto: string;
  clientIp: string;
  status: number | null;
};

/** Headers nginx overwrites; a browser-supplied copy must never survive. */
const OVERWRITTEN_HEADERS = new Set([
  "host",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-for",
  "x-real-ip",
  "x-negotaitions-client-ip",
]);

/**
 * Hop-by-hop headers must not be relayed. Re-emitting `transfer-encoding` in
 * particular double-frames a streamed Next response and stalls the browser.
 */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function withoutHopByHop(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP_HEADERS.has(name)) continue;
    result[name] = value;
  }
  return result;
}

function normalizeRemoteAddress(raw: string | undefined): string {
  if (!raw) return "127.0.0.1";
  // Node reports IPv4-mapped IPv6 for a dual-stack listener.
  return raw.startsWith("::ffff:") ? raw.slice("::ffff:".length) : raw;
}

export async function startProductionEquivalentProxy(
  options: ProductionProxyOptions,
): Promise<ProductionProxy> {
  const upstream = new URL(options.upstreamOrigin);
  const forwarded: ForwardedRecord[] = [];

  const server: Server = createServer((clientRequest, clientResponse) => {
    const browserHost = clientRequest.headers.host ?? null;
    const browserOrigin =
      typeof clientRequest.headers.origin === "string"
        ? clientRequest.headers.origin
        : null;
    const remoteAddress =
      options.clientIpOverride ??
      normalizeRemoteAddress(clientRequest.socket.remoteAddress ?? undefined);

    // `proxy_set_header Host $host`
    const forwardedHost = options.forwardedHostOverride ?? browserHost ?? "";
    // `proxy_set_header X-Forwarded-Proto $scheme`
    const forwardedProto = options.forwardedProtoOverride ?? "http";

    const outboundHeaders: IncomingHttpHeaders = {};
    for (const [name, value] of Object.entries(
      withoutHopByHop(clientRequest.headers),
    )) {
      if (OVERWRITTEN_HEADERS.has(name)) continue;
      outboundHeaders[name] = value;
    }
    outboundHeaders.host = forwardedHost;
    outboundHeaders["x-forwarded-host"] = forwardedHost;
    outboundHeaders["x-forwarded-proto"] = forwardedProto;
    outboundHeaders["x-forwarded-for"] = remoteAddress;
    outboundHeaders["x-real-ip"] = remoteAddress;
    outboundHeaders["x-negotaitions-client-ip"] = remoteAddress;

    const record: ForwardedRecord = {
      method: clientRequest.method ?? "GET",
      path: clientRequest.url ?? "/",
      browserHost,
      browserOrigin,
      forwardedHost,
      forwardedProto,
      clientIp: remoteAddress,
      status: null,
    };
    forwarded.push(record);

    const upstreamRequest = httpRequest(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port,
        method: clientRequest.method,
        path: clientRequest.url,
        headers: outboundHeaders,
      },
      (upstreamResponse) => {
        record.status = upstreamResponse.statusCode ?? null;
        clientResponse.writeHead(
          upstreamResponse.statusCode ?? 502,
          withoutHopByHop(upstreamResponse.headers),
        );
        upstreamResponse.pipe(clientResponse);
      },
    );

    upstreamRequest.on("error", () => {
      record.status = 502;
      if (!clientResponse.headersSent) clientResponse.writeHead(502);
      clientResponse.end();
    });
    clientRequest.pipe(upstreamRequest);
  });

  // The Next dev server serves hot-reload over a websocket. Relaying the
  // upgrade keeps the browser from retrying a stalled connection for the whole
  // test; production nginx relays it the same way.
  server.on("upgrade", (clientRequest, clientSocket, head) => {
    const upstreamSocket = netConnect(
      Number(upstream.port),
      upstream.hostname,
      () => {
        const headerLines = Object.entries(clientRequest.headers)
          .flatMap(([name, value]) =>
            value === undefined
              ? []
              : Array.isArray(value)
                ? value.map((item) => `${name}: ${item}`)
                : [`${name}: ${value}`],
          )
          .join("\r\n");
        upstreamSocket.write(
          `${clientRequest.method} ${clientRequest.url} HTTP/1.1\r\n${headerLines}\r\n\r\n`,
        );
        if (head?.length) upstreamSocket.write(head);
        upstreamSocket.pipe(clientSocket);
        clientSocket.pipe(upstreamSocket);
      },
    );
    const destroy = () => {
      upstreamSocket.destroy();
      clientSocket.destroy();
    };
    upstreamSocket.on("error", destroy);
    clientSocket.on("error", destroy);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    forwarded,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
