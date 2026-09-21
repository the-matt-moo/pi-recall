export function appendAndFlush(record: unknown): void;
export function deletePromptRecord(record: { sessionId?: string; sessionFile?: string | null; timestamp: string; pid: number }): number;
export function deleteSession(file: string): void;
export function formatTimestamp(iso: string): string;
export function updateSessionMetadata(file: string, changes: Record<string, unknown>): Record<string, unknown>;
export function getPromptMetadataKey(record: { sessionId?: string; sessionFile?: string | null; timestamp: string; pid: number }): string;
export function updatePromptMetadata(record: { sessionId?: string; sessionFile?: string | null; timestamp: string; pid: number }, changes: Record<string, unknown>): Record<string, unknown>;
export function loadRecords(): unknown[];
export function loadSessionMetadata(): Record<string, Record<string, unknown>>;
export function loadSettings(): unknown;
export function makeSessionNamePrompt(initialPrompt: string): string;
export function normalizeSessionName(value: string): string;
export function searchSessions(query?: string, sessionDir?: string, field?: "all" | "name"): Array<{ file: string; name: string; timestamp: string; firstPrompt: string; fullText: string; pinned?: boolean; tags?: string[] }>;
export function selectNameModel<T>(scopedModels: readonly { model: T }[], activeModel: T | undefined, requestedModel?: string): T | undefined;
export function getArchiveDir(): string;
export interface PruneOptions {
  maxAgeDays?: number;
  ignorePinned?: boolean;
  ignoreNamed?: boolean;
  sessionDir?: string;
  now?: number;
}
export interface PruneExecutionOptions extends PruneOptions {
  archiveDir?: string;
  dryRun?: boolean;
}
export function getSessionsForPrune(options?: PruneOptions): Array<{ file: string; name: string; timestamp: string; firstPrompt: string; fullText: string; pinned?: boolean; tags?: string[] }>;
export function pruneSessions(options?: PruneExecutionOptions): { archived: Array<{ file: string; dest: string; name: string; timestamp: string }>; dryRun: boolean; archiveDir: string };
