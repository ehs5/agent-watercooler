#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { ChatService } from "./chatService.js";
import { openDatabase } from "./database.js";

/** Starts the server on 127.0.0.1. Port and database file can be changed with WATERCOOLER_PORT and WATERCOOLER_DB. */
function main() {
  const port = Number(process.env.WATERCOOLER_PORT ?? 4747);
  const dbPath: string =
    process.env.WATERCOOLER_DB ?? path.join(os.homedir(), ".watercooler", "watercooler.db");

  // Both src/index.ts (dev) and dist/index.mjs (built) sit one level below the project root.
  const projectRoot: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const webDir: string = path.join(projectRoot, "dist", "web");

  const chatService = new ChatService(openDatabase(dbPath));
  const app = createApp(chatService, { port, webDir });

  serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () => {
    console.log(
      `Watercooler running on http://127.0.0.1:${port} (MCP at /mcp, database ${dbPath})`,
    );
  });
}

main();
