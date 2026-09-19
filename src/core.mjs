import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const MAX_BYTES = 5 * 1024 * 1024;

export function getConfigDir() {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

export function getHistoryDir() {
  return join(getConfigDir(), "prompt-history");
}

export function getHistoryFile() {
  return join(getHistoryDir(), "prompts.jsonl");
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

  try {
    unlinkSync(`${file}.1`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  renameSync(file, `${file}.1`);
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
