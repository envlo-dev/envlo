/**
 * Lifecycle for zero-tunnel inbound transports (ticket #13).
 */
export type InboundTransport = {
  readonly kind: "imap" | "smtp" | "webhook" | "sandbox";
  start(): Promise<void>;
  stop(): Promise<void>;
};

export type InboundTransportHandle = {
  kind: InboundTransport["kind"];
  stop: () => Promise<void>;
};
