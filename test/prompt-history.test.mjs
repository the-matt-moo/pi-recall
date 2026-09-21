import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import {
  appendAndFlush,
  formatTimestamp,
  getSessionsForPrune,
  loadRecords,
  makeSessionNamePrompt,
  pruneSessions,
  updatePromptMetadata,
  updateSessionMetadata,
  normalizeSessionName,
  searchSessions,
  selectNameModel,
} from "../src/core.mjs";

test("formatTimestamp produces readable date with CT", () => {
  const formatted = formatTimestamp("2026-09-19T15:00:00.000Z");
  assert.match(formatted, /^\d{2}-\d{2}-\d{4},? \d{2}:\d{2} CT$/);
});

test("session search matches title, first prompt, timestamp, and full text", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-history-sessions-"));
  const directory = join(root, "--project--");
  mkdirSync(directory);
  writeFileSync(join(directory, "session.jsonl"), [
    JSON.stringify({ type: "session", timestamp: "2026-09-19T15:00:00.000Z" }),
    JSON.stringify({ type: "message", message: { role: "user", content: "First prompt: fix login" } }),
    JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Investigating OAuth refresh failure" }] } }),
    JSON.stringify({ type: "session_info", name: "Auth repair" }),
  ].join("\n"));

  for (const query of ["auth", "login", "19-09-2026", "OAuth refresh"]) {
    assert.equal(searchSessions(query, root).length, 1, `expected match for ${query}`);
  }
  assert.equal(searchSessions("unrelated", root).length, 0);
  assert.equal(searchSessions("login OAuth", root).length, 0);
  rmSync(root, { recursive: true, force: true });
});

test("pinned sessions sort first and tags are searchable", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-history-metadata-"));
  const directory = join(root, "--project--");
  mkdirSync(directory);
  const first = join(directory, "first.jsonl");
  const second = join(directory, "second.jsonl");
  const writeSession = (file, timestamp, prompt) => writeFileSync(file, [
    JSON.stringify({ type: "session", timestamp }),
    JSON.stringify({ type: "message", message: { role: "user", content: prompt } }),
  ].join("\\n"));
  writeSession(first, "2026-09-19T15:00:00.000Z", "Older session");
  writeSession(second, "2026-09-19T16:00:00.000Z", "Newer session");
  const original = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    updateSessionMetadata(first, { pinned: true, tags: ["release"] });
    const sessions = searchSessions("release", root);
    assert.equal(sessions[0].file, first);
    assert.equal(sessions[0].pinned, true);
  } finally {
    if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = original;
    rmSync(root, { recursive: true, force: true });
  }
});

test("configured auto-name model must be scoped; otherwise use the active session model", () => {
  const active = { provider: "openrouter", id: "active" };
  const scoped = [{ model: { provider: "openrouter", id: "title-model" } }];
  assert.deepEqual(selectNameModel(scoped, active, "openrouter/title-model"), scoped[0].model);
  assert.equal(selectNameModel(scoped, active, "openrouter/not-scoped"), undefined);
  assert.equal(selectNameModel(scoped, active, undefined), active);
  assert.match(makeSessionNamePrompt("Refactor the session picker"), /Refactor the session picker/);
  assert.equal(normalizeSessionName('Title: "Refactor Session Picker"'), "Refactor Session Picker");
});

test("auto-naming runs after the first settled turn with the configured scoped model", async () => {
  const output = mkdtempSync(join(tmpdir(), "pi-history-build-"));
  execFileSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "src/index.ts", "--outDir", output, "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--skipLibCheck"], { cwd: resolve("."), stdio: "pipe" });
  cpSync(resolve("src/core.mjs"), join(output, "core.mjs"));
  const { default: extension } = await import(`${pathToFileURL(join(output, "index.js")).href}?${Date.now()}`);

  const handlers = new Map();
  const commands = new Map();
  let name;
  let calledModel;
  let switchedSession;
  let customPicker;
  const pi = {
    on(event, handler) { handlers.set(event, handler); },
    registerCommand(command, definition) { commands.set(command, definition); },
    registerShortcut() {},
    getSessionName() { return name; },
    setSessionName(value) { name = value; },
    sendUserMessage() {},
  };
  extension(pi);

  const configured = { provider: "openrouter", id: "title-model" };
  const ctx = {
    cwd: process.cwd(),
    hasUI: true,
    model: { provider: "openrouter", id: "active-model" },
    scopedModels: [{ model: configured }],
    sessionManager: { getSessionId: () => "test", getSessionFile: () => null },
    ui: {
      notify() {},
      setEditorText() {},
      async input() { return "inventory"; },
      async select() { return undefined; },
      async custom(factory) {
        customPicker = factory({ requestRender() {} }, {}, { matches() { return false; } }, () => {});
        return { type: "session", file: targetSession };
      },
    },
    async switchSession(file, { withSession }) {
      switchedSession = file;
      await withSession({ ui: { notify() {} } });
      return { cancelled: false };
    },
    modelRegistry: {
      async complete(model) {
        calledModel = model;
        return { content: [{ type: "text", text: "Refactor Session Search" }] };
      },
    },
  };

  const original = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = output;
  mkdirSync(join(output, "session-history"));
  writeFileSync(join(output, "session-history", "settings.json"), JSON.stringify({ sessions: { autoName: { model: "openrouter/title-model" } } }));
  mkdirSync(join(output, "sessions", "--project--"), { recursive: true });
  const targetSession = join(output, "sessions", "--project--", "target.jsonl");
  writeFileSync(targetSession, [
    JSON.stringify({ type: "session", timestamp: "2026-09-19T15:00:00.000Z" }),
    JSON.stringify({ type: "message", message: { role: "user", content: "Find inventory records" } }),
    JSON.stringify({ type: "session_info", name: "Inventory lookup" }),
  ].join("\n"));
  try {
    await handlers.get("before_agent_start")({ prompt: "Add session search", images: [] }, ctx);
    await handlers.get("agent_settled")({}, ctx);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(calledModel, configured);
    assert.equal(name, "Refactor Session Search");
    await commands.get("sessions").handler("", ctx);
    assert.ok(customPicker);
    assert.equal(switchedSession, targetSession);
  } finally {
    if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = original;
    rmSync(output, { recursive: true, force: true });
  }
});

test("rollover preserves pinned prompts into the new active file", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-history-rollover-"));
  const original = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    const record1 = {
      version: 1,
      timestamp: "2026-09-19T10:00:00.000Z",
      pid: 1001,
      sessionId: "session-1",
      sessionFile: "file1.jsonl",
      cwd: root,
      prompt: "pinned prompt 1",
      imageCount: 0,
    };
    const record2 = {
      version: 1,
      timestamp: "2026-09-19T11:00:00.000Z",
      pid: 1002,
      sessionId: "session-2",
      sessionFile: "file2.jsonl",
      cwd: root,
      prompt: "normal prompt 2",
      imageCount: 0,
    };
    appendAndFlush(record1);
    updatePromptMetadata(record1, { pinned: true });
    appendAndFlush(record2);

    // Artificially fill prompts.jsonl past MAX_BYTES (5 MiB) to trigger rollover
    const historyFile = join(root, "session-history", "prompts.jsonl");
    const bigPadding = "x".repeat(5 * 1024 * 1024 + 10);
    appendAndFlush({
      version: 1,
      timestamp: "2026-09-19T12:00:00.000Z",
      pid: 1003,
      prompt: bigPadding,
    });

    const triggerRecord = {
      version: 1,
      timestamp: "2026-09-19T13:00:00.000Z",
      pid: 1004,
      sessionId: "session-4",
      sessionFile: "file4.jsonl",
      cwd: root,
      prompt: "after rollover prompt",
      imageCount: 0,
    };
    appendAndFlush(triggerRecord);

    const records = loadRecords();
    const prompts = records.map((r) => r.prompt);
    assert.ok(prompts.includes("pinned prompt 1"), "pinned prompt must survive rollover");
    assert.ok(prompts.includes("after rollover prompt"), "new prompt must be present");
  } finally {
    if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = original;
    rmSync(root, { recursive: true, force: true });
  }
});

test("session pruning archives stale sessions and respects pinned immunity", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-history-prune-"));
  const sessionsDir = join(root, "sessions", "--test--");
  const archiveDir = join(root, "archive");
  mkdirSync(sessionsDir, { recursive: true });

  const oldStaleFile = join(sessionsDir, "old-stale.jsonl");
  const oldPinnedFile = join(sessionsDir, "old-pinned.jsonl");
  const newFile = join(sessionsDir, "new.jsonl");

  const writeTestSession = (file, timestamp) => {
    writeFileSync(file, [
      JSON.stringify({ type: "session", timestamp }),
      JSON.stringify({ type: "session_info", name: "Session " + timestamp }),
      JSON.stringify({ type: "message", message: { role: "user", content: "hello" } }),
    ].join("\n"));
  };

  const oldTime = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
  const newTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

  writeTestSession(oldStaleFile, oldTime);
  writeTestSession(oldPinnedFile, oldTime);
  writeTestSession(newFile, newTime);

  const original = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    updateSessionMetadata(oldPinnedFile, { pinned: true });

    // With ignoreNamed: false and ignorePinned: true
    const candidates = getSessionsForPrune({
      sessionDir: join(root, "sessions"),
      maxAgeDays: 90,
      ignorePinned: true,
      ignoreNamed: false,
    });

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].file, oldStaleFile);

    const pruneResult = pruneSessions({
      sessionDir: join(root, "sessions"),
      archiveDir,
      maxAgeDays: 90,
      ignorePinned: true,
      ignoreNamed: false,
    });

    assert.equal(pruneResult.archived.length, 1);
    assert.equal(pruneResult.archived[0].file, oldStaleFile);
    assert.ok(pruneResult.archived[0].dest.startsWith(archiveDir));
  } finally {
    if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = original;
    rmSync(root, { recursive: true, force: true });
  }
});
