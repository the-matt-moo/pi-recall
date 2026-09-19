import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendAndFlush, formatTimestamp, loadRecords } from "./core.mjs";

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

export default function promptHistory(pi: ExtensionAPI) {
  let warned = false;

  pi.on("before_agent_start", (event, ctx) => {
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

    const cols =
      typeof process.stdout.columns === "number" && process.stdout.columns > 0
        ? process.stdout.columns
        : 80;
    const maxLineLen = Math.max(20, cols - 8);

    const options = recent.map((r, i) => {
      const time = formatTimestamp(r.timestamp);
      const prefix = `${i + 1}. [${time}] `;
      const clean = r.prompt.replace(/[\r\n\t]+/g, " ").trim();
      const available = Math.max(8, maxLineLen - prefix.length);
      const preview =
        clean.length > available ? `${clean.slice(0, Math.max(0, available - 3))}...` : clean;
      return `${prefix}${preview}`;
    });

    const choice = await ctx.ui.select("Select prompt from history:", options);
    if (!choice) return;

    const match = choice.match(/^(\d+)\./);
    const selectedIndex = match ? Number(match[1]) - 1 : -1;
    const selectedRecord = recent[selectedIndex];
    if (!selectedRecord) return;

    ctx.ui.setEditorText(selectedRecord.prompt);
    ctx.ui.notify(`Prompt #${selectedIndex + 1} restored to editor - press Enter to run`, "info");
  };

  pi.registerCommand("history", {
    description: "Browse or restore prompts from history (/history [last|N|send])",
    handler: handleHistoryCommand,
  });

  pi.registerCommand("prompt-history", {
    description: "Alias for /history",
    handler: handleHistoryCommand,
  });
}
