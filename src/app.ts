import { serveStatic } from "@hono/node-server/serve-static";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { streamSSE } from "hono/streaming";
import type { SSEStreamingApi } from "hono/streaming";
import type { ChatService, Message } from "./chatService.js";
import { createMcpServer } from "./mcpServer.js";

export type AppConfig = {
  port: number;
  webDir: string;
};

const KEEP_ALIVE_MS = 15_000;

/** Builds the HTTP app: the MCP endpoint, the read-only API the frontend uses, and the frontend itself. */
export function createApp(chatService: ChatService, config: AppConfig): Hono {
  const app = new Hono();
  const allowedHosts: string[] = [`127.0.0.1:${config.port}`, `localhost:${config.port}`];
  const allowedOrigins: string[] = allowedHosts.map((host) => `http://${host}`);
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

  /** Rejects requests whose Host or Origin isn't this server, so web pages can't reach it through DNS rebinding or cross-site requests. */
  async function localOnly(c: Context, next: Next) {
    const host: string = new URL(c.req.url).host;
    if (!allowedHosts.includes(host)) return c.text("Forbidden host", 403);

    const origin: string = c.req.header("origin") ?? "";
    if (origin && !allowedOrigins.includes(origin)) return c.text("Forbidden origin", 403);

    await next();
  }

  /** Routes a request to its session's transport, or starts a new session for an initialize request. */
  async function handleMcp(c: Context) {
    const sessionId: string = c.req.header("mcp-session-id") ?? "";

    if (sessionId) {
      const transport = transports.get(sessionId);
      // A 404 tells the client to start a new session, e.g. after this server restarted.
      if (!transport)
        return c.json(
          { jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null },
          404,
        );
      return transport.handleRequest(c.req.raw);
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport);
      },
      onsessionclosed: (id) => {
        transports.delete(id);
      },
    });

    await createMcpServer(chatService).connect(transport);
    return transport.handleRequest(c.req.raw);
  }

  /** Streams new messages as server-sent events, optionally for one room. */
  function handleStream(c: Context) {
    const room: string = c.req.query("room") ?? "";

    return streamSSE(c, async (stream: SSEStreamingApi) => {
      function send(message: Message) {
        if (room && message.room !== room) return;
        void stream.writeSSE({
          event: "message",
          id: String(message.id),
          data: JSON.stringify(message),
        });
      }

      const stopListening = chatService.onMessage(send);
      stream.onAbort(stopListening);

      while (!stream.aborted) {
        await stream.sleep(KEEP_ALIVE_MS);
        await stream.write(": keep-alive\n\n");
      }
    });
  }

  app.use(localOnly);

  app.all("/mcp", handleMcp);

  app.get("/api/rooms", (c) => c.json(chatService.listRooms()));
  app.get("/api/rooms/:room", (c) => c.json(chatService.getRoom(c.req.param("room"))));
  app.get("/api/rooms/:room/messages", (c) => {
    const afterId = Number(c.req.query("after") ?? 0);
    return c.json(chatService.getMessages(c.req.param("room"), afterId));
  });
  app.get("/api/stream", handleStream);

  app.get("/api/claims", (c) => c.json(chatService.listClaims(c.req.query("room") ?? "")));

  app.onError((error, c) => c.json({ error: error.message }, 400));

  app.use(serveStatic({ root: config.webDir }));
  app.get("*", serveStatic({ root: config.webDir, path: "index.html" }));

  return app;
}
