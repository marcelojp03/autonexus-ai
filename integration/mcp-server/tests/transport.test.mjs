import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createConsultationApp } from "../dist/http-app.js";
import { AccessError } from "../dist/domain/access.js";

// Protocol/component checks with an official SDK client and controlled auth/owner doubles.
// This is not live Keycloak/Operations integration evidence.
const token = "unit.reader.signature";
const id = "11111111-1111-4111-8111-111111111111";
const order = {
  id,
  number: "WO-UNIT-1",
  status: "confirmed",
  priority: "normal",
  version: 1,
  createdAt: "2026-11-05T12:00:00Z",
  updatedAt: "2026-11-05T12:00:00Z",
  items: [],
  customerName: "PRIVATE_CUSTOMER",
  notes: "PRIVATE_NOTE",
  referenceRate: 999,
};
async function fixture(options = {}) {
  const state = {
    active: true,
    ownerStatus: 200,
    ownerCalls: [],
    audit: [],
    exchangeCalls: 0,
    requestRecord: null,
    requestCreates: 0,
    registryClients: [],
  };
  const config = {
    resourceUrl: "http://127.0.0.1:3006/mcp",
    issuerUrl: "http://127.0.0.1:4286/identity/realms/autonexus",
    operationsBaseUrl: "http://127.0.0.1:8081",
    host: "127.0.0.1",
    port: 3006,
    jwksUrl: "http://127.0.0.1:4286/certs",
    tokenEndpointUrl: "http://127.0.0.1:4286/token",
    clientRegistryFile: "/private/unit-registry",
    idpClientFile: "/private/unit-client",
    ...(options.ownerAssertionSecret
      ? { ownerAssertionSecret: options.ownerAssertionSecret }
      : {}),
    ...(options.adminApiToken ? { adminApiToken: options.adminApiToken } : {}),
  };
  const registry = options.registry ?? {
    list: async () => state.registryClients,
    create: async (value) => {
      if (
        state.registryClients.some((item) => item.clientId === value.clientId)
      )
        throw new Error("client_duplicate");
      state.registryClients.push(value);
    },
    update: async (value) => {
      state.registryClients = state.registryClients.map((item) =>
        item.clientId === value.clientId ? value : item,
      );
    },
    setEnabled: async (clientId, enabled) => {
      state.registryClients = state.registryClients.map((item) =>
        item.clientId === clientId ? { ...item, enabled } : item,
      );
    },
    revoke: async (clientId) => {
      state.registryClients = state.registryClients.filter(
        (item) => item.clientId !== clientId,
      );
    },
  };
  const app = createConsultationApp({
    config,
    requestsPerMinute: options.requestsPerMinute ?? 60,
    verify: async (value) => {
      if (value !== token) throw new AccessError("invalid_token");
      if (!state.active) throw new AccessError("client_forbidden");
      return {
        subject: "unit-employee",
        clientId: "unit-client",
        token: value,
        expiresAt: Math.floor(Date.now() / 1000) + 60,
        scopes: options.scopes ?? ["mcp", "mcp:orders:read"],
      };
    },
    exchange: {
      exchange: async () => {
        state.exchangeCalls++;
        return "exchanged-api-token";
      },
    },
    audit: {
      write: async (event) => {
        if (options.auditFails) throw new Error("PRIVATE_AUDIT_DETAIL");
        state.audit.push(event);
      },
    },
    registry,
    ownerFetch: async (url, init) => {
      state.ownerCalls.push({
        url: String(url),
        method: init.method,
        authorization: init.headers.authorization,
        assertion: init.headers["x-autonexus-mcp-assertion"],
        client: init.headers["x-autonexus-mcp-client"],
      });
      if (String(url).includes("/appointment-requests")) {
        if (options.appointmentTransportError)
          throw new TypeError("synthetic transport failure");
        if (init.method === "POST") {
          const input = JSON.parse(init.body);
          state.requestCreates++;
          state.requestRecord = {
            id: "22222222-2222-4222-8222-222222222222",
            operationId: input.operationId,
            clientId: input.clientId,
            requesterSubject: "unit-employee",
            customerId: input.customerId,
            vehicleId: input.vehicleId,
            serviceId: input.serviceId,
            requestedStartsAt: input.startsAt,
            timeZone: input.timeZone,
            notes: input.notes,
            status: "PENDING_REVIEW",
            createdAt: "2026-11-10T12:00:00Z",
            reviewedAt: null,
            reviewerSubject: null,
            reviewReason: null,
            appointmentId: null,
            version: 1,
          };
          return Response.json(
            {
              request: state.requestRecord,
              replayed: state.requestCreates > 1,
            },
            { status: 201 },
          );
        }
        return Response.json({ request: state.requestRecord, replayed: true });
      }
      if (state.ownerStatus !== 200)
        return Response.json(
          { message: "PRIVATE_OWNER_DETAIL" },
          { status: state.ownerStatus },
        );
      return Response.json({ items: [order], total: 1, limit: 20, offset: 0 });
    },
  });
  const listener = app.listen(0, "127.0.0.1");
  await new Promise((ok) => listener.once("listening", ok));
  const url = "http://127.0.0.1:" + listener.address().port;
  let client;
  return {
    state,
    url,
    async connect() {
      client = new Client({ name: "unit-external-client", version: "1.0.0" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(url + "/mcp"), {
          authProvider: { token: async () => token },
          requestInit: { redirect: "error" },
        }),
      );
      return client;
    },
    async close() {
      await client?.close();
      listener.closeAllConnections();
      await new Promise((ok) => listener.close(ok));
    },
  };
}
test("SDK client negotiates, sees only allowed tools and receives projected structured results", async () => {
  const f = await fixture();
  try {
    const client = await f.connect();
    const list = await client.listTools();
    assert.deepEqual(list.tools.map((t) => t.name).sort(), [
      "autonexus_get_order",
      "autonexus_list_orders",
    ]);
    for (const tool of list.tools) {
      assert.equal(tool.annotations.readOnlyHint, true);
      assert.equal(tool.outputSchema.type, "object");
    }
    const result = await client.callTool({
      name: "autonexus_list_orders",
      arguments: {},
    });
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.ok, true);
    assert.equal(result.structuredContent.data[0].number, "WO-UNIT-1");
    const text = JSON.stringify(result);
    for (const value of [
      "PRIVATE_CUSTOMER",
      "PRIVATE_NOTE",
      "referenceRate",
      "exchanged-api-token",
      token,
    ])
      assert.ok(!text.includes(value));
    assert.equal(f.state.ownerCalls.length, 1);
    assert.equal(f.state.ownerCalls[0].method, "GET");
    assert.equal(
      f.state.ownerCalls[0].authorization,
      "Bearer exchanged-api-token",
    );
    assert.deepEqual(
      f.state.audit.map((e) => e.outcome),
      ["REQUESTED", "OK"],
    );
  } finally {
    await f.close();
  }
});
test("owner denial is a tool error, not an empty successful page", async () => {
  const f = await fixture();
  try {
    f.state.ownerStatus = 403;
    const client = await f.connect();
    const result = await client.callTool({
      name: "autonexus_list_orders",
      arguments: {},
    });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.ok, false);
    assert.equal(result.structuredContent.error.status, 403);
    assert.ok(!JSON.stringify(result).includes("PRIVATE_OWNER_DETAIL"));
  } finally {
    await f.close();
  }
});
test("client suspension rejects the next invocation without contacting the owner", async () => {
  const f = await fixture();
  try {
    const client = await f.connect();
    await client.listTools();
    f.state.active = false;
    await assert.rejects(
      client.callTool({ name: "autonexus_list_orders", arguments: {} }),
    );
    assert.equal(f.state.ownerCalls.length, 0);
  } finally {
    await f.close();
  }
});
test("missing bearer gets resource metadata challenge and metadata remains public", async () => {
  const f = await fixture();
  try {
    const response = await fetch(f.url + "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 401);
    assert.ok(
      response.headers.get("www-authenticate").includes("resource_metadata="),
    );
    const metadata = await (
      await fetch(f.url + "/.well-known/oauth-protected-resource/mcp")
    ).json();
    assert.equal(metadata.resource, "http://127.0.0.1:3006/mcp");
    assert.ok(!JSON.stringify(metadata).includes("unit-client"));
    assert.equal(f.state.ownerCalls.length, 0);
  } finally {
    await f.close();
  }
});
test("known tool without its scope receives an OAuth 403 before any query", async () => {
  const f = await fixture();
  try {
    const response = await fetch(f.url + "/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "autonexus_list_team_agenda", arguments: {} },
      }),
    });
    assert.equal(response.status, 403);
    assert.ok(
      response.headers.get("www-authenticate").includes("mcp:agenda:read:team"),
    );
    assert.equal(f.state.ownerCalls.length, 0);
  } finally {
    await f.close();
  }
});
test("malicious origin, body excess and invalid arguments cannot reach the owner", async () => {
  const f = await fixture();
  try {
    let response = await fetch(f.url + "/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        origin: "https://evil.invalid",
        "content-type": "application/json",
      },
      body: "{}",
    });
    assert.equal(response.status, 403);
    response = await fetch(f.url + "/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({ x: "x".repeat(33000) }),
    });
    assert.equal(response.status, 413);
    const client = await f.connect();
    const result = await client.callTool({
      name: "autonexus_list_orders",
      arguments: { limit: 999, url: "https://evil.invalid" },
    });
    assert.equal(result.isError, true);
    assert.equal(f.state.ownerCalls.length, 0);
  } finally {
    await f.close();
  }
});
test("rate cap applies to authenticated requests including legacy GETs", async () => {
  const f = await fixture({ requestsPerMinute: 1 });
  try {
    let response = await fetch(f.url + "/mcp", {
      headers: { authorization: "Bearer " + token },
    });
    assert.notEqual(response.status, 429);
    response = await fetch(f.url + "/mcp", {
      headers: { authorization: "Bearer " + token },
    });
    assert.equal(response.status, 429);
    assert.equal(f.state.ownerCalls.length, 0);
  } finally {
    await f.close();
  }
});
test("audit failure never releases queried data or starts an owner read", async () => {
  const f = await fixture({ auditFails: true });
  try {
    const client = await f.connect();
    const result = await client.callTool({
      name: "autonexus_list_orders",
      arguments: {},
    });
    assert.equal(result.isError, true);
    assert.ok(!JSON.stringify(result).includes("PRIVATE_AUDIT_DETAIL"));
    assert.equal(f.state.ownerCalls.length, 0);
  } finally {
    await f.close();
  }
});

test("appointment tool only creates a pending request, signs client attribution and reconciles the same operation", async () => {
  const operationId = "33333333-3333-4333-8333-333333333333";
  const args = {
    operationId,
    customerId: id,
    vehicleId: "44444444-4444-4444-8444-444444444444",
    serviceId: "55555555-5555-4555-8555-555555555555",
    startsAt: "2026-11-12T09:00:00-04:00",
    timeZone: "America/La_Paz",
    notes: "Solicitud sintética no privada",
  };
  const f = await fixture({
    scopes: [
      "mcp",
      "mcp:appointments:request",
      "mcp:appointments:request:read",
    ],
    ownerAssertionSecret: "synthetic-internal-assertion-secret",
  });
  try {
    const client = await f.connect();
    const tools = await client.listTools();
    assert.ok(
      tools.tools.some((tool) => tool.name === "autonexus_request_appointment"),
    );
    const created = await client.callTool({
      name: "autonexus_request_appointment",
      arguments: args,
    });
    assert.equal(created.structuredContent.request.status, "PENDING_REVIEW");
    assert.equal(created.structuredContent.outcome, "RECORDED");
    assert.equal(f.state.ownerCalls[0].method, "POST");
    assert.equal(
      f.state.ownerCalls[0].authorization,
      "Bearer exchanged-api-token",
    );
    assert.match(f.state.ownerCalls[0].assertion, /^[a-f0-9]{64}$/);
    assert.equal(f.state.requestCreates, 1);
    const replay = await client.callTool({
      name: "autonexus_request_appointment",
      arguments: args,
    });
    assert.equal(replay.structuredContent.request.operationId, operationId);
    const reconciled = await client.callTool({
      name: "autonexus_get_appointment_request",
      arguments: { operationId },
    });
    assert.equal(reconciled.structuredContent.request.status, "PENDING_REVIEW");
    assert.equal(f.state.ownerCalls[2].client, "unit-client");
    assert.match(f.state.ownerCalls[2].assertion, /^[a-f0-9]{64}$/);
    assert.equal(f.state.requestCreates, 2);
    assert.ok(!JSON.stringify(f.state.audit).includes(args.notes));
  } finally {
    await f.close();
  }
});

test("appointment timeout is UNKNOWN and directs reconciliation rather than claiming rejection", async () => {
  const f = await fixture({
    scopes: ["mcp", "mcp:appointments:request"],
    ownerAssertionSecret: "synthetic-internal-assertion-secret",
    appointmentTransportError: true,
  });
  try {
    const client = await f.connect();
    const result = await client.callTool({
      name: "autonexus_request_appointment",
      arguments: {
        operationId: "33333333-3333-4333-8333-333333333333",
        customerId: id,
        vehicleId: "44444444-4444-4444-8444-444444444444",
        serviceId: "55555555-5555-4555-8555-555555555555",
        startsAt: "2026-11-12T09:00:00-04:00",
        timeZone: "America/La_Paz",
      },
    });
    assert.equal(result.structuredContent.outcome, "UNKNOWN");
    assert.match(result.structuredContent.message, /same operationId/);
  } finally {
    await f.close();
  }
});

test("appointment write tool is not advertised without the private owner assertion key", async () => {
  const f = await fixture({ scopes: ["mcp", "mcp:appointments:request"] });
  try {
    const client = await f.connect();
    const tools = await client.listTools();
    assert.ok(
      !tools.tools.some(
        (tool) => tool.name === "autonexus_request_appointment",
      ),
    );
  } finally {
    await f.close();
  }
});

test("CU31 admin API authenticates the private BFF token, rejects secret fields and audits only metadata", async () => {
  const f = await fixture({
    adminApiToken: "synthetic-private-admin-token-at-least-32-chars",
  });
  try {
    const base = {
      authorization: "Bearer synthetic-private-admin-token-at-least-32-chars",
      "x-admin-subject": "unit-admin",
      "content-type": "application/json",
    };
    let response = await fetch(f.url + "/admin/clients", {
      method: "POST",
      headers: { ...base },
      body: JSON.stringify({
        clientId: "chatgpt-app",
        displayName: "ChatGPT",
        enabled: true,
        scopes: ["mcp", "mcp:orders:read"],
      }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      clientId: "chatgpt-app",
      displayName: "ChatGPT",
      enabled: true,
      scopes: ["mcp", "mcp:orders:read"],
    });
    response = await fetch(f.url + "/admin/clients", {
      method: "POST",
      headers: { ...base },
      body: JSON.stringify({
        clientId: "bad-app",
        displayName: "Bad",
        enabled: true,
        scopes: ["mcp"],
        client_secret: "never-accept",
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(f.state.registryClients.length, 1);
    response = await fetch(f.url + "/admin/clients", {
      headers: { authorization: "Bearer wrong" },
    });
    assert.equal(response.status, 403);
    assert.equal(f.state.audit.at(-1).targetClientId, "chatgpt-app");
    assert.ok(!JSON.stringify(f.state.audit).includes("client_secret"));
  } finally {
    await f.close();
  }
});
