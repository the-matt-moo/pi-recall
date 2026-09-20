# Changelog

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
