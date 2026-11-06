// Unit tests for the Ollama transport. The HTTP endpoint is a controlled local double: no real
// model is contacted here (real-model observations are reported separately).
import {test, before, after} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {createOllamaClient, LlmError} from "../dist/llm/ollama.js";

let lastBody = null;
let requests = 0;
/** Handler set by each test: (response) => void, so every test owns its own scenario. */
let respond = response => {
  response.writeHead(200, {"content-type": "application/json"});
  response.end(JSON.stringify({message: {content: "ok"}}));
};

const server = createServer((request, response) => {
  let raw = "";
  request.on("data", chunk => { raw += chunk; });
  request.on("end", () => {
    requests += 1;
    lastBody = raw.length === 0 ? null : JSON.parse(raw);
    respond(response);
  });
});

let baseUrl;
before(async () => {
  await new Promise(ready => server.listen(0, "127.0.0.1", ready));
  baseUrl = "http://127.0.0.1:" + String(server.address().port);
});
after(async () => { await new Promise(ready => server.close(ready)); });

const ORDER_TOOL = {type: "function", function: {name: "autonexus_list_orders", description: "d",
  parameters: {type: "object", additionalProperties: false, properties: {}, required: []}}};

test("requests are non-streaming, model comes from config and num_predict stays bounded", async () => {
  respond = response => {
    response.writeHead(200, {"content-type": "application/json"});
    response.end(JSON.stringify({model: "qwen3.5:4b", eval_count: 7, message: {role: "assistant", content: "Hola", thinking: "th"}}));
  };
  const client = createOllamaClient({baseUrl, model: "qwen3.5:4b", numPredict: 100000});
  const result = await client.chat({messages: [{role: "user", content: "¿Cuántas órdenes hay?"}]});
  assert.equal(lastBody.stream, false);
  assert.equal(lastBody.model, "qwen3.5:4b");
  assert.equal(lastBody.tools, undefined);
  assert.ok(lastBody.options.num_predict <= 2048, String(lastBody.options.num_predict));
  assert.equal(lastBody.options.temperature, 0);
  assert.equal(result.content, "Hola");
  assert.equal(result.thinking, "th");
  assert.equal(result.evalCount, 7);
});

test("a JSON-string argument object is accepted and identifiers are preserved", async () => {
  respond = response => {
    response.writeHead(200, {"content-type": "application/json"});
    response.end(JSON.stringify({model: "qwen3.5:4b", message: {role: "assistant", content: "", tool_calls: [
      {id: "call_1", function: {index: 0, name: "autonexus_list_orders", arguments: "{\"limit\":7}"}}]}}));
  };
  const result = await createOllamaClient({baseUrl}).chat({messages: [{role: "user", content: "x"}], tools: [ORDER_TOOL]});
  assert.equal(lastBody.tools.length, 1, "only declared tools are sent to the model");
  assert.deepEqual(result.toolCalls, [{id: "call_1", name: "autonexus_list_orders", arguments: {limit: 7}}]);
  assert.equal(result.rawToolCalls.length, 1, "raw calls are preserved for echoing back");
});

test("a tool name outside the declared catalogue is rejected", async () => {
  respond = response => {
    response.writeHead(200, {"content-type": "application/json"});
    response.end(JSON.stringify({message: {content: "", tool_calls: [
      {id: "call_x", function: {index: 0, name: "autonexus_admin_grant_role", arguments: {}}}]}}));
  };
  await assert.rejects(
    () => createOllamaClient({baseUrl}).chat({messages: [{role: "user", content: "x"}], tools: [ORDER_TOOL]}),
    error => error instanceof LlmError && error.code === "TOOL_NOT_IN_CATALOGUE" &&
      error.message.includes("autonexus_admin_grant_role"));
});

test("an empty tool catalogue rejects every returned tool call", async () => {
  respond = response => {
    response.writeHead(200, {"content-type": "application/json"});
    response.end(JSON.stringify({message: {content: "", tool_calls: [
      {id: "call_y", function: {index: 0, name: "autonexus_list_orders", arguments: {}}}]}}));
  };
  await assert.rejects(() => createOllamaClient({baseUrl}).chat({messages: [{role: "user", content: "x"}]}),
    error => error.code === "TOOL_NOT_IN_CATALOGUE");
});

test("HTTP errors surface a code and a status without echoing the upstream body", async () => {
  respond = response => {
    response.writeHead(500, {"content-type": "application/json"});
    response.end(JSON.stringify({error: "SECRET_PROMPT_LEAK"}));
  };
  await assert.rejects(() => createOllamaClient({baseUrl}).chat({messages: [{role: "user", content: "secreto"}]}),
    error => error.code === "LLM_HTTP_ERROR" && error.status === 500 && !error.message.includes("SECRET_PROMPT_LEAK"));
});

test("a non-JSON body is reported as a bad response", async () => {
  respond = response => {
    response.writeHead(200, {"content-type": "text/plain"});
    response.end("<html>not json</html>");
  };
  await assert.rejects(() => createOllamaClient({baseUrl}).chat({messages: [{role: "user", content: "x"}]}),
    error => error.code === "LLM_BAD_RESPONSE");
});

test("the per-call timeout interrupts a slow model", async () => {
  respond = response => { setTimeout(() => {
    response.writeHead(200, {"content-type": "application/json"});
    response.end(JSON.stringify({message: {content: "tarde"}}));
  }, 1500); };
  const started = Date.now();
  await assert.rejects(() => createOllamaClient({baseUrl, callTimeoutMs: 250}).chat({messages: [{role: "user", content: "x"}]}),
    error => error.code === "LLM_TIMEOUT");
  assert.ok(Date.now() - started < 1400, "the call was cut before the model answered");
});

test("an elapsed conversation deadline is enforced without calling the model", async () => {
  respond = response => { response.writeHead(200, {"content-type": "application/json"}); response.end("{}"); };
  const before = requests;
  await assert.rejects(() => createOllamaClient({baseUrl, callTimeoutMs: 5000})
    .chat({messages: [{role: "user", content: "x"}], deadlineMs: Date.now() - 1}),
    error => error.code === "LLM_TIMEOUT");
  assert.equal(requests, before, "no request was issued after the deadline");
});

test("an unreachable endpoint is reported as unavailable", async () => {
  await assert.rejects(() => createOllamaClient({baseUrl: "http://127.0.0.1:9", callTimeoutMs: 800})
    .chat({messages: [{role: "user", content: "x"}]}), error => error.code === "LLM_UNAVAILABLE");
});
