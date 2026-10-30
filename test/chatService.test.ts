import { beforeEach, expect, test } from "vitest";
import { ChatService } from "../src/chatService.js";
import { openDatabase } from "../src/database.js";

let chatService: ChatService;

beforeEach(() => {
  chatService = new ChatService(openDatabase(":memory:"));
});

test("unread messages exclude your own and are only returned once", () => {
  chatService.createRoom("sso", "", "alice");
  chatService.joinRoom("sso", "bob");

  chatService.postMessage("sso", "alice", "I take feature/oauth");
  chatService.postMessage("sso", "bob", "ok, I take feature/tokens");

  const unread = chatService.readUnread("alice", "");
  expect(unread.map((m) => m.body)).toEqual(["bob joined", "ok, I take feature/tokens"]);
  expect(chatService.readUnread("alice", "")).toEqual([]);
});

test("joining returns history and starts with nothing unread", () => {
  chatService.createRoom("sso", "", "alice");
  chatService.postMessage("sso", "alice", "hello");

  const history = chatService.joinRoom("sso", "bob");
  expect(history.map((m) => m.body)).toEqual(["alice created the room", "hello", "bob joined"]);
  expect(chatService.readUnread("bob", "sso")).toEqual([]);
});

test("join and leave show up as events for the others", () => {
  chatService.createRoom("sso", "", "alice");
  chatService.joinRoom("sso", "bob");
  chatService.leaveRoom("sso", "bob");

  const unread = chatService.readUnread("alice", "sso");
  expect(unread.map((m) => [m.kind, m.body])).toEqual([
    ["event", "bob joined"],
    ["event", "bob left"],
  ]);
});

test("after leaving you can't post or read", () => {
  chatService.createRoom("sso", "", "alice");
  chatService.leaveRoom("sso", "alice");

  expect(() => chatService.postMessage("sso", "alice", "hi")).toThrow(/isn't in room/);
  expect(() => chatService.readUnread("alice", "")).toThrow(/isn't in any rooms/);
});

test("rejoining doesn't replay what was posted while you were away", () => {
  chatService.createRoom("sso", "", "alice");
  chatService.joinRoom("sso", "bob");
  chatService.leaveRoom("sso", "bob");
  chatService.postMessage("sso", "alice", "while bob was away");

  const history = chatService.joinRoom("sso", "bob");
  expect(history.at(-1)?.body).toBe("bob joined");
  expect(chatService.readUnread("bob", "sso")).toEqual([]);
});

test("reading all rooms covers every room you're in, ordered by id", () => {
  chatService.createRoom("a", "", "alice");
  chatService.createRoom("b", "", "alice");
  chatService.joinRoom("a", "bob");
  chatService.joinRoom("b", "bob");
  chatService.readUnread("alice", "");

  chatService.postMessage("b", "bob", "first");
  chatService.postMessage("a", "bob", "second");

  expect(chatService.readUnread("alice", "").map((m) => m.body)).toEqual(["first", "second"]);
});

test("names and room names are validated", () => {
  expect(() => chatService.createRoom("Bad Name", "", "alice")).toThrow(/Room names/);
  expect(() => chatService.createRoom("ok", "", "has space")).toThrow(/Names use/);

  chatService.createRoom("ok", "", "alice");
  expect(() => chatService.createRoom("ok", "", "bob")).toThrow(/already exists/);
  expect(() => chatService.postMessage("ok", "alice", "   ")).toThrow(/empty/);
});

test("waiting returns as soon as someone else posts", async () => {
  chatService.createRoom("sso", "", "alice");
  chatService.joinRoom("sso", "bob");
  chatService.readUnread("alice", "");

  const waiting = chatService.waitForUnread("alice", "sso", 5000);
  chatService.postMessage("sso", "alice", "my own message doesn't wake me");
  setTimeout(() => chatService.postMessage("sso", "bob", "done with tokens"), 20);

  const messages = await waiting;
  expect(messages.map((m) => m.body)).toEqual(["done with tokens"]);
});

test("waiting returns nothing on timeout or abort", async () => {
  chatService.createRoom("sso", "", "alice");

  expect(await chatService.waitForUnread("alice", "sso", 20)).toEqual([]);

  const controller = new AbortController();
  const waiting = chatService.waitForUnread("alice", "sso", 5000, controller.signal);
  controller.abort();
  expect(await waiting).toEqual([]);
});

test("a room is archived once it's empty and has been quiet for 10 minutes", () => {
  chatService.createRoom("sso", "", "alice");
  const minutes = (n: number): number => Date.now() + n * 60 * 1000;

  // Still has a member
  expect(chatService.listRooms(minutes(11))[0].archived).toBe(false);

  chatService.leaveRoom("sso", "alice");
  expect(chatService.listRooms(minutes(9))[0].archived).toBe(false);
  expect(chatService.listRooms(minutes(11))[0].archived).toBe(true);

  // Joining brings it back
  chatService.joinRoom("sso", "bob");
  expect(chatService.listRooms(minutes(11))[0].archived).toBe(false);
});
