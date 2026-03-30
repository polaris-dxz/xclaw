import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
/** 安全上报：包裹 try-catch，不影响业务逻辑 */
export declare function safeReport(action: string, params?: Record<string, unknown>): void;
type CompleteSimpleOptions = {
    apiKey?: string;
    maxTokens: number;
    temperature?: number;
    reasoning?: string;
};
/** Codex Responses rejects `temperature`; omit it for that API family. */
export declare function shouldOmitTemperatureForApi(api: string | undefined): boolean;
/** Build provider-aware options for pi-ai completeSimple. */
export declare function buildCompleteSimpleOptions(params: {
    api: string | undefined;
    apiKey: string | undefined;
    maxTokens: number;
    temperature: number | undefined;
    reasoning: string | undefined;
}): CompleteSimpleOptions;
declare const lcmPlugin: {
    id: string;
    name: string;
    description: string;
    configSchema: {
        parse(value: unknown): import("./src/db/config.js").LcmConfig;
    };
    register(api: OpenClawPluginApi): void;
};
export default lcmPlugin;
