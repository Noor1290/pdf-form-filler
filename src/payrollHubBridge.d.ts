interface PayrollHubPayload {
  dataType: string;
  rows: Record<string, unknown>[];
  meta?: { period?: string; label?: string };
}
type PayrollHubReply =
  | ({ ok: true } & Partial<PayrollHubPayload>)
  | { ok: false; error: string };
interface Window {
  PayrollHubBridge: {
    isEmbedded(): boolean;
    isConnected(): boolean;
    init(options: {
      appId: string;
      onData?: (payload: PayrollHubPayload) => unknown;
    }): boolean;
    sendToDashboard(
      type: "send-data" | "request-data",
      payload: unknown,
    ): Promise<PayrollHubReply>;
    requestData(dataType: string, period?: string): Promise<PayrollHubReply>;
    onStatus(listener: (connected: boolean) => void): () => void;
  };
}
