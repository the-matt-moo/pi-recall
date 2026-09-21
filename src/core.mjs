import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const MAX_BYTES = 5 * 1024 * 1024;

export function getConfigDir() {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

export function getHistoryDir() {
  return join(getConfigDir(), "session-history");
}

export function getHistoryFile() {
  return join(getHistoryDir(), "prompts.jsonl");
}

export function getSettingsFile() {
  return join(getHistoryDir(), "settings.json");
}

export function getArchiveDir() {
  return join(getConfigDir(), "sessions-archive");
}

export function getSessionMetadataFile() {
  return join(getHistoryDir(), "session-metadata.json");
}

export function loadSessionMetadata() {
  try {
    return JSON.parse(readFileSync(getSessionMetadataFile(), "utf8"));
  } catch {
    return {};
  }
}

export function updateSessionMetadata(file, changes) {
  const metadata = loadSessionMetadata();
  metadata[file] = { ...(metadata[file] ?? {}), ...changes };
  mkdirSync(getHistoryDir(), { recursive: true, mode: 0o700 });
  writeFileSync(getSessionMetadataFile(), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  return metadata[file];
}

export function getPromptMetadataKey(record) {
  return `prompt:${record.sessionId ?? record.sessionFile ?? "unknown"}:${record.timestamp}:${record.pid}`;
}

export function updatePromptMetadata(record, changes) {
  return updateSessionMetadata(getPromptMetadataKey(record), changes);
}

export function loadSettings() {
  try {
    return JSON.parse(readFileSync(getSettingsFile(), "utf8"));
  } catch {
    return {};
  }
}

export function appendAndFlush(record) {
  const dir = getHistoryDir();
  const file = getHistoryFile();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const fd = openSync(file, "a", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(record)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  if (statSync(file).size <= MAX_BYTES) return;

  // Preserve pinned prompts across rollover so they are never lost
  const old1 = `${file}.1`;
  const metadata = loadSessionMetadata();
  const pinnedPrompts = [old1, file]
    .filter(existsSync)
    .flatMap((f) => readFileSync(f, "utf8").split(/\r?\n/))
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        const meta = metadata[getPromptMetadataKey(parsed)];
        return meta?.pinned ? [line] : [];
      } catch {
        return [];
      }
    });

  try {
    unlinkSync(old1);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  renameSync(file, old1);

  if (pinnedPrompts.length > 0) {
    // Write unique pinned prompts back into the new active file
    const unique = [...new Set(pinnedPrompts)];
    writeFileSync(file, `${unique.join("\n")}\n`, { mode: 0o600 });
  }
}

export function loadRecords() {
  const file = getHistoryFile();
  return [`${file}.1`, file]
    .filter(existsSync)
    .flatMap((f) => readFileSync(f, "utf8").split(/\r?\n/))
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    })
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function formatTimestamp(iso) {
  try {
    return `${new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Chicago",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso)).replaceAll("/", "-")} CT`;
  } catch {
    return iso;
  }
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join(" ");
}

function sessionFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return sessionFiles(file);
    return entry.isFile() && entry.name.endsWith(".jsonl") ? [file] : [];
  });
}

export function readSessionSummary(file) {
  try {
    const entries = readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
    const header = entries.find((entry) => entry.type === "session") ?? {};
    const name = entries
      .filter((entry) => entry.type === "session_info" && typeof entry.name === "string")
      .at(-1)?.name;
    const messages = entries
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.message)
      .filter(Boolean);
    const firstPrompt = messages.find((message) => message.role === "user");
    const fullText = messages
      .filter((message) => ["user", "assistant", "toolResult", "custom"].includes(message.role))
      .map((message) => textFromContent(message.content))
      .filter(Boolean)
      .join(" ");

    return {
      file,
      name: name ?? "",
      timestamp: header.timestamp ?? "",
      firstPrompt: textFromContent(firstPrompt?.content),
      fullText,
    };
  } catch {
    return undefined;
  }
}

export function searchSessions(query = "", sessionDir = join(getConfigDir(), "sessions"), field = "all") {
  const normalizedQuery = query.toLocaleLowerCase().trim().replace(/\s+/g, " ");
  const metadata = loadSessionMetadata();
  return sessionFiles(sessionDir)
    .map(readSessionSummary)
    .filter(Boolean)
    .map((session) => ({ ...session, ...(metadata[session.file] ?? {}) }))
    .filter((session) => {
      const text = field === "name"
        ? (session.name || session.firstPrompt)
        : `${session.name} ${session.firstPrompt} ${session.timestamp} ${formatTimestamp(session.timestamp)} ${session.fullText} ${(session.tags ?? []).join(" ")}`;
      return !normalizedQuery || text.toLocaleLowerCase().replace(/\s+/g, " ").includes(normalizedQuery);
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export function makeSessionNamePrompt(initialPrompt) {
  return [
    "Create a concise 3-7 word title for this Pi coding session.",
    "Return only the title: no quotes, punctuation, markdown, or explanation.",
    `Initial prompt: ${initialPrompt.slice(0, 4000)}`,
  ].join("\n");
}

export function normalizeSessionName(value) {
  return value
    .replace(/^[\s"'`#]*title\s*:\s*/i, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/^\s*["'`]+|["'`]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function selectNameModel(scopedModels, activeModel, requestedModel) {
  if (!requestedModel) return activeModel;
  return scopedModels.find(({ model }) => `${model.provider}/${model.id}` === requestedModel)?.model;
}

export function getSessionsForPrune(options = {}) {
  const {
    maxAgeDays = 90,
    ignorePinned = true,
    ignoreNamed = false,
    sessionDir = join(getConfigDir(), "sessions"),
    now = Date.now(),
  } = options;

  const metadata = loadSessionMetadata();
  const cutoffMs = now - maxAgeDays * 24 * 60 * 60 * 1000;

  return sessionFiles(sessionDir)
    .map(readSessionSummary)
    .filter(Boolean)
    .map((s) => ({ ...s, ...(metadata[s.file] ?? {}) }))
    .filter((s) => {
      if (ignorePinned && s.pinned) return false;
      if (ignoreNamed && s.name) return false;
      const sessionTime = s.timestamp ? Date.parse(s.timestamp) : statSync(s.file).mtimeMs;
      return !Number.isNaN(sessionTime) && sessionTime < cutoffMs;
    })
    .sort((a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0));
}

export function pruneSessions(options = {}) {
  const {
    archiveDir = getArchiveDir(),
    dryRun = false,
    sessionDir = join(getConfigDir(), "sessions"),
    ...filterOptions
  } = options;

  const candidates = getSessionsForPrune({ sessionDir, ...filterOptions });
  const archived = [];

  for (const session of candidates) {
    const relPath = relative(sessionDir, session.file);
    const destPath = resolve(archiveDir, relPath);
    if (!dryRun) {
      mkdirSync(dirname(destPath), { recursive: true, mode: 0o700 });
      renameSync(session.file, destPath);
    }
    archived.push({ file: session.file, dest: destPath, name: session.name, timestamp: session.timestamp });
  }

  return { archived, dryRun, archiveDir };
}

export function launchPi(record, resend) {
  const npmBin = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "npm");
  const cli = join(
    npmBin,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "bundle",
    "cli.js",
  );
  if (!existsSync(cli)) {
    console.error(`Pi CLI not found: ${cli}`);
    process.exit(1);
  }

  const args = [cli];
  if (record.sessionFile && existsSync(record.sessionFile)) {
    args.push("--session", record.sessionFile);
  }
  if (resend) {
    args.push("--", record.prompt);
  }

  const env = { ...process.env };
  const piCmd = join(npmBin, "pi.cmd");
  if (existsSync(piCmd)) {
    for (const line of readFileSync(piCmd, "utf8").split(/\r?\n/)) {
      const match = line.match(/^SET (TEMP|TMP)=(.+)$/i);
      if (match) env[match[1].toUpperCase()] = match[2];
    }
  }

  if (resend && record.imageCount) {
    console.error(`Warning: ${record.imageCount} image attachment(s) are not stored or resent.`);
  }

  const result = spawnSync(process.execPath, args, {
    cwd: existsSync(record.cwd) ? record.cwd : process.cwd(),
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
