import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import {
  formatTimestamp,
  makeSessionNamePrompt,
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
  rmSync(root, { recursive: true, force: true });
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
  let pickerOptions;
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
      async select(_title, options) { pickerOptions = options; return options[0]; },
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
  mkdirSync(join(output, "prompt-history"));
  writeFileSync(join(output, "prompt-history", "settings.json"), JSON.stringify({ autoName: { model: "openrouter/title-model" } }));
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
    assert.equal(pickerOptions.length, 1);
    assert.equal(switchedSession, targetSession);
  } finally {
    if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = original;
    rmSync(output, { recursive: true, force: true });
  }
});
