# Changelog

## [0.3.1] - 21-09-2026

### Added
- Stale session archiving via `/session-prune [days]` and host CLI `pi-history prune [--dry-run] [--days=N]`.
- Retention settings support in `settings.json` (`maxAgeDays`, `archiveDir`, `ignorePinned: true`, `ignoreNamed: false`).
- Pinned prompt preservation across rolling 5 MiB log rollovers.

- Pin sessions and toggle tags with `/session-pin` and `/session-tag`.
- Show pinned sessions first and support `/sessions pinned`.
- Persist session metadata separately from Pi's session files.
- Add a scrollable modal picker with All/Pinned/Prompts tabs, Tab switching, and Space-to-pin toggling.
- Fix session-row escaping and fill the modal viewport to prevent underlying terminal text bleeding through.
- Move Prompt History into a dedicated `/prompts` modal with filtering and prompt pinning.
- Add All/Pinned prompt tabs, unique prompt display without timestamps, live in-modal search, and date/alphabetical sorting.
- Add session tabs, live in-modal search, date/alphabetical sorting, selected-item highlighting, and subagent-session filtering.
- Open `/sessions` and `/prompts` directly into their modals.

## [0.2.5] - 20-09-2026

### Changed
- Publish as scoped npm package `@tenchi4u/pi-session-history` for public npm registry.

## [0.2.4] - 20-09-2026

### Changed
- Add social card image to README.

## [0.2.3] - 20-09-2026

### Changed
- Rename package to `pi-session-history`; install via `pi-session-history`, invoke via `pi-session` or `pi-history`.
- `/session-search` is now the primary command; `/sessions` remains as an alias.

## [0.2.2] - 20-09-2026

### Fixed
- Exclude slash commands from `/history` and `/sessions` display (filter was logging only, not displaying).

## [0.2.1] - 20-09-2026

### Fixed
- Filter out non-user prompts (slash commands like `/reload`, `/history`) from history.

## [0.2.0] - 20-09-2026

### Added
- Auto-name new sessions with the active or configured scoped Pi model.
- Search and switch stored sessions by title, prompt, timestamp, or conversation text.
