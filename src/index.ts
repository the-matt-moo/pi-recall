import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  appendAndFlush,
  formatTimestamp,
  loadRecords,
  loadSettings,
  makeSessionNamePrompt,
  normalizeSessionName,
  searchSessions,
  selectNameModel,
} from "./core.mjs";

export interface PromptRecord {
  version: number;
  timestamp: string;
  pid: number;
  sessionId: string;
  sessionFile: string | null;
  cwd: string;
  prompt: string;
  imageCount: number;
}

type AutoNameSettings = { autoName?: { enabled?: boolean; model?: string } };

function textFromContent(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join(" ");
}

export default function promptHistory(pi: ExtensionAPI) {
  let warned = false;
  let initialPrompt: string | undefined;
  let namingQueued = false;

  const autoName = async (prompt: string, ctx: ExtensionContext) => {
    const settings = loadSettings() as AutoNameSettings;
    if (settings.autoName?.enabled === false || pi.getSessionName()) return;

    const model = selectNameModel(ctx.scopedModels, ctx.model, settings.autoName?.model);
    if (!model) {
      if (settings.autoName?.model) {
        ctx.ui.notify("Auto-naming skipped: configured model is not session-scoped", "warning");
      }
      return;
    }

    try {
      const result = await ctx.modelRegistry.complete(
        model,
        { messages: [{ role: "user", content: makeSessionNamePrompt(prompt), timestamp: Date.now() }] },
        { reasoning: "off" },
      );
      if (pi.getSessionName()) return;
      const name = normalizeSessionName(textFromContent(result.content));
      if (name) pi.setSessionName(name);
    } catch {
      // Naming is best-effort and must never interrupt the session.
    }
  };

  pi.on("before_agent_start", (event, ctx) => {
    // Skip slash commands (/reload, /history, etc.)
    if (event.prompt.startsWith("/")) return;

    try {
      appendAndFlush({
        version: 1,
        timestamp: new Date().toISOString(),
        pid: process.pid,
        sessionId: ctx.sessionManager.getSessionId(),
        sessionFile: ctx.sessionManager.getSessionFile() ?? null,
        cwd: ctx.cwd,
        prompt: event.prompt,
        imageCount: event.images?.length ?? 0,
      });
    } catch (error) {
      if (!warned) {
        warned = true;
        ctx.ui.notify(`Prompt history write failed: ${String(error)}`, "warning");
      }
    }

    if (!initialPrompt && !pi.getSessionName()) initialPrompt = event.prompt;  // Only used for auto-naming user prompts
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (namingQueued || !initialPrompt || pi.getSessionName()) return;
    namingQueued = true;
    void autoName(initialPrompt, ctx);
  });

  const handleHistoryCommand = async (
    args: string,
    ctx: Parameters<Parameters<typeof pi.registerCommand>[1]["handler"]>[1],
  ) => {
    const records = loadRecords() as PromptRecord[];
    if (!records.length) {
      ctx.ui.notify("No prompt history recorded yet", "info");
      return;
    }

    const trimmed = args.trim();
    const recent = records.slice(-20).reverse();

    if (trimmed === "last") {
      const record = records.at(-1)!;
      ctx.ui.setEditorText(record.prompt);
      ctx.ui.notify("Loaded last prompt into editor", "info");
      return;
    }

    if (/^\d+$/.test(trimmed)) {
      const index = Number(trimmed);
      const record = recent[index - 1];
      if (!record) {
        ctx.ui.notify(`Prompt #${index} not found in recent history`, "warning");
        return;
      }
      ctx.ui.setEditorText(record.prompt);
      ctx.ui.notify(`Loaded prompt #${index} into editor`, "info");
      return;
    }

    if (trimmed.startsWith("send")) {
      const target = trimmed.replace(/^send\s*/, "");
      const record = target === "last" || !target ? records.at(-1) : recent[Number(target) - 1];
      if (!record) {
        ctx.ui.notify("Target prompt not found to send", "warning");
        return;
      }
      pi.sendUserMessage(record.prompt);
      return;
    }

    if (!ctx.hasUI) {
      const record = records.at(-1)!;
      ctx.ui.notify(`Last prompt: ${record.prompt}`, "info");
      return;
    }

    const options = recent.map((record, index) => {
      const preview = record.prompt.replace(/[\r\n\t]+/g, " ").trim().slice(0, 70);
      return `${index + 1}. [${formatTimestamp(record.timestamp)}] ${preview}`;
    });
    const choice = await ctx.ui.select("Select prompt from history:", options);
    const index = choice ? Number(choice.match(/^(\d+)\./)?.[1]) - 1 : -1;
    const record = recent[index];
    if (!record) return;

    ctx.ui.setEditorText(record.prompt);
    ctx.ui.notify(`Prompt #${index + 1} restored to editor - press Enter to run`, "info");
  };

  const handleSessionSearch = async (
    args: string,
    ctx: Parameters<Parameters<typeof pi.registerCommand>[1]["handler"]>[1],
  ) => {
    const query = args.trim() || (ctx.hasUI ? await ctx.ui.input("Search sessions:", "name, prompt, date, or keyword") : "");
    if (query === undefined) return;
    const sessions = searchSessions(query);
    if (!sessions.length) {
      ctx.ui.notify(`No sessions match: ${query || "all sessions"}`, "info");
      return;
    }
    if (!ctx.hasUI) {
      ctx.ui.notify(`${sessions.length} session(s) match: ${query || "all sessions"}`, "info");
      return;
    }

    const options = sessions.slice(0, 100).map((session: { name: string; firstPrompt: string; timestamp: string }, index: number) => {
      const title = session.name || session.firstPrompt || "Untitled session";
      return `${index + 1}. [${formatTimestamp(session.timestamp)}] ${title.replace(/[\r\n\t]+/g, " ").slice(0, 90)}`;
    });
    const choice = await ctx.ui.select("Select session:", options);
    const index = choice ? Number(choice.match(/^(\d+)\./)?.[1]) - 1 : -1;
    const session = sessions[index];
    if (!session) return;

    await ctx.switchSession(session.file, {
      withSession: async (nextCtx) => nextCtx.ui.notify("Switched session", "info"),
    });
  };

  pi.registerCommand("history", {
    description: "Browse or restore prompts from history (/history [last|N|send])",
    handler: handleHistoryCommand,
  });
  pi.registerCommand("prompt-history", { description: "Alias for /history", handler: handleHistoryCommand });
  pi.registerCommand("sessions", {
    description: "Search all stored sessions by name, prompt, date, or text",
    handler: handleSessionSearch,
  });
  pi.registerCommand("session-search", { description: "Alias for /sessions", handler: handleSessionSearch });
}
