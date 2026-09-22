#!/usr/bin/env node
import { formatTimestamp, getArchiveDir, getHistoryFile, launchPi, loadRecords, pruneSessions } from "../src/core.mjs";

function latest() {
  const records = loadRecords();
  const record = records.at(-1);
  if (!record) {
    console.error(`No prompt history found at ${getHistoryFile()}`);
    process.exit(1);
  }
  return record;
}

const [command = "list", value] = process.argv.slice(2);

if (command === "list" || /^\d+$/.test(command)) {
  const requested = Number(command === "list" ? value ?? 10 : command);
  const count = Number.isInteger(requested) && requested > 0 ? requested : 10;
  const recent = loadRecords().slice(-count).reverse();
  if (!recent.length) latest();
  for (const [index, record] of recent.entries()) {
    const prompt = String(record.prompt)
      .split(/\r?\n/)
      .map((line) => `   ${line}`)
      .join("\n");
    console.log(`${index + 1}. ${formatTimestamp(record.timestamp)}  session=${record.sessionId}`);
    console.log(`   file=${record.sessionFile ?? "(ephemeral)"}`);
    console.log(prompt);
  }
} else if (command === "last") {
  process.stdout.write(String(latest().prompt));
} else if (command === "session") {
  const record = latest();
  process.stdout.write(record.sessionFile ?? record.sessionId);
} else if (command === "path") {
  process.stdout.write(getHistoryFile());
} else if (command === "resume") {
  launchPi(latest(), false);
} else if (command === "resend") {
  launchPi(latest(), true);
} else if (command === "prune") {
  const isDryRun = process.argv.includes("--dry-run");
  const daysArg = process.argv.find((arg) => /^--days=\d+$/.test(arg));
  const maxAgeDays = daysArg ? Number(daysArg.split("=")[1]) : (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : 90);

  const result = pruneSessions({
    maxAgeDays,
    dryRun: isDryRun,
    ignorePinned: !process.argv.includes("--include-pinned"),
    ignoreNamed: process.argv.includes("--ignore-named"),
  });

  if (!result.archived.length) {
    console.log(`No sessions older than ${maxAgeDays} days found to archive.`);
  } else {
    console.log(`${isDryRun ? "[DRY RUN] Would archive" : "Archived"} ${result.archived.length} session(s) older than ${maxAgeDays} days to ${result.archiveDir}:`);
    for (const item of result.archived) {
      console.log(`  - [${formatTimestamp(item.timestamp)}] ${item.name || "(unnamed)"}\n    ${item.file} -> ${item.dest}`);
    }
  }
} else {
  console.log("Usage: pi-recall [list [N]|N|last|session|path|resume|resend|prune [--dry-run] [--days=N]]");
  process.exitCode = 1;
}
