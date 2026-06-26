#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  translate, TranslationRequestSchema, createProvider, createTranslationMemory,
  type TranslateDeps, type TranslationRequest,
} from "@yaku/core";

export interface ToolContent {
  content: Array<{ type: "text"; text: string }>;
}

/** Pure translate handler — testable without spinning up the MCP transport. */
export function makeTranslateHandler(deps: TranslateDeps) {
  return async (raw: unknown): Promise<ToolContent> => {
    const request: TranslationRequest = TranslationRequestSchema.parse(raw);
    const res = await translate(request, deps);
    return { content: [{ type: "text", text: JSON.stringify(res) }] };
  };
}

/** Pure tm_invalidate handler — testable without the MCP transport. */
export function makeInvalidateHandler(deps: TranslateDeps) {
  return async (args: { sourceLang?: string; targetLang?: string; namespace?: string }): Promise<ToolContent> => {
    await deps.tm.invalidate(args);
    return { content: [{ type: "text", text: "ok" }] };
  };
}

export function createMcpServer(deps: TranslateDeps): McpServer {
  const server = new McpServer({ name: "yaku", version: "0.1.0" });
  const handler = makeTranslateHandler(deps);
  const invalidateHandler = makeInvalidateHandler(deps);
  const optStr = TranslationRequestSchema.shape.sourceLang.optional();

  server.registerTool(
    "translate",
    {
      title: "Translate",
      description: "Agentic translation of a structured document into one or more target languages.",
      inputSchema: TranslationRequestSchema.shape,
    },
    async (args) => (await handler(args)) as ToolContent & { [x: string]: unknown }
  );

  server.registerTool(
    "tm_invalidate",
    {
      title: "Invalidate translation memory",
      description: "Remove TM entries matching a filter.",
      inputSchema: {
        sourceLang: optStr,
        targetLang: optStr,
        namespace: optStr,
      },
    },
    async (args) => (await invalidateHandler(args)) as ToolContent & { [x: string]: unknown }
  );

  return server;
}

// Run directly over stdio.
if (import.meta.url === `file://${process.argv[1]}`) {
  const deps: TranslateDeps = {
    provider: createProvider({ provider: process.env.YAKU_PROVIDER ?? "openai" }),
    tm: createTranslationMemory({ backend: "sqlite", path: process.env.YAKU_TM_PATH ?? "yaku-tm.sqlite" }),
  };
  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
