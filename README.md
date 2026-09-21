![pi-session-history](./assets/pi-session-history-social-card.png)

# pi-session-history

Session and prompt history management for [Pi](https://github.com/earendil-works/pi-mono). Organize conversations with human-readable names, search session history, and instantly recall prompts—all persisted to a rolling JSONL log for seamless recovery when sessions are abruptly terminated by external processes (e.g., Bitdefender, OS kills).

## Features

- **Synchronous & Flushed**: Flushes and `fsync`s prompt and session metadata immediately in `before_agent_start`.
- **In-Session History**: `/history` lists recent prompts and restores them into the editor.
- **Auto Names**: Names a new session after its first settled turn, without interrupting the session.
- **Session Search**: Searches every stored session by title, initial prompt, timestamp, tags, or conversation text, then switches to it.
- **Pinned Sessions**: Pin important sessions and add tags; pinned sessions appear first for quick recall.
- **Safe Retention & Archiving**: Archive stale sessions (>N days, default 90) to `~/.pi/agent/sessions-archive/` via `/session-prune` or CLI `pi-history prune`. Pinned sessions and pinned prompts are immune.
- **Host Terminal CLI**: `pi-history` command for crash recovery outside Pi when Pi is dead.
- **Rolling Log**: 5 MiB size cap with `.1` rollover at `~/.pi/agent/prompt-history/prompts.jsonl`. Pinned prompts are preserved across rollover.

## Installation

### As a Pi Package (Recommended)

```bash
pi install git:github.com/the-matt-moo/pi-session-history
```

### Via npm (Global CLI & Extension)

```bash
npm install -g git+https://github.com/the-matt-moo/pi-session-history.git
```

Or for local development:

```bash
git clone https://github.com/the-matt-moo/pi-session-history.git
pi install ./pi-session-history
```

## Usage

### Inside Pi

- `/history`: Open interactive selector of recent prompts. Selecting one restores it directly to the editor.
- `/history last`: Restore the immediate previous prompt into the editor.
- `/history <N>`: Restore the Nth previous prompt into the editor.
- `/history send [last|<N>]`: Send the prompt immediately without waiting for Enter.
- `/session-search [query]`: Search all stored sessions. Without a query, opens a search prompt; select a result to switch sessions.
- `/sessions [query]`: Alias for `/session-search`; leave the search blank for **ALL sessions**, or enter any partial/full session name to filter matches (case-insensitive). The active filter is shown in the modal. Opens a scrollable modal with All Sessions, Pinned Sessions, and Session by 1st Prompt tabs. Press `/` to search/filter live inside the modal, Tab to switch tabs, Space to pin/unpin the selected session, Enter to open it, and Esc to close.
- `/prompts [query]`: Browse prompt history in a scrollable modal; leave blank for all prompts or enter a case-insensitive partial/full filter. The modal shows unique prompts without timestamps and has All Prompts and Pinned Prompts tabs; press `/` to search/filter live, Tab to switch, Space to pin/unpin, and Enter to restore.
- `/session-pin`: Toggle the current session's pin. Pinned sessions appear first and show `[PIN]`.
- `/session-tag <tag>`: Toggle a tag on the current session. Tags are searchable and shown in the picker.
- `/session-prune [days]`: Archive stale sessions older than N days (default 90) to `sessions-archive/`. Confirms before moving; respects pinned session immunity.

Session pins and tags are stored separately from Pi's session files at `~/.pi/agent/prompt-history/session-metadata.json` (or under `$PI_CODING_AGENT_DIR`).

### Auto-name model

By default, auto-naming uses the current session model. To select a cheaper or faster model, create user-scoped settings at `~/.pi/agent/prompt-history/settings.json` (or `$PI_CODING_AGENT_DIR/prompt-history/settings.json`):

```json
{
  "autoName": {
    "enabled": true,
    "model": "provider/model-id"
  }
}
```

The configured model must be visible in Pi's current `/scoped-models`; otherwise naming is skipped. Set `"enabled": false` to disable auto-naming.

### Retention & Archiving settings

Configure optional retention defaults in `~/.pi/agent/prompt-history/settings.json`:

```json
{
  "retention": {
    "maxAgeDays": 90,
    "archiveDir": "C:/Users/Tench/.pi/agent/sessions-archive",
    "ignorePinned": true,
    "ignoreNamed": false
  }
}
```

- `ignorePinned`: `true` by default (pinned sessions are never pruned).
- `ignoreNamed`: `false` by default (named sessions older than `maxAgeDays` can be pruned unless pinned).

### Outside Pi (Host Terminal)

When Pi is killed or closed:

```bash
# List last 10 prompts with timestamps, session ID, and session file
pi-history list 10

# Print last prompt raw (useful for piping or clipboard)
pi-history last

# Print session file or ID for last prompt
pi-history session

# Resume the last session in Pi
pi-history resume

# Relaunch Pi and resend the crashed prompt into that session
pi-history resend

# Output path to the log file
pi-history path

# Dry run session pruning older than 90 days
pi-history prune --dry-run

# Archive sessions older than 60 days
pi-history prune 60
```

## Log Format

Stored at `~/.pi/agent/prompt-history/prompts.jsonl` (or `$PI_CODING_AGENT_DIR/prompt-history/prompts.jsonl`):

```json
{
  "version": 1,
  "timestamp": "2026-09-19T16:01:42.381Z",
  "pid": 12345,
  "sessionId": "01a0ba66-ebec-71ea-8926-1f362d7bbd0e",
  "sessionFile": "C:\\Users\\Tench\\.pi\\agent\\sessions\\--project--\\session.jsonl",
  "cwd": "C:\\path\\to\\project",
  "prompt": "Full prompt text...",
  "imageCount": 0
}
```

## License

MIT
