import { OpenClawPluginApi } from 'openclaw/plugin-sdk';

/**
 * OpenClaw Memory (Mem0) Plugin
 *
 * Long-term memory via Mem0 — supports both the Mem0 platform
 * and the open-source self-hosted SDK. Uses the official `mem0ai` package.
 *
 * Features:
 * - 5 tools: memory_search, memory_list, memory_store, memory_get, memory_forget
 *   (with session/long-term scope support via scope and longTerm parameters)
 * - Short-term (session-scoped) and long-term (user-scoped) memory
 * - Auto-recall: injects relevant memories (both scopes) before each agent turn
 * - Auto-capture: stores key facts scoped to the current session after each agent turn
 * - Per-agent isolation: multi-agent setups write/read from separate userId namespaces
 *   automatically via sessionKey routing (zero breaking changes for single-agent setups)
 * - CLI: openclaw mem0 search, openclaw mem0 stats
 * - Dual mode: platform or open-source (self-hosted)
 */

type Mem0Mode = "platform" | "open-source" | "server";
type Mem0Config = {
    mode: Mem0Mode;
    apiKey?: string;
    orgId?: string;
    projectId?: string;
    customInstructions: string;
    customCategories: Record<string, string>;
    enableGraph: boolean;
    customPrompt?: string;
    oss?: {
        embedder?: {
            provider: string;
            config: Record<string, unknown>;
        };
        vectorStore?: {
            provider: string;
            config: Record<string, unknown>;
        };
        llm?: {
            provider: string;
            config: Record<string, unknown>;
        };
        historyDbPath?: string;
    };
    serverUrl?: string;
    userId: string;
    autoCapture: boolean;
    autoRecall: boolean;
    searchThreshold: number;
    topK: number;
};
/**
 * Parse an agent ID from a session key following the pattern `agent:<agentId>:<uuid>`.
 * Returns undefined for non-agent sessions, the "main" sentinel, or malformed keys.
 */
declare function extractAgentId(sessionKey: string | undefined): string | undefined;
/**
 * Derive the effective user_id from a session key, namespacing per-agent.
 * Falls back to baseUserId when the session is not agent-scoped.
 */
declare function effectiveUserId(baseUserId: string, sessionKey?: string): string;
/** Build a user_id for an explicit agentId (e.g. from tool params). */
declare function agentUserId(baseUserId: string, agentId: string): string;
/**
 * Resolve user_id with priority: explicit agentId > explicit userId > session-derived > configured.
 */
declare function resolveUserId(baseUserId: string, opts: {
    agentId?: string;
    userId?: string;
}, currentSessionId?: string): string;
declare const memoryPlugin: {
    id: string;
    name: string;
    description: string;
    kind: "memory";
    configSchema: {
        parse(value: unknown): Mem0Config;
    };
    register(api: OpenClawPluginApi): void;
};

export { agentUserId, memoryPlugin as default, effectiveUserId, extractAgentId, resolveUserId };
