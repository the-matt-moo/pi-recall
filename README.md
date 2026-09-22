![pi-recall](./assets/pi-recall-social-card.png)

# pi-recall

Persistent session and prompt recall for [Pi](https://github.com/earendil-works/pi-mono). It names sessions, searches saved conversations, restores prompts, and keeps a crash-safe prompt log.

## Features

- `/sessions` searches and opens saved sessions.
- `/prompts` searches and restores recorded prompts.
- `/sessions --last` opens the most recent session other than the current one.
- `/prompts --last` restores the most recent prompt to the editor.
- Sessions and prompts can be pinned or permanently deleted; sessions can also be tagged.
- New sessions can be named automatically after their first completed turn.
- Prompt and metadata writes are flushed immediately.
- The prompt log rolls over at 5 MiB while preserving pinned prompts.
- Old sessions can be archived from Pi or the host terminal.

## Install

Recommended Pi package install:

```bash
pi install git:github.com/the-matt-moo/pi-recall
```

Global install, including the `pi-recall` host command (`pi-history` and `pi-session` aliases included):

```bash
npm install -g git+https://github.com/the-matt-moo/pi-recall.git
```

Local development:

```bash
git clone https://github.com/the-matt-moo/pi-recall.git
pi install ./pi-recall
```

## Pi commands

| Command | Action |
| --- | --- |
| `/sessions` | Open all saved sessions. |
| `/sessions <query>` | Filter by session name or first prompt. |
| `/sessions pinned` | Open pinned sessions only. |
| `/sessions --last` | Open the newest saved session other than the current session. |
| `/prompts` | Open recorded prompts. |
| `/prompts <query>` | Filter prompts by text. |
| `/prompts --last` | Restore the newest eligible prompt to the editor. |
| `/session-pin` | Toggle the current session pin. |
| `/session-tag <tag>` | Toggle a single-word tag on the current session. |
| `/session-prune [days]` | Archive old sessions; defaults to 90 days and asks for confirmation. |

Picker controls:

- `/`: search inside the picker
- `Tab`: switch tabs
- `s`: sort by date or alphabetically
- `Space`: pin or unpin
- `d`, then `y`: permanently delete the selected session file or prompt history entry
- `Enter`: open or restore
- `Esc`: close

Session pins, prompt pins, and tags are stored under `~/.pi/agent/pi-recall/`, or under `$PI_CODING_AGENT_DIR/pi-recall/` when that variable is set (falls back to legacy `session-history/` if present).

## Settings

Create `~/.pi/agent/pi-recall/settings.json`, or `$PI_CODING_AGENT_DIR/pi-recall/settings.json`:

```json
{
  "prompts": {
    "minimumWords": 3
  },
  "sessions": {
    "autoName": {
      "enabled": true,
      "model": "provider/model-id"
    },
    "retention": {
      "archiveDir": "C:/Users/Tench/.pi/agent/sessions-archive",
      "ignorePinned": true,
      "ignoreNamed": false
    }
  }
}
```

- `prompts.minimumWords`: excludes shorter prompts from `/prompts`, `/prompts --last`, and the session picker's first-prompt view. Default: `3`; use `0` to disable.
- `sessions.autoName.enabled`: enables automatic session naming. Default: `true`.
- `sessions.autoName.model`: optional `provider/model-id`. It must be available in Pi's current scoped models; otherwise naming is skipped.
- `sessions.retention.archiveDir`: archive destination. Default: `~/.pi/agent/sessions-archive/`.
- `sessions.retention.ignorePinned`: prevents pinned sessions from being archived. Default: `true`.
- `sessions.retention.ignoreNamed`: prevents named sessions from being archived. Default: `false`.

## Host terminal

`pi-recall` (`pi-history` / `pi-session`) remains available outside Pi for crash recovery:

```text
pi-recall list [N]                List recent prompts; default 10
pi-recall N                       List the last N prompts
pi-recall last                    Print the latest prompt
pi-recall session                 Print its session file or ID
pi-recall resume                  Resume its session in Pi
pi-recall resend                  Resume and resend the prompt
pi-recall path                    Print the prompt-log path
pi-recall prune [days]            Archive old sessions; default 90 days
pi-recall prune --dry-run         Preview archival
pi-recall prune --days=N          Set the age threshold
pi-recall prune --include-pinned  Allow pinned sessions to be archived
pi-recall prune --ignore-named    Preserve named sessions
```

## Data

Prompts are stored in `~/.pi/agent/pi-recall/prompts.jsonl`, or `$PI_CODING_AGENT_DIR/pi-recall/prompts.jsonl`:

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

Slash commands and subagent prompts are excluded from prompt browsing. Prompt pins and session metadata are stored separately from Pi's session files.

## License

MIT
