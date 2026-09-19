import test from "node:test";
import assert from "node:assert/strict";
import { formatTimestamp } from "../src/core.mjs";

test("formatTimestamp produces readable date with CT", () => {
  const formatted = formatTimestamp("2026-09-19T15:00:00.000Z");
  assert.match(formatted, /^\d{2}-\d{2}-\d{4},? \d{2}:\d{2} CT$/);
});
