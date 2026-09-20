# pi-prompt-history

Rolling prompt history and instant recall for [Pi](https://github.com/earendil-works/pi-mono).

Automatically captures each outbound prompt synchronously to a persistent rolling JSONL log, making recovery seamless when sessions are abruptly terminated by external processes (e.g., Bitdefender, OS kills).

## Features

- **Synchronous & Flushed**: Flushes and `fsync`s prompt and session metadata immediately in `before_agent_start`.
- **In-Session History**: `/history` lists recent prompts and restores them into the editor.
- **Auto Names**: Names a new session after its first settled turn, without interrupting the session.
- **Session Search**: Searches every stored session by title, initial prompt, timestamp, or conversation text, then switches to it.
- **Host Terminal CLI**: `pi-history` command for crash recovery outside Pi when Pi is dead.
- **Rolling Log**: 5 MiB size cap with `.1` rollover at `~/.pi/agent/prompt-history/prompts.jsonl`.

## Installation

### As a Pi Package (Recommended)

```bash
pi install git:github.com/the-matt-moo/pi-prompt-history
```

### Via npm (Global CLI & Extension)

```bash
npm install -g git+https://github.com/the-matt-moo/pi-prompt-history.git
```

Or for local development:

```bash
git clone https://github.com/the-matt-moo/pi-prompt-history.git
pi install ./pi-prompt-history
```

## Usage

### Inside Pi

- `/history`: Open interactive selector of recent prompts. Selecting one restores it directly to the editor.
- `/history last`: Restore the immediate previous prompt into the editor.
- `/history <N>`: Restore the Nth previous prompt into the editor.
- `/history send [last|<N>]`: Send the prompt immediately without waiting for Enter.
- `/sessions [query]`: Search all stored sessions. Without a query, opens a search prompt; select a result to switch sessions.
- `/session-search [query]`: Alias for `/sessions`.

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
