import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const NOT_RUNNING = "ce-git is not running. Start it with the Run Dev task (pnpm tauri dev).";
const NOT_PUBLISHED = "The window has not published a snapshot yet.";
const portFile = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "target", "ce-git-dev.json");

const server = new McpServer({
  name: "ce-git",
  version: "1.0.0",
});

server.registerTool(
  "app_status",
  {
    title: "App status",
    description:
      "Whether the ce-git debug window is running, its process id, and how old the latest snapshot is. If it is not running, start the Run Dev task (pnpm tauri dev).",
  },
  async () => {
    const loaded = await loadFeedback();
    if (!loaded.ok) {
      return fail(loaded.message);
    }
    return ok(statusOf(loaded));
  },
);

server.registerTool(
  "workspace",
  {
    title: "Workspace",
    description:
      "Roots, selection, active repository, dialogs, changed file names, and the recent activity log from the running ce-git window.",
  },
  async () => {
    const loaded = await loadFeedback();
    if (!loaded.ok) {
      return fail(loaded.message);
    }
    if (!loaded.body.workspace) {
      return fail(NOT_PUBLISHED);
    }
    return ok(loaded.body.workspace);
  },
);

server.registerTool(
  "ui_tree",
  {
    title: "UI tree",
    description:
      "Visible elements in the ce-git window that have an id, with tag, role, trimmed text, and disabled state.",
    inputSchema: {
      idPrefix: z
        .string()
        .optional()
        .describe("Only include elements whose id starts with this string."),
    },
  },
  async ({ idPrefix }) => {
    const loaded = await loadFeedback();
    if (!loaded.ok) {
      return fail(loaded.message);
    }
    const ui = Array.isArray(loaded.body.ui) ? loaded.body.ui : [];
    const prefix = idPrefix ?? "";
    const nodes = prefix ? ui.filter((node) => typeof node?.id === "string" && node.id.startsWith(prefix)) : ui;
    return ok({ count: nodes.length, nodes });
  },
);

server.registerTool(
  "console",
  {
    title: "Console",
    description: "Recent console warnings, console errors, and unhandled exceptions from the ce-git window.",
  },
  async () => {
    const loaded = await loadFeedback();
    if (!loaded.ok) {
      return fail(loaded.message);
    }
    return ok(Array.isArray(loaded.body.console) ? loaded.body.console : []);
  },
);

async function loadFeedback() {
  const endpoint = await readEndpoint();
  if (!endpoint) {
    return { ok: false, message: NOT_RUNNING };
  }
  try {
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/feedback`, {
      headers: { Authorization: `Bearer ${endpoint.token}` },
      signal: AbortSignal.timeout(2000),
    });
    if (response.status === 401) {
      return {
        ok: false,
        message: "ce-git rejected the dev feedback token. Restart the Run Dev task (pnpm tauri dev).",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        message: `ce-git dev bridge returned HTTP ${response.status}. Restart the Run Dev task (pnpm tauri dev).`,
      };
    }
    const body = await response.json();
    if (!body || typeof body !== "object") {
      return { ok: false, message: NOT_PUBLISHED };
    }
    return { ok: true, body, pid: endpoint.pid };
  } catch {
    return { ok: false, message: NOT_RUNNING };
  }
}

async function readEndpoint() {
  let raw;
  try {
    raw = await readFile(portFile, "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed.port !== "number" || !Number.isInteger(parsed.port) || typeof parsed.token !== "string") {
    return null;
  }
  if (parsed.port < 1 || parsed.port > 65535 || parsed.token.length === 0) {
    return null;
  }
  return {
    port: parsed.port,
    token: parsed.token,
    pid: typeof parsed.pid === "number" ? parsed.pid : null,
  };
}

function statusOf(loaded) {
  const updatedAt = typeof loaded.body.updatedAt === "string" ? loaded.body.updatedAt : null;
  const parsed = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const ready = loaded.body.ready === true && loaded.body.workspace != null;
  const status = {
    running: true,
    pid: loaded.pid,
    title: typeof loaded.body.title === "string" ? loaded.body.title : null,
    ready,
    updatedAt,
    snapshotAgeMs: Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : null,
  };
  if (!ready) {
    status.message = NOT_PUBLISHED;
  }
  return status;
}

function ok(value) {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  };
}

function fail(message) {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);
