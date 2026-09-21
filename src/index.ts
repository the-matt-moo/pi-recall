import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  appendAndFlush,
  deletePromptRecord,
  deleteSession,
  formatTimestamp,
  getArchiveDir,
  getSessionsForPrune,
  loadRecords,
  loadSettings,
  makeSessionNamePrompt,
  normalizeSessionName,
  pruneSessions,
  searchSessions,
  selectNameModel,
  getPromptMetadataKey,
  loadSessionMetadata,
  updatePromptMetadata,
  updateSessionMetadata,
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

type HistorySettings = {
  prompts?: { minimumWords?: number };
  sessions?: {
    autoName?: { enabled?: boolean; model?: string };
    retention?: { archiveDir?: string; ignorePinned?: boolean; ignoreNamed?: boolean };
  };
};
type SessionSummary = ReturnType<typeof searchSessions>[number];
type PickerResult = { type: "session"; file: string } | { type: "prompt"; prompt: string };
type SessionDone = (result: PickerResult | null) => void;

const ANSI_ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

function displayWidth(text: string) {
  return [...text.replace(ANSI_ESCAPE, "")].length;
}

function clipText(text: string, width: number) {
  return [...text].slice(0, width).join("");
}

function clipStyledText(text: string, width: number) {
  let result = "";
  let visible = 0;
  let index = 0;
  while (index < text.length && visible < width) {
    if (text[index] === "\x1b") {
      const escape = text.slice(index).match(/^\x1b\[[0-?]*[ -/]*[@-~]/)?.[0];
      if (escape) {
        result += escape;
        index += escape.length;
        continue;
      }
    }
    const character = [...text.slice(index)][0]!;
    result += character;
    index += character.length;
    visible++;
  }
  return result + (index < text.length ? "\x1b[0m" : "");
}

function isSubagentPrompt(prompt: string) {
  return /parent conversation context/i.test(prompt) && /parent session that spawned you/i.test(prompt);
}

function isSubagentOpeningPrompt(session: SessionSummary) {
  return isSubagentPrompt(session.firstPrompt ?? "");
}

function minPromptWords() {
  const value = Number((loadSettings() as HistorySettings).prompts?.minimumWords);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 3;
}

function hasEnoughWords(prompt: string) {
  return prompt.trim().split(/\s+/).filter(Boolean).length >= minPromptWords();
}

function textFromContent(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join(" ");
}

class SessionPicker {
  private tab: "all" | "pinned" | "opening";
  private sort: "date" | "alpha" = "date";
  private searchMode = false;
  private searchQuery = "";
  private selected = 0;
  private confirmDelete = false;
  private deleteError = "";

  constructor(
    private readonly sessions: SessionSummary[],
    private readonly filter: string,
    initialTab: "all" | "pinned" | "opening",
    private readonly theme: Theme,
    private readonly keybindings: any,
    private readonly tui: any,
    private readonly done: SessionDone,
  ) {
    this.tab = initialTab;
  }

  private visibleItems() {
    const items = this.tab === "opening"
      ? this.sessions.filter((session) => !isSubagentOpeningPrompt(session) && hasEnoughWords(session.firstPrompt ?? ""))
      : this.tab === "pinned"
        ? this.sessions.filter((session) => session.pinned)
        : this.sessions;
    const filtered = this.searchQuery
      ? items.filter((session) => (session.name || session.firstPrompt || "").toLocaleLowerCase().includes(this.searchQuery.toLocaleLowerCase()))
      : items;
    return [...filtered].sort((a, b) => this.sort === "date"
      ? Date.parse(b.timestamp) - Date.parse(a.timestamp)
      : (a.name || a.firstPrompt || "").localeCompare(b.name || b.firstPrompt || ""));
  }

  private move(delta: number) {
    const count = this.visibleItems().length;
    if (!count) return;
    this.selected = (this.selected + delta + count) % count;
    this.tui.requestRender();
  }

  private togglePin() {
    const session = this.visibleItems()[this.selected] as SessionSummary | undefined;
    if (!session) return;
    session.pinned = !session.pinned;
    updateSessionMetadata(session.file, { pinned: session.pinned });
    if (this.tab === "pinned" && !session.pinned) this.selected = Math.min(this.selected, Math.max(0, this.visibleItems().length - 1));
    this.tui.requestRender();
  }

  private deleteSelected() {
    const session = this.visibleItems()[this.selected];
    if (!session) return;
    try {
      deleteSession(session.file);
      this.sessions.splice(this.sessions.indexOf(session), 1);
      this.selected = Math.min(this.selected, Math.max(0, this.visibleItems().length - 1));
      this.deleteError = "";
    } catch (error) {
      this.deleteError = `Delete failed: ${String(error)}`;
    }
    this.confirmDelete = false;
    this.tui.requestRender();
  }

  private switchTab() {
    this.tab = this.tab === "all" ? "pinned" : this.tab === "pinned" ? "opening" : "all";
    this.selected = 0;
    this.tui.requestRender();
  }

  private switchSort() {
    this.sort = this.sort === "date" ? "alpha" : "date";
    this.selected = 0;
    this.tui.requestRender();
  }

  private handleSearchInput(data: string) {
    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.searchMode = false;
      this.searchQuery = "";
    } else if (this.keybindings.matches(data, "tui.select.confirm")) {
      this.searchMode = false;
    } else if (this.keybindings.matches(data, "tui.input.backspace") || data === "\x7f" || data === "\b") {
      this.searchQuery = this.searchQuery.slice(0, -1);
    } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.searchQuery += data;
    } else {
      return;
    }
    this.selected = 0;
    this.tui.requestRender();
  }

  render(width: number) {
    const items = this.visibleItems();
    const boxWidth = Math.max(40, Math.min(width, 150));
    const innerWidth = boxWidth - 2;
    const contentWidth = innerWidth - 2;
    const maxRows = 18;
    const start = Math.max(0, Math.min(this.selected - Math.floor(maxRows / 2), Math.max(0, items.length - maxRows)));
    const pad = (text: string) => `${text}${" ".repeat(Math.max(0, contentWidth - displayWidth(text)))}`;
    const row = (text: string) => {
      const clipped = clipStyledText(text, contentWidth);
      return `${this.theme.fg("border", "│")} ${pad(clipped)} ${this.theme.fg("border", "│")}`;
    };
    const rows = items.slice(start, start + maxRows).map((item, index) => {
      const isOpeningPrompt = this.tab === "opening";
      const title = isOpeningPrompt
        ? ((item as SessionSummary).firstPrompt || (item as SessionSummary).name || "Untitled session")
        : ((item as SessionSummary).name || (item as SessionSummary).firstPrompt || "Untitled session");
      const tags = (item as SessionSummary).tags?.length ? ` {${(item as SessionSummary).tags!.join(", ")}}` : "";
      const marker = (item as SessionSummary).pinned ? "[PIN] " : "      ";
      const line = `${marker}[${formatTimestamp(item.timestamp)}] ${title.replace(/[\r\n\t]+/g, " ")}${tags}`;
      const selected = start + index === this.selected;
      return row(`${selected ? this.theme.fg("accent", "❯ ") : "  "}${selected ? this.theme.fg("accent", line) : line}`);
    });
    const renderedRows = Array.from({ length: maxRows }, (_, index) => rows[index] ?? row(""));
    const tab = (name: string, active: boolean) => active
      ? this.theme.fg("accent", this.theme.bold(`[${name}]`))
      : this.theme.fg("dim", `[${name}]`);
    const range = items.length ? `${this.selected + 1}/${items.length}` : "0/0";
    const top = this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`);
    const bottom = this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`);
    return [
      top,
      row(`${this.theme.fg("accent", this.theme.bold("Sessions"))} · ${this.theme.fg("warning", this.tab.toUpperCase())} · ${this.theme.fg("dim", range)} · ${this.theme.fg("accent", "Sort:")} ${this.sort === "date" ? "Date (newest)" : "Alphabetical"}`),
      ...(this.filter ? [row(`${this.theme.fg("accent", "Session name filter:")} ${this.filter}`)] : []),
      row(`${this.theme.fg("accent", this.theme.bold("Search:"))} ${this.searchQuery || this.theme.fg("dim", "press / to filter")}${this.searchMode ? "▏" : ""}`),
      row(`${tab("All Sessions", this.tab === "all")}  ${tab("Pinned Sessions", this.tab === "pinned")}  ${tab("Session by Opening Prompt", this.tab === "opening")}`),
      row(this.confirmDelete
        ? this.theme.fg("error", "Delete is permanent. Are you sure you want to proceed? [y/n]")
        : this.deleteError
          ? this.theme.fg("error", this.deleteError)
          : `${this.theme.fg("accent", this.theme.bold("Tab"))}: ${this.theme.fg("dim", "switch")} · ${this.theme.fg("accent", this.theme.bold("s"))}: ${this.theme.fg("dim", "sort")} · ${this.theme.fg("accent", this.theme.bold("Space"))}: ${this.theme.fg("dim", "pin/unpin")} · ${this.theme.fg("error", this.theme.bold("d"))}: ${this.theme.fg("dim", "delete")} · ${this.theme.fg("accent", this.theme.bold("Enter"))}: ${this.theme.fg("dim", "open")} · ${this.theme.fg("accent", this.theme.bold("Esc"))}: ${this.theme.fg("dim", "close")}`),
      ...(items.length ? renderedRows : Array.from({ length: maxRows }, (_, index) => row(index === 0 ? (this.tab === "pinned" ? "No pinned sessions." : "No sessions.") : ""))),
      bottom,
    ];
  }

  handleInput(data: string) {
    if (this.confirmDelete) {
      if (data === "y" || data === "Y") this.deleteSelected();
      else if (data === "n" || data === "N" || this.keybindings.matches(data, "tui.select.cancel")) {
        this.confirmDelete = false;
        this.tui.requestRender();
      }
      return;
    }
    if (this.searchMode) {
      this.handleSearchInput(data);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.cancel")) return this.done(null);
    if (this.keybindings.matches(data, "tui.select.confirm")) {
      const item = this.visibleItems()[this.selected];
      if (!item) return;
      return this.done({ type: "session", file: (item as SessionSummary).file });
    }
    if (this.keybindings.matches(data, "tui.input.tab") || data === "\t") return this.switchTab();
    if (data === "/") {
      this.searchMode = true;
      return this.tui.requestRender();
    }
    if (data === "s" || data === "S") return this.switchSort();
    if (data === " ") return this.togglePin();
    if ((data === "d" || data === "D") && this.visibleItems()[this.selected]) {
      this.confirmDelete = true;
      this.deleteError = "";
      return this.tui.requestRender();
    }
    if (this.keybindings.matches(data, "tui.select.up")) return this.move(-1);
    if (this.keybindings.matches(data, "tui.select.down")) return this.move(1);
    if (this.keybindings.matches(data, "tui.select.pageUp")) return this.move(-12);
    if (this.keybindings.matches(data, "tui.select.pageDown")) return this.move(12);
  }

  invalidate() {}
  dispose() {}
}

type PromptItem = PromptRecord & { pinned?: boolean };

class PromptPicker {
  private tab: "all" | "pinned" = "all";
  private sort: "date" | "alpha" = "date";
  private searchMode = false;
  private searchQuery = "";
  private selected = 0;
  private confirmDelete = false;
  private deleteError = "";

  constructor(
    private readonly prompts: PromptItem[],
    private readonly filter: string,
    private readonly theme: Theme,
    private readonly keybindings: any,
    private readonly tui: any,
    private readonly done: SessionDone,
  ) {}

  private visiblePrompts() {
    const prompts = this.tab === "pinned" ? this.prompts.filter((prompt) => prompt.pinned) : this.prompts;
    const filtered = this.searchQuery
      ? prompts.filter((prompt) => prompt.prompt.toLocaleLowerCase().includes(this.searchQuery.toLocaleLowerCase()))
      : prompts;
    return [...filtered].sort((a, b) => this.sort === "date"
      ? Date.parse(b.timestamp) - Date.parse(a.timestamp)
      : a.prompt.localeCompare(b.prompt));
  }

  private move(delta: number) {
    const prompts = this.visiblePrompts();
    if (!prompts.length) return;
    this.selected = (this.selected + delta + prompts.length) % prompts.length;
    this.tui.requestRender();
  }

  private switchTab() {
    this.tab = this.tab === "all" ? "pinned" : "all";
    this.selected = 0;
    this.tui.requestRender();
  }

  private switchSort() {
    this.sort = this.sort === "date" ? "alpha" : "date";
    this.selected = 0;
    this.tui.requestRender();
  }

  private handleSearchInput(data: string) {
    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.searchMode = false;
      this.searchQuery = "";
    } else if (this.keybindings.matches(data, "tui.select.confirm")) {
      this.searchMode = false;
    } else if (this.keybindings.matches(data, "tui.input.backspace") || data === "\x7f" || data === "\b") {
      this.searchQuery = this.searchQuery.slice(0, -1);
    } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.searchQuery += data;
    } else {
      return;
    }
    this.selected = 0;
    this.tui.requestRender();
  }

  private togglePin() {
    const prompts = this.visiblePrompts();
    const prompt = prompts[this.selected];
    if (!prompt) return;
    prompt.pinned = !prompt.pinned;
    updatePromptMetadata(prompt, { pinned: prompt.pinned });
    if (this.tab === "pinned" && !prompt.pinned) this.selected = Math.min(this.selected, Math.max(0, prompts.length - 2));
    this.tui.requestRender();
  }

  private deleteSelected() {
    const prompt = this.visiblePrompts()[this.selected];
    if (!prompt) return;
    try {
      deletePromptRecord(prompt);
      this.prompts.splice(this.prompts.indexOf(prompt), 1);
      this.selected = Math.min(this.selected, Math.max(0, this.visiblePrompts().length - 1));
      this.deleteError = "";
    } catch (error) {
      this.deleteError = `Delete failed: ${String(error)}`;
    }
    this.confirmDelete = false;
    this.tui.requestRender();
  }

  render(width: number) {
    const boxWidth = Math.max(40, Math.min(width, 150));
    const innerWidth = boxWidth - 2;
    const contentWidth = innerWidth - 2;
    const maxRows = 18;
    const prompts = this.visiblePrompts();
    const start = Math.max(0, Math.min(this.selected - Math.floor(maxRows / 2), Math.max(0, prompts.length - maxRows)));
    const pad = (text: string) => `${text}${" ".repeat(Math.max(0, contentWidth - displayWidth(text)))}`;
    const row = (text: string) => {
      const clipped = clipStyledText(text, contentWidth);
      return `${this.theme.fg("border", "│")} ${pad(clipped)} ${this.theme.fg("border", "│")}`;
    };
    const rows = prompts.slice(start, start + maxRows).map((prompt, index) => {
      const line = `${prompt.pinned ? "[PIN] " : "      "}${prompt.prompt.replace(/[\r\n\t]+/g, " ")}`;
      const selected = start + index === this.selected;
      return row(`${selected ? this.theme.fg("accent", "❯ ") : "  "}${selected ? this.theme.fg("accent", line) : line}`);
    });
    const renderedRows = Array.from({ length: maxRows }, (_, index) => rows[index] ?? row(""));
    const range = prompts.length ? `${this.selected + 1}/${prompts.length}` : "0/0";
    const top = this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`);
    const bottom = this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`);
    return [
      top,
      row(`${this.theme.fg("accent", this.theme.bold("Prompts"))} · ${this.theme.fg("dim", range)} · ${this.theme.fg("accent", "Sort:")} ${this.sort === "date" ? "Date (newest)" : "Alphabetical"}`),
      row(`${this.theme.fg("accent", this.tab === "all" ? "[All Prompts]" : " All Prompts ")}  ${this.theme.fg("accent", this.tab === "pinned" ? "[Pinned Prompts]" : " Pinned Prompts ")}`),
      ...(this.filter ? [row(`${this.theme.fg("accent", "Prompt filter:")} ${this.filter}`)] : []),
      row(`${this.theme.fg("accent", this.theme.bold("Search:"))} ${this.searchQuery || this.theme.fg("dim", "press / to filter")}${this.searchMode ? "▏" : ""}`),
      row(this.confirmDelete
        ? this.theme.fg("error", "Delete is permanent. Are you sure you want to proceed? [y/n]")
        : this.deleteError
          ? this.theme.fg("error", this.deleteError)
          : `${this.theme.fg("accent", this.theme.bold("Tab"))}: ${this.theme.fg("dim", "switch")} · ${this.theme.fg("accent", this.theme.bold("s"))}: ${this.theme.fg("dim", "sort")} · ${this.theme.fg("accent", this.theme.bold("Space"))}: ${this.theme.fg("dim", "pin/unpin")} · ${this.theme.fg("error", this.theme.bold("d"))}: ${this.theme.fg("dim", "delete")} · ${this.theme.fg("accent", this.theme.bold("Enter"))}: ${this.theme.fg("dim", "restore")} · ${this.theme.fg("accent", this.theme.bold("Esc"))}: ${this.theme.fg("dim", "close")}`),
      ...(prompts.length ? renderedRows : Array.from({ length: maxRows }, (_, index) => row(index === 0 ? "No prompts." : ""))),
      bottom,
    ];
  }

  handleInput(data: string) {
    if (this.confirmDelete) {
      if (data === "y" || data === "Y") this.deleteSelected();
      else if (data === "n" || data === "N" || this.keybindings.matches(data, "tui.select.cancel")) {
        this.confirmDelete = false;
        this.tui.requestRender();
      }
      return;
    }
    if (this.searchMode) {
      this.handleSearchInput(data);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.cancel")) return this.done(null);
    if (this.keybindings.matches(data, "tui.select.confirm")) {
      const prompt = this.visiblePrompts()[this.selected];
      if (prompt) return this.done({ type: "prompt", prompt: prompt.prompt });
      return;
    }
    if (this.keybindings.matches(data, "tui.input.tab") || data === "\t") return this.switchTab();
    if (data === "/") {
      this.searchMode = true;
      return this.tui.requestRender();
    }
    if (data === "s" || data === "S") return this.switchSort();
    if (data === " ") return this.togglePin();
    if ((data === "d" || data === "D") && this.visiblePrompts()[this.selected]) {
      this.confirmDelete = true;
      this.deleteError = "";
      return this.tui.requestRender();
    }
    if (this.keybindings.matches(data, "tui.select.up")) return this.move(-1);
    if (this.keybindings.matches(data, "tui.select.down")) return this.move(1);
    if (this.keybindings.matches(data, "tui.select.pageUp")) return this.move(-12);
    if (this.keybindings.matches(data, "tui.select.pageDown")) return this.move(12);
  }

  invalidate() {}
  dispose() {}
}

export default function promptHistory(pi: ExtensionAPI) {
  let warned = false;
  let initialPrompt: string | undefined;
  let namingQueued = false;

  const autoName = async (prompt: string, ctx: ExtensionContext) => {
    const settings = (loadSettings() as HistorySettings).sessions;
    if (settings?.autoName?.enabled === false || pi.getSessionName()) return;

    const model = selectNameModel(ctx.scopedModels, ctx.model, settings?.autoName?.model);
    if (!model) {
      if (settings?.autoName?.model) {
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
    // Skip slash commands (/reload, /sessions, etc.)
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

  const updateCurrentSession = (ctx: Parameters<Parameters<typeof pi.registerCommand>[1]["handler"]>[1], changes: Record<string, unknown>) => {
    const file = ctx.sessionManager.getSessionFile();
    if (!file) {
      ctx.ui.notify("This session has no file yet", "warning");
      return undefined;
    }
    return updateSessionMetadata(file, changes);
  };

  const handleSessionSearch = async (
    args: string,
    ctx: Parameters<Parameters<typeof pi.registerCommand>[1]["handler"]>[1],
  ) => {
    const requested = args.trim();
    const lastOnly = requested === "--last";
    const pinnedOnly = requested === "pinned" || requested === "--pinned";
    const query = pinnedOnly || lastOnly ? "" : requested;
    const sessions = searchSessions(query, undefined, "name")
      .filter((s) => !s.firstPrompt?.startsWith("/"))
      .filter((s) => !isSubagentOpeningPrompt(s))
      .filter((s) => !pinnedOnly || s.pinned);
    if (!sessions.length) {
      ctx.ui.notify(`No sessions match: ${query || "all sessions"}`, "info");
      return;
    }
    if (lastOnly) {
      const session = sessions
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
        .find((s) => s.file !== ctx.sessionManager.getSessionFile());
      if (!session) {
        ctx.ui.notify("No previous session found", "info");
        return;
      }
      await ctx.switchSession(session.file, {
        withSession: async (nextCtx) => nextCtx.ui.notify("Switched session", "info"),
      });
      return;
    }
    if (!ctx.hasUI) {
      ctx.ui.notify(`${sessions.length} session(s) match: ${query || "all"}`, "info");
      return;
    }

    const result = await ctx.ui.custom<PickerResult | null>(
      (tui, theme, keybindings, done) => new SessionPicker(sessions, query.trim().replace(/\s+/g, " "), pinnedOnly ? "pinned" : "all", theme, keybindings, tui, done),
      { overlay: true, overlayOptions: { width: "90%", maxHeight: "85%", anchor: "center" } },
    );
    if (!result || result.type !== "session") return;
    await ctx.switchSession(result.file, {
      withSession: async (nextCtx) => nextCtx.ui.notify("Switched session", "info"),
    });
  };

  const handlePromptSearch = async (
    args: string,
    ctx: Parameters<Parameters<typeof pi.registerCommand>[1]["handler"]>[1],
  ) => {
    const query = args.trim();
    const records = loadRecords() as PromptRecord[];
    if (query === "--last") {
      const record = records.filter((r) => !r.prompt.startsWith("/") && !isSubagentPrompt(r.prompt) && hasEnoughWords(r.prompt)).at(-1);
      if (!record) {
        ctx.ui.notify("No prompt history recorded yet", "info");
        return;
      }
      ctx.ui.setEditorText(record.prompt);
      ctx.ui.notify("Loaded last prompt into editor", "info");
      return;
    }
    const normalized = query.toLocaleLowerCase().trim().replace(/\s+/g, " ");
    const metadata = loadSessionMetadata();
    const uniquePrompts = new Map<string, PromptItem>();
    for (const record of records) {
      if (record.prompt.startsWith("/") || isSubagentPrompt(record.prompt) || !hasEnoughWords(record.prompt)) continue;
      const prompt = { ...record, ...(metadata[getPromptMetadataKey(record)] ?? {}) } as PromptItem;
      if (normalized && !prompt.prompt.toLocaleLowerCase().replace(/\s+/g, " ").includes(normalized)) continue;
      const existing = uniquePrompts.get(prompt.prompt);
      if (!existing || (!existing.pinned && prompt.pinned)) uniquePrompts.set(prompt.prompt, prompt);
    }
    const prompts = [...uniquePrompts.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.timestamp) - Date.parse(a.timestamp));
    if (!prompts.length) {
      ctx.ui.notify(`No prompts match: ${query || "all prompts"}`, "info");
      return;
    }
    if (!ctx.hasUI) {
      ctx.ui.notify(`${prompts.length} prompt(s) match: ${query || "all prompts"}`, "info");
      return;
    }

    const result = await ctx.ui.custom<PickerResult | null>(
      (tui, theme, keybindings, done) => new PromptPicker(prompts, query.trim().replace(/\s+/g, " "), theme, keybindings, tui, done),
      { overlay: true, overlayOptions: { width: "90%", maxHeight: "85%", anchor: "center" } },
    );
    if (result?.type === "prompt") {
      ctx.ui.setEditorText(result.prompt);
      ctx.ui.notify("Prompt restored to editor - press Enter to run", "info");
    }
  };

  pi.registerCommand("prompts", {
    description: "Browse or restore prompt history (/prompts [query|--last])",
    handler: handlePromptSearch,
  });
  pi.registerCommand("session-pin", {
    description: "Toggle the current session pin (/session-pin)",
    handler: async (_args, ctx) => {
      const current = searchSessions().find((session) => session.file === ctx.sessionManager.getSessionFile());
      const next = !current?.pinned;
      if (updateCurrentSession(ctx, { pinned: next })) ctx.ui.notify(next ? "Session pinned" : "Session unpinned", "info");
    },
  });
  pi.registerCommand("session-tag", {
    description: "Toggle a tag on the current session (/session-tag <tag>)",
    handler: async (args, ctx) => {
      const tag = args.trim();
      if (!tag || /\s/.test(tag)) {
        ctx.ui.notify("Usage: /session-tag <single-word-tag>", "warning");
        return;
      }
      const current = searchSessions().find((session) => session.file === ctx.sessionManager.getSessionFile());
      const tags = new Set(current?.tags ?? []);
      tags.has(tag) ? tags.delete(tag) : tags.add(tag);
      if (updateCurrentSession(ctx, { tags: [...tags].sort() })) {
        ctx.ui.notify(`${tags.has(tag) ? "Added" : "Removed"} tag: ${tag}`, "info");
      }
    },
  });
  pi.registerCommand("sessions", {
    description: "Search stored sessions or open the previous one (/sessions [query|pinned|--last])",
    handler: handleSessionSearch,
  });
  pi.registerCommand("session-prune", {
    description: "Archive stale sessions older than N days (default 90) (/session-prune [days])",
    handler: async (args, ctx) => {
      const days = Number(args.trim()) || 90;
      const settings = (loadSettings() as HistorySettings).sessions?.retention ?? {};
      const candidates = getSessionsForPrune({
        maxAgeDays: days,
        ignorePinned: settings.ignorePinned ?? true,
        ignoreNamed: settings.ignoreNamed ?? false,
      });

      if (!candidates.length) {
        ctx.ui.notify(`No sessions older than ${days} days found to prune.`, "info");
        return;
      }

      if (ctx.hasUI) {
        const confirmed = await ctx.ui.confirm(
          `Archive ${candidates.length} session(s) older than ${days} days?`,
          `They will be moved to ${settings.archiveDir || getArchiveDir()}`,
        );
        if (!confirmed) {
          ctx.ui.notify("Prune cancelled.", "info");
          return;
        }
      }

      const result = pruneSessions({
        maxAgeDays: days,
        ignorePinned: settings.ignorePinned ?? true,
        ignoreNamed: settings.ignoreNamed ?? false,
        archiveDir: settings.archiveDir || getArchiveDir(),
      });
      ctx.ui.notify(`Archived ${result.archived.length} session(s) to ${result.archiveDir}`, "info");
    },
  });
}
