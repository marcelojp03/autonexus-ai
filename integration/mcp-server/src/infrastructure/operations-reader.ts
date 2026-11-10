import {
  OperationsReadError,
  parseToolInput,
  type ConsultationReader,
} from "../domain/consultation.js";
import { createHmac } from "node:crypto";

export const MAX_OWNER_BYTES = 512 * 1024;
export class AppointmentRequestOwnerError extends Error {
  constructor(
    readonly code:
      | "OWNER_UNAUTHORIZED"
      | "OWNER_FORBIDDEN"
      | "OWNER_NOT_FOUND"
      | "OWNER_INVALID_ARGUMENT"
      | "OWNER_CONFLICT"
      | "OWNER_UNAVAILABLE"
      | "OWNER_TIMEOUT"
      | "OWNER_INVALID_RESPONSE",
  ) {
    super(code);
    this.name = "AppointmentRequestOwnerError";
  }
}
export interface OperationsReaderOptions {
  baseUrl: string;
  tokenProvider: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
  clientAssertionSecret?: string;
}
export class OperationsReader implements ConsultationReader {
  private readonly base: URL;
  private readonly fetcher: typeof globalThis.fetch;
  constructor(private readonly options: OperationsReaderOptions) {
    this.base = new URL(options.baseUrl);
    if (
      !["http:", "https:"].includes(this.base.protocol) ||
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      this.base.pathname !== "/"
    ) {
      throw new Error("Invalid configured Operations base URL");
    }
    this.fetcher = options.fetch ?? globalThis.fetch;
  }
  async read(toolName: string, input: unknown): Promise<unknown> {
    const args = parseToolInput(toolName, input);
    let path: string;
    let keys: string[] = [];
    switch (toolName) {
      case "autonexus_list_orders":
        path = "/orders";
        keys = ["limit", "offset", "status"];
        break;
      case "autonexus_get_order":
        path = "/orders/" + encodeURIComponent(String(args["id"]));
        break;
      case "autonexus_list_my_agenda":
        path = "/agenda/me";
        keys = ["from", "to", "priority", "limit", "offset"];
        break;
      case "autonexus_list_team_agenda":
        path = "/agenda/team";
        keys = ["from", "to", "priority", "employeeId", "limit", "offset"];
        break;
      case "autonexus_get_my_execution":
        path =
          "/executions/me/" + encodeURIComponent(String(args["assignmentId"]));
        break;
      case "autonexus_get_team_execution":
        path =
          "/executions/team/" +
          encodeURIComponent(String(args["assignmentId"]));
        break;
      default:
        throw new OperationsReadError("OWNER_UNAVAILABLE");
    }
    const url = new URL(path, this.base);
    for (const key of keys)
      if (args[key] !== undefined) url.searchParams.set(key, String(args[key]));
    const signal = AbortSignal.timeout(5000);
    try {
      const token = await this.options.tokenProvider();
      if (
        !token ||
        token.includes(String.fromCharCode(13)) ||
        token.includes(String.fromCharCode(10))
      )
        throw new OperationsReadError("OWNER_UNAVAILABLE");
      const response = await this.fetcher(url, {
        method: "GET",
        redirect: "error",
        signal,
        headers: {
          accept: "application/json",
          authorization: "Bearer " + token,
        },
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401)
          throw new OperationsReadError("OWNER_UNAUTHORIZED", 401);
        if (response.status === 403)
          throw new OperationsReadError("OWNER_FORBIDDEN", 403);
        if (response.status === 404)
          throw new OperationsReadError("OWNER_NOT_FOUND", 404);
        throw new OperationsReadError("OWNER_UNAVAILABLE");
      }
      if (Number(response.headers.get("content-length")) > MAX_OWNER_BYTES) {
        await response.body?.cancel();
        throw new OperationsReadError("OWNER_RESPONSE_TOO_LARGE");
      }
      if (
        !response.headers
          .get("content-type")
          ?.toLowerCase()
          .includes("application/json") ||
        !response.body
      ) {
        await response.body?.cancel();
        throw new OperationsReadError("OWNER_INVALID_RESPONSE");
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > MAX_OWNER_BYTES) {
            await reader.cancel();
            throw new OperationsReadError("OWNER_RESPONSE_TOO_LARGE");
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      } catch {
        throw new OperationsReadError("OWNER_INVALID_RESPONSE");
      }
    } catch (error) {
      if (error instanceof OperationsReadError) throw error;
      throw new OperationsReadError(
        signal.aborted ? "OWNER_TIMEOUT" : "OWNER_UNAVAILABLE",
      );
    }
  }

  async createAppointmentRequest(
    input: {
      operationId: string;
      clientId: string;
      customerId: string;
      vehicleId: string;
      serviceId: string;
      startsAt: string;
      timeZone: string;
      notes?: string;
    },
    token: string,
    subject: string,
  ): Promise<unknown> {
    const secret = this.options.clientAssertionSecret;
    if (!secret) throw new AppointmentRequestOwnerError("OWNER_UNAVAILABLE");
    const assertion = createHmac("sha256", secret)
      .update(`${input.operationId}\n${input.clientId}\n${subject}`)
      .digest("hex");
    return this.appointmentRequestFetch(
      "/appointment-requests",
      token,
      {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "x-autonexus-mcp-assertion": assertion },
      },
      [201],
    );
  }

  async getAppointmentRequest(
    operationId: string,
    token: string,
    clientId: string,
    subject: string,
  ): Promise<unknown> {
    const secret = this.options.clientAssertionSecret;
    if (!secret) throw new AppointmentRequestOwnerError("OWNER_UNAVAILABLE");
    const assertion = createHmac("sha256", secret)
      .update(`${operationId}\n${clientId}\n${subject}`)
      .digest("hex");
    return this.appointmentRequestFetch(
      "/appointment-requests/operations/" + encodeURIComponent(operationId),
      token,
      {
        method: "GET",
        headers: {
          "x-autonexus-mcp-client": clientId,
          "x-autonexus-mcp-assertion": assertion,
        },
      },
      [200],
    );
  }

  private async appointmentRequestFetch(
    path: string,
    token: string,
    init: RequestInit,
    allowed: readonly number[],
  ): Promise<unknown> {
    const signal = AbortSignal.timeout(8000);
    try {
      const response = await this.fetcher(new URL(path, this.base), {
        ...init,
        redirect: "error",
        signal,
        headers: {
          accept: "application/json",
          ...(init.body ? { "content-type": "application/json" } : {}),
          authorization: "Bearer " + token,
          ...(init.headers ?? {}),
        },
      });
      if (!allowed.includes(response.status)) {
        await response.body?.cancel();
        if (response.status === 401)
          throw new AppointmentRequestOwnerError("OWNER_UNAUTHORIZED");
        if (response.status === 403)
          throw new AppointmentRequestOwnerError("OWNER_FORBIDDEN");
        if (response.status === 404)
          throw new AppointmentRequestOwnerError("OWNER_NOT_FOUND");
        if (response.status === 400)
          throw new AppointmentRequestOwnerError("OWNER_INVALID_ARGUMENT");
        if (response.status === 409)
          throw new AppointmentRequestOwnerError("OWNER_CONFLICT");
        throw new AppointmentRequestOwnerError("OWNER_UNAVAILABLE");
      }
      if (
        !response.headers
          .get("content-type")
          ?.toLowerCase()
          .includes("application/json")
      ) {
        await response.body?.cancel();
        throw new AppointmentRequestOwnerError("OWNER_INVALID_RESPONSE");
      }
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > 65536) {
        await response.body?.cancel();
        throw new OperationsReadError("OWNER_RESPONSE_TOO_LARGE");
      }
      return (await response.json()) as unknown;
    } catch (error) {
      if (error instanceof AppointmentRequestOwnerError) throw error;
      throw new AppointmentRequestOwnerError(
        signal.aborted ? "OWNER_TIMEOUT" : "OWNER_UNAVAILABLE",
      );
    }
  }
}
