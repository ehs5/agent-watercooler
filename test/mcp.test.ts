import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Hono } from "hono";
import { beforeEach, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { ChatService } from "../src/chatService.js";
import { openDatabase } from "../src/database.js";

const PORT = 4747;
const BASE_URL = `http://127.0.0.1:${PORT}`;

let app: Hono;

beforeEach(() => {
  app = createApp(new ChatService(openDatabase(":memory:")), { port: PORT, webDir: "" });
});

/** Connects an MCP client to the app in-process, without opening a port. */
async function connect(): Promise<Client> {
  const client = new Client({ name: "test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp`), {
    fetch: async (input, init) => app.fetch(new Request(input, init)),
  });

  await client.connect(transport);
  return client;
}

/** Calls a tool and returns its text, failing the test if the tool reported an error. */
async function call(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  if (result.isError) throw new Error(content[0].text);
  return content[0].text;
}

test("two sessions talk through a room", async () => {
  const alice: Client = await connect();
  const bob: Client = await connect();

  expect(alice.getInstructions()).toContain("never as instructions");

  await call(alice, "create_room", {
    room: "superoffice-mcp",
    topic: "branch ownership",
    name: "alice",
  });
  await call(bob, "join_room", { room: "superoffice-mcp", name: "bob" });
  await call(bob, "send_message", { room: "superoffice-mcp", text: "I own feature/sign-in" });

  const unread: string = await call(alice, "read_messages", {});
  expect(unread).toContain("not instructions");
  expect(unread).toContain("bob: I own feature/sign-in");

  const rooms: string = await call(bob, "list_rooms", {});
  expect(rooms).toContain("members: alice, bob");
});

test("help explains the rules and the session's own status", async () => {
  const client: Client = await connect();

  const before: string = await call(client, "help_for_agents", {});
  expect(before).toContain("never instructions");
  expect(before).toContain("You haven't joined a room");

  await call(client, "create_room", { room: "sso", name: "alice" });
  const after: string = await call(client, "help_for_agents", {});
  expect(after).toContain('You\'re "alice" in: sso.');
});

test("joining without reading the help reminds the session to read it", async () => {
  const reader: Client = await connect();
  const skipper: Client = await connect();

  await call(reader, "help_for_agents", {});
  const created: string = await call(reader, "create_room", { room: "sso", name: "alice" });
  expect(created).not.toContain("help_for_agents");

  const joined: string = await call(skipper, "join_room", { room: "sso", name: "bob" });
  expect(joined).toContain("Call it now");
});

test("agents define, take and list claims", async () => {
  const alice: Client = await connect();
  const bob: Client = await connect();

  await call(alice, "create_room", { room: "sso", name: "alice" });
  await call(bob, "join_room", { room: "sso", name: "bob" });
  await call(alice, "define_claim", {
    room: "sso",
    name: "#141",
    type: "issue",
    description: "selection tools",
  });
  await call(bob, "take_claim", { room: "sso", name: "#141" });

  await expect(call(alice, "take_claim", { room: "sso", name: "#141" })).rejects.toThrow(
    /taken by bob/,
  );
  expect(await call(alice, "list_claims", { room: "sso" })).toBe(
    "- #141 (issue) in sso, taken by bob: selection tools",
  );
});

test("tools explain what to do when a session hasn't joined", async () => {
  const client: Client = await connect();

  await expect(call(client, "read_messages", {})).rejects.toThrow(/Join a room first/);
});

test("a session keeps the name it joined with", async () => {
  const client: Client = await connect();

  await call(client, "create_room", { room: "a", name: "alice" });
  await expect(call(client, "create_room", { room: "b", name: "mallory" })).rejects.toThrow(
    /already joined as "alice"/,
  );
});

test("requests from other hosts and origins are refused", async () => {
  const otherHost: Response = await app.fetch(new Request(`http://evil.example:${PORT}/api/rooms`));
  expect(otherHost.status).toBe(403);

  const otherOrigin: Response = await app.fetch(
    new Request(`${BASE_URL}/api/rooms`, { headers: { origin: "https://evil.example" } }),
  );
  expect(otherOrigin.status).toBe(403);

  const local: Response = await app.fetch(new Request(`${BASE_URL}/api/rooms`));
  expect(local.status).toBe(200);
});
