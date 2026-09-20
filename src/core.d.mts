export function appendAndFlush(record: unknown): void;
export function formatTimestamp(iso: string): string;
export function loadRecords(): unknown[];
export function loadSettings(): unknown;
export function makeSessionNamePrompt(initialPrompt: string): string;
export function normalizeSessionName(value: string): string;
export function searchSessions(query?: string): Array<{ file: string; name: string; timestamp: string; firstPrompt: string; fullText: string }>;
export function selectNameModel<T>(scopedModels: readonly { model: T }[], activeModel: T | undefined, requestedModel?: string): T | undefined;
