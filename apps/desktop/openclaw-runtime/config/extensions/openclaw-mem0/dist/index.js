// index.ts
import { Type } from "@sinclair/typebox";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as os from "os";
import { GalileoReport, REPORT_CONST } from '../compiled/index.js';

// 开发环境使用 sparta 域名，其他环境使用 m 域名
const DEV_SERVER_URL = "https://jprx.sparta.html5.qq.com/data/{cmdid}/forward";
const PROD_SERVER_URL = "https://jprx.m.qq.com/data/{cmdid}/forward";

/** 根据环境选择默认的 serverUrl */
function getDefaultServerUrl() {
  // 通过 BUILD_ENV 环境变量判断环境（与 content-plugin 保持一致）
  // 打包后的应用中 BUILD_ENV 可能为 undefined，默认按生产环境处理
  const buildEnv = process.env.BUILD_ENV || 'production';
  return buildEnv === 'production' ? PROD_SERVER_URL : DEV_SERVER_URL;
}

// ─── 上报基础设施 ───
const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = dirname(__filename_esm);
const PLUGIN_ROOT_DIR = dirname(__dirname_esm);
const reporter = GalileoReport.getInstance();

/** 生成链路唯一 ID（16 位十六进制） */
function generateTraceId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${ts}-${rand}`;
}

/** 简单字符串哈希（用于裁剪长文本后仍能关联原文） */
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** 安全上报：包裹 try-catch，不影响业务逻辑 */
function safeReport(action, params) {
  try {
    reporter.reportFunc(REPORT_CONST.PLUGIN, {
      page_id: reporter.getPluginName() || 'openclaw-mem0',
      action,
      ...params,
    });
  } catch (_) {
    // 上报失败不影响业务
  }
}

// Dynamically get auth gateway base URL from qclaw.json or environment
function getAuthGatewayBaseUrl() {
  // 优先从 qclaw.json 读取主进程写入的实际运行地址
  try {
    const metaPath = join(os.homedir(), '.qclaw', 'qclaw.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    if (meta?.authGatewayBaseUrl) {
      return meta.authGatewayBaseUrl.replace(/\/+$/, '');
    }
  } catch {
    // qclaw.json 不存在或解析失败，继续 fallback
  }
  // fallback: 从环境变量 QCLAW_LLM_BASE_URL 提取端口（子进程内已展开）
  try {
    const baseUrl = process.env.QCLAW_LLM_BASE_URL;
    if (baseUrl) {
      const match = baseUrl.match(/:(\d+)\//);
      if (match) {
        return `http://127.0.0.1:${match[1]}/proxy`;
      }
    }
  } catch {
    // ignore
  }
  return 'http://127.0.0.1:19000/proxy'; // default fallback
}

// 接口路径 → CMD ID 映射
const PATH_TO_CMDID = {
  "/search": "4145",
  "/memories": "4146",
  "/memory/list": "4147",
  "/memory/get": "4148",
  "/memory/update": "4149",
  "/memory/history": "4150",
  "/memory/delete": "4151",
  "/memory/delete_all": "4152",
};

var ServerProvider = class {
  constructor(serverUrl, useProxy) {
    this.serverUrl = serverUrl.replace(/\/+$/, "");
    this.useProxy = useProxy;
    this.proxyUrl = useProxy ? `${getAuthGatewayBaseUrl()}/api` : null;
  }
  /**
   * 根据接口路径解析最终 URL。
   * 如果 serverUrl 包含 {cmdid} 占位符，则根据 path 查找对应的 CMD ID 并替换；
   * 否则按原逻辑直接拼接 serverUrl + path。
   */
  _resolveUrl(path) {
    if (this.serverUrl.includes("{cmdid}")) {
      const cmdid = PATH_TO_CMDID[path];
      if (!cmdid) {
        throw new Error(`[mem0] Unknown API path "${path}", no cmdid mapping found`);
      }
      return this.serverUrl.replace("{cmdid}", cmdid);
    }
    return `${this.serverUrl}${path}`;
  }
  async _fetch(method, path, body, timeoutMs = 5_000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const fetchStart = Date.now();
    try {
      if (!this.proxyUrl) {
        const url = this._resolveUrl(path);
        const opts = {
          method,
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
        };
        if (body !== undefined) opts.body = JSON.stringify(body);
        const res = await fetch(url, opts);
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          const err = new Error(`Mem0 server ${method} ${path} failed (${res.status}): ${text}`);
          // ─── memory_api_error 上报 ───
          safeReport('memory_api_error', {
            api_method: method,
            api_path: path,
            error_type: 'http_error',
            http_status: String(res.status),
            error_message: String(err).slice(0, 300),
            is_proxy: 'false',
            duration_ms: String(Date.now() - fetchStart),
          });
          throw err;
        }
        // ─── memory_api_success 上报（直连） ───
        const directDuration = Date.now() - fetchStart;
        safeReport('memory_api_success', {
          api_method: method,
          api_path: path,
          http_status: String(res.status),
          is_proxy: 'false',
          duration_ms: String(directDuration),
        });
        const directJson = await res.json();
        // Unwrap jprx gateway envelope: {ret:0, data:{resp:{...actual_data...}}}
        if (directJson && typeof directJson === 'object' && 'ret' in directJson) {
          // Check jprx business error: {common:{code:21004, message:"..."}}
          if (directJson.common && directJson.common.code !== 0) {
            const errMsg = `jprx business error (code=${directJson.common.code}): ${directJson.common.message || 'unknown'}`;
            throw new Error(`Mem0 server ${method} ${path} failed: ${errMsg}`);
          }
          // Check jprx top-level error: {ret:1002, errmsg:"no valid data"}
          if (directJson.ret !== 0 && !directJson.data) {
            const errMsg = `jprx error (ret=${directJson.ret}): ${directJson.errmsg || 'unknown'}`;
            throw new Error(`Mem0 server ${method} ${path} failed: ${errMsg}`);
          }
          if (directJson.data?.resp !== undefined) {
            return directJson.data.resp;
          }
        }
        return directJson;
      }
      const proxyUrl = this.proxyUrl;
      const remoteUrl = this._resolveUrl(path);
      const opts = {
        method,
        headers: {
          "Content-Type": "application/json",
          "Remote-URL": remoteUrl
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      };
      const res = await fetch(proxyUrl, opts);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(`Mem0 proxy ${method} ${path} failed (${res.status}): ${text}`);
        // ─── memory_api_error 上报 ───
        safeReport('memory_api_error', {
          api_method: method,
          api_path: path,
          error_type: 'http_error',
          http_status: String(res.status),
          error_message: String(err).slice(0, 300),
          is_proxy: 'true',
          duration_ms: String(Date.now() - fetchStart),
        });
        throw err;
      }
      // ─── memory_api_success 上报（代理） ───
      const proxyDuration = Date.now() - fetchStart;
      safeReport('memory_api_success', {
        api_method: method,
        api_path: path,
        http_status: String(res.status),
        is_proxy: 'true',
        duration_ms: String(proxyDuration),
      });
      const json = await res.json();
      // Unwrap jprx gateway envelope: {ret:0, data:{resp:{...actual_data...}}}
      if (json && typeof json === 'object' && 'ret' in json) {
        // Check jprx business error: {common:{code:21004, message:"..."}}
        if (json.common && json.common.code !== 0) {
          const errMsg = `jprx business error (code=${json.common.code}): ${json.common.message || 'unknown'}`;
          throw new Error(`Mem0 proxy ${method} ${path} failed: ${errMsg}`);
        }
        // Check jprx top-level error: {ret:1002, errmsg:"no valid data"}
        if (json.ret !== 0 && !json.data) {
          const errMsg = `jprx error (ret=${json.ret}): ${json.errmsg || 'unknown'}`;
          throw new Error(`Mem0 proxy ${method} ${path} failed: ${errMsg}`);
        }
        if (json.data?.resp !== undefined) {
          return json.data.resp;
        }
      }
      return json;
    } catch (err) {
      if (err.name === "AbortError") {
        const timeoutErr = new Error(`Mem0 ${method} ${path} timed out after ${timeoutMs / 1000}s`);
        // ─── memory_api_error 上报（超时） ───
        safeReport('memory_api_error', {
          api_method: method,
          api_path: path,
          error_type: 'timeout',
          http_status: '-1',
          error_message: String(timeoutErr).slice(0, 300),
          is_proxy: String(!!this.proxyUrl),
          duration_ms: String(Date.now() - fetchStart),
        });
        throw timeoutErr;
      }
      // ─── memory_api_error 上报（网络/解析错误） ───
      if (!String(err).includes('Mem0 server') && !String(err).includes('Mem0 proxy')) {
        safeReport('memory_api_error', {
          api_method: method,
          api_path: path,
          error_type: 'network_error',
          http_status: '-1',
          error_message: String(err).slice(0, 300),
          is_proxy: String(!!this.proxyUrl),
          duration_ms: String(Date.now() - fetchStart),
        });
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  async add(messages, options) {
    const body = { messages };
    if (options.agent_id) body.agent_id = options.agent_id;
    if (options.run_id) body.run_id = options.run_id;
    if (options.metadata) body.metadata = options.metadata;
    const data = await this._fetch("POST", "/memories", body, 60_000);
    // Detect server-side errors returned as 200 with { detail: "..." }
    if (data.detail && !data.results) {
      throw new Error(`Mem0 server add failed: ${data.detail}`);
    }
    // Server returns { results: [...], relations: {...} }
    // Normalize to match expected format
    const results = [];
    if (data.results && Array.isArray(data.results)) {
      for (const r of data.results) {
        results.push({
          id: r.id ?? r.memory_id ?? "",
          memory: r.memory ?? r.text ?? "",
          event: r.event ?? "ADD"
        });
      }
    }
    // Also include relation-based results if no standard results
    if (results.length === 0 && data.relations) {
      const added = data.relations.added_entities ?? data.relations?.added_entities;
      if (Array.isArray(added)) {
        for (const group of added) {
          if (Array.isArray(group)) {
            for (const entity of group) {
              results.push({
                id: `${entity.source}-${entity.relationship}-${entity.target}`,
                memory: `${entity.source} ${entity.relationship} ${entity.target}`,
                event: "ADD"
              });
            }
          }
        }
      }
    }
    return { results };
  }
  async search(query, options) {
    const body = { query };
    if (options.agent_id) body.agent_id = options.agent_id;
    if (options.run_id) body.run_id = options.run_id;
    if (options.recallLimit != null) body.recallLimit = options.recallLimit;
    if (options.filters) body.filters = options.filters;
    const data = await this._fetch("POST", "/search", body);
    const results = [];
    // Normalize vector search results
    if (data.results && Array.isArray(data.results)) {
      for (const r of data.results) {
        results.push(normalizeMemoryItem(r));
      }
    }
    // Also include relation-based results
    if (data.relations && Array.isArray(data.relations)) {
      for (const rel of data.relations) {
        results.push({
          id: `${rel.source}-${rel.relationship}-${rel.destination ?? rel.target}`,
          memory: `${rel.source} ${rel.relationship} ${rel.destination ?? rel.target}`,
          score: 1.0,
          user_id: undefined,
          categories: undefined,
          metadata: undefined,
          created_at: undefined,
          updated_at: undefined
        });
      }
    }
    return results;
  }
  async get(memoryId) {
    const data = await this._fetch("POST", `/memory/get`, { memory_id: memoryId });
    return normalizeMemoryItem(data);
  }
  async getAll(options) {
    const body = {};
    if (options.agent_id) body.agent_id = options.agent_id;
    if (options.run_id) body.run_id = options.run_id;
    const data = await this._fetch("POST", `/memory/list`, body);
    const results = [];
    if (data.results && Array.isArray(data.results)) {
      for (const r of data.results) {
        results.push(normalizeMemoryItem(r));
      }
    }
    // Also include relation-based results
    if (data.relations && Array.isArray(data.relations)) {
      for (const rel of data.relations) {
        results.push({
          id: `${rel.source}-${rel.relationship}-${rel.target}`,
          memory: `${rel.source} ${rel.relationship} ${rel.target}`,
          score: undefined,
          user_id: undefined,
          categories: undefined,
          metadata: undefined,
          created_at: undefined,
          updated_at: undefined
        });
      }
    }
    return results;
  }
  async delete(memoryId) {
    await this._fetch("POST", `/memory/delete`, { memory_id: memoryId });
  }
};
function normalizeMemoryItem(raw) {
  return {
    id: raw.id ?? raw.memory_id ?? "",
    memory: raw.memory ?? raw.text ?? raw.content ?? "",
    user_id: raw.user_id ?? raw.userId,
    score: raw.score,
    categories: raw.categories,
    metadata: raw.metadata,
    created_at: raw.created_at ?? raw.createdAt,
    updated_at: raw.updated_at ?? raw.updatedAt
  };
}
function normalizeSearchResults(raw) {
  if (Array.isArray(raw)) return raw.map(normalizeMemoryItem);
  if (raw?.results && Array.isArray(raw.results))
    return raw.results.map(normalizeMemoryItem);
  return [];
}
function normalizeAddResult(raw) {
  if (raw?.results && Array.isArray(raw.results)) {
    return {
      results: raw.results.map((r) => ({
        id: r.id ?? r.memory_id ?? "",
        memory: r.memory ?? r.text ?? "",
        event: r.event ?? "ADD"
      }))
    };
  }
  if (Array.isArray(raw)) {
    return {
      results: raw.map((r) => ({
        id: r.id ?? r.memory_id ?? "",
        memory: r.memory ?? r.text ?? "",
        event: r.event ?? "ADD"
      }))
    };
  }
  return { results: [] };
}
var ALLOWED_KEYS = [
  "mode",
  "userId",
  "autoCapture",
  "autoRecall",
  "searchThreshold",
  "topK",
  "serverUrl",
  "useProxy"
];
function assertAllowedKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return;
  throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
}
var mem0ConfigSchema = {
  parse(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("openclaw-mem0 config required");
    }
    const cfg = value;
    assertAllowedKeys(cfg, ALLOWED_KEYS, "openclaw-mem0 config");
    // 如果未配置 serverUrl，根据环境自动选择
    const serverUrl = typeof cfg.serverUrl === "string" && cfg.serverUrl 
      ? cfg.serverUrl 
      : getDefaultServerUrl();
    return {
      mode: "server",
      userId: typeof cfg.userId === "string" && cfg.userId ? cfg.userId : "default",
      autoCapture: cfg.autoCapture !== false,
      autoRecall: cfg.autoRecall !== false,
      searchThreshold: typeof cfg.searchThreshold === "number" ? cfg.searchThreshold : 0.5,
      topK: typeof cfg.topK === "number" ? cfg.topK : 5,
      serverUrl,
      useProxy: cfg.useProxy !== false
    };
  }
};
function createProvider(cfg) {
  return new ServerProvider(cfg.serverUrl, cfg.useProxy);
}
function extractAgentId(sessionKey) {
  if (!sessionKey) return void 0;
  const match = sessionKey.match(/^agent:([^:]+):/);
  const agentId = match?.[1];
  if (!agentId || agentId === "main") return void 0;
  return agentId;
}
function effectiveUserId(baseUserId, sessionKey) {
  const agentId = extractAgentId(sessionKey);
  return agentId ? `${baseUserId}:agent:${agentId}` : baseUserId;
}
function agentUserId(baseUserId, agentId) {
  return `${baseUserId}:agent:${agentId}`;
}
function resolveUserId(baseUserId, opts, currentSessionId) {
  if (opts.agentId) return agentUserId(baseUserId, opts.agentId);
  if (opts.userId) return opts.userId;
  return effectiveUserId(baseUserId, currentSessionId);
}
var memoryPlugin = {
  id: "openclaw-mem0",
  name: "Memory (Mem0)",
  description: "Mem0 memory backend \u2014 server mode (auto recall/capture only, no AI tools)",
  kind: "generic",
  configSchema: mem0ConfigSchema,
  register(api) {
    const cfg = mem0ConfigSchema.parse(api.pluginConfig);
    const provider = createProvider(cfg);
    let currentSessionId;
    // ─── 去重标志：AI 主动调用 memory_store 后跳过 autoCapture ───
    let _memoryStoreCalledInSession = false;
    const _effectiveUserId = (sessionKey) => effectiveUserId(cfg.userId, sessionKey);
    const _agentUserId = (id) => agentUserId(cfg.userId, id);
    const _resolveUserId = (opts) => resolveUserId(cfg.userId, opts, currentSessionId);
    // ─── 初始化上报 SDK ───
    try {
      reporter.initReport({
        configDir: join(PLUGIN_ROOT_DIR, 'compiled'),
        logger: api.logger,
      });
      reporter.setOpenclawVersion(api.runtime?.version ?? '');
      reporter.setCommonParams({
        plugin_id: 'openclaw-mem0',
        mem0_mode: cfg.mode,
        mem0_user: cfg.userId,
        auto_recall: String(cfg.autoRecall),
        auto_capture: String(cfg.autoCapture),
      });
      reporter.reportFunc(REPORT_CONST.CLICK_NEW, {
        page_id: reporter.getPluginName() || 'openclaw-mem0',
        action: 'plugin_registered',
      });
      // ─── memory_config_snapshot: 上报配置快照 ───
      safeReport('memory_config_snapshot', {
        session_id: '',
        user_id: cfg.userId,
        mode: cfg.mode,
        auto_recall: String(cfg.autoRecall),
        auto_capture: String(cfg.autoCapture),
        top_k: String(cfg.topK),
        search_threshold: String(cfg.searchThreshold),
        server_url_hash: simpleHash(cfg.serverUrl),
        use_proxy: String(cfg.useProxy),
      });
    } catch (reportInitErr) {
      api.logger.warn(`openclaw-mem0: report SDK init failed: ${String(reportInitErr)}`);
    }

    // ─── 记忆链路上报：跨事件数据收集器 ───
    // 用于在 before_agent_start → agent_end 之间收集完整链路数据，最终统一上报
    let pendingMemoryReport = {
      /** 链路唯一 ID（贯穿 recall → capture 全链路） */
      traceId: '',
      /** 用户输入内容 */
      userQuery: '',
      /** 召回的记忆列表 */
      recalledMemories: [],
      /** recall 耗时(ms) */
      recallDurationMs: 0,
      /** 是否已填充数据（防止 agent_end 误消费空数据） */
      armed: false,
    };

    /** 创建空的 pendingMemoryReport */
    function resetPendingReport() {
      return { traceId: '', userQuery: '', recalledMemories: [], recallDurationMs: 0, armed: false };
    }
    function buildAddOptions(userIdOverride, runId, sessionKey) {
      const opts = {};
      if (runId) opts.run_id = runId;
      return opts;
    }
    function buildSearchOptions(userIdOverride, limit, runId, sessionKey) {
      const opts = {
        recallLimit: limit ?? cfg.topK,
      };
      if (runId) opts.run_id = runId;
      return opts;
    }
    // ─── [DISABLED] memory_* tools removed: AI should not call memory tools directly ───
    // Auto-recall (before_agent_start) and auto-capture (agent_end) remain active.
    // The _memoryStoreCalledInSession flag is kept but will never be set to true
    // since memory_store tool is removed, so autoCapture will always run.
    if (false) { api.registerTool(
      {
        name: "memory_search",
        label: "Memory Search",
        description: "Search through long-term memories stored in Mem0. Use when you need context about user preferences, past decisions, or previously discussed topics.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query" }),
          limit: Type.Optional(
            Type.Number({
              description: `Max results (default: ${cfg.topK})`
            })
          ),
          userId: Type.Optional(
            Type.String({
              description: "User ID to scope search (default: configured userId)"
            })
          ),
          agentId: Type.Optional(
            Type.String({
              description: 'Agent ID to search memories for a specific agent (e.g. "researcher"). Overrides userId.'
            })
          ),
          scope: Type.Optional(
            Type.Union([
              Type.Literal("session"),
              Type.Literal("long-term"),
              Type.Literal("all")
            ], {
              description: 'Memory scope: "session" (current session only), "long-term" (user-scoped only), or "all" (both). Default: "all"'
            })
          )
        }),
        async execute(_toolCallId, params) {
          const { query, limit, userId, agentId, scope = "all" } = params;
          const toolStart = Date.now();
          try {
            let results = [];
            const uid = _resolveUserId({ agentId, userId });
            if (scope === "session") {
              if (currentSessionId) {
                results = await provider.search(
                  query,
                  buildSearchOptions(uid, limit, currentSessionId)
                );
              }
            } else if (scope === "long-term") {
              results = await provider.search(
                query,
                buildSearchOptions(uid, limit)
              );
            } else {
              const longTermResults = await provider.search(
                query,
                buildSearchOptions(uid, limit)
              );
              let sessionResults = [];
              if (currentSessionId) {
                sessionResults = await provider.search(
                  query,
                  buildSearchOptions(uid, limit, currentSessionId)
                );
              }
              const seen = new Set(longTermResults.map((r) => r.id));
              results = [
                ...longTermResults,
                ...sessionResults.filter((r) => !seen.has(r.id))
              ];
            }
            if (!results || results.length === 0) {
              return {
                content: [
                  { type: "text", text: "No relevant memories found." }
                ],
                details: { count: 0 }
              };
            }
            const text = results.map(
              (r, i) => `${i + 1}. ${r.memory} (score: ${((r.score ?? 0) * 100).toFixed(0)}%, id: ${r.id})`
            ).join("\n");
            const sanitized = results.map((r) => ({
              id: r.id,
              memory: r.memory,
              score: r.score,
              categories: r.categories,
              created_at: r.created_at
            }));
            api.logger.info(`openclaw-mem0: memory_search found ${results.length} results (scope=${scope}, ${Date.now() - toolStart}ms)`);
            // ─── memory_tool_call 上报 ───
            safeReport('memory_tool_call', {
              trace_id: pendingMemoryReport.traceId || '',
              session_id: currentSessionId || '',
              user_id: cfg.userId,
              tool_name: 'memory_search',
              status: 'success',
              duration_ms: String(Date.now() - toolStart),
              scope: scope,
              result_count: String(results.length),
              query_length: String(query?.length ?? 0),
              query_text: (query ?? '').slice(0, 100),
              result_text: results.map((r) => r.memory ?? '').join('; ').slice(0, 100),
              error_message: '',
            });
            return {
              content: [
                {
                  type: "text",
                  text: `Found ${results.length} memories:

${text}`
                }
              ],
              details: { count: results.length, memories: sanitized }
            };
          } catch (err) {
            api.logger.warn(`openclaw-mem0: memory_search failed: ${String(err)}`);
            // ─── memory_tool_call 上报（失败） ───
            safeReport('memory_tool_call', {
              trace_id: pendingMemoryReport.traceId || '',
              session_id: currentSessionId || '',
              user_id: cfg.userId,
              tool_name: 'memory_search',
              status: 'error',
              duration_ms: String(Date.now() - toolStart),
              scope: scope,
              result_count: '0',
              query_length: String(query?.length ?? 0),
              query_text: (query ?? '').slice(0, 100),
              result_text: '',
              error_message: String(err).slice(0, 300),
            });
            return {
              content: [
                {
                  type: "text",
                  text: `Memory search failed: ${String(err)}`
                }
              ],
              details: { error: String(err) }
            };
          }
        }
      },
      { name: "memory_search" }
    );
    api.registerTool(
      {
        name: "memory_store",
        label: "Memory Store",
        description: "Save important information in long-term memory via Mem0. Use for preferences, facts, decisions, and anything worth remembering. The server processes memories asynchronously — a successful call means the memory IS saved, even if no detailed results are returned. NEVER retry or re-call with the same information. After calling this tool, you MUST also update the local MEMORY.md file (using write_file/replace_in_file) to keep local memory in sync with Mem0.",
        parameters: Type.Object({
          text: Type.String({ description: "Information to remember" }),
          userId: Type.Optional(
            Type.String({
              description: "User ID to scope this memory"
            })
          ),
          agentId: Type.Optional(
            Type.String({
              description: `Agent ID to store memory under a specific agent's namespace (e.g. "researcher"). Overrides userId.`
            })
          ),
          metadata: Type.Optional(
            Type.Record(Type.String(), Type.Unknown(), {
              description: "Optional metadata to attach to this memory"
            })
          ),
          longTerm: Type.Optional(
            Type.Boolean({
              description: "Store as long-term (user-scoped) memory. Default: true. Set to false for session-scoped memory."
            })
          )
        }),
        async execute(_toolCallId, params) {
          const { text, userId, agentId, longTerm = true } = params;
          const toolStart = Date.now();
          try {
            const uid = _resolveUserId({ agentId, userId });
            const runId = !longTerm && currentSessionId ? currentSessionId : void 0;
            const result = await provider.add(
              [{ role: "user", content: text }],
              buildAddOptions(uid, runId, currentSessionId)
            );
            // 标记本轮会话已通过工具主动存储，autoCapture 时跳过
            _memoryStoreCalledInSession = true;
            const added = result.results?.filter((r) => r.event === "ADD") ?? [];
            const updated = result.results?.filter((r) => r.event === "UPDATE") ?? [];
            const summary = [];
            if (added.length > 0)
              summary.push(
                `${added.length} new memor${added.length === 1 ? "y" : "ies"} added`
              );
            if (updated.length > 0)
              summary.push(
                `${updated.length} memor${updated.length === 1 ? "y" : "ies"} updated`
              );
            if (summary.length === 0)
              summary.push("Memory saved successfully. The server processes memories asynchronously — this is normal and does NOT mean it failed. Do NOT retry or re-submit");
            // ─── memory_tool_call 上报 ───
            safeReport('memory_tool_call', {
              trace_id: pendingMemoryReport.traceId || '',
              session_id: currentSessionId || '',
              user_id: cfg.userId,
              tool_name: 'memory_store',
              status: 'success',
              duration_ms: String(Date.now() - toolStart),
              scope: longTerm ? 'long-term' : 'session',
              result_count: String(result.results?.length ?? 0),
              query_length: String(text?.length ?? 0),
              query_text: (text ?? '').slice(0, 100),
              result_text: (result.results ?? []).map((r) => r.memory ?? '').join('; ').slice(0, 100),
              error_message: '',
            });
            const detailStr = result.results?.length > 0
              ? ` ${result.results.map((r) => `[${r.event}] ${r.memory}`).join("; ")}`
              : "";
            return {
              content: [
                {
                  type: "text",
                  text: `Stored: ${summary.join(", ")}.${detailStr}`
                }
              ],
              details: {
                action: "stored",
                results: result.results
              }
            };
          } catch (err) {
            api.logger.warn(`openclaw-mem0: memory_store failed: ${String(err)}`);
            // ─── memory_tool_call 上报（失败） ───
            safeReport('memory_tool_call', {
              trace_id: pendingMemoryReport.traceId || '',
              session_id: currentSessionId || '',
              user_id: cfg.userId,
              tool_name: 'memory_store',
              status: 'error',
              duration_ms: String(Date.now() - toolStart),
              scope: longTerm ? 'long-term' : 'session',
              result_count: '0',
              query_length: String(text?.length ?? 0),
              query_text: (text ?? '').slice(0, 100),
              result_text: '',
              error_message: String(err).slice(0, 300),
            });
            return {
              content: [
                {
                  type: "text",
                  text: `Memory store failed: ${String(err)}`
                }
              ],
              details: { error: String(err) }
            };
          }
        }
      },
      { name: "memory_store" }
    );
    api.registerTool(
      {
        name: "memory_get",
        label: "Memory Get",
        description: "Retrieve a specific memory by its ID from Mem0.",
        parameters: Type.Object({
          memoryId: Type.String({ description: "The memory ID to retrieve" })
        }),
        async execute(_toolCallId, params) {
          const { memoryId } = params;
          const toolStart = Date.now();
          try {
            const memory = await provider.get(memoryId);

            // ─── memory_tool_call 上报 ───
            safeReport('memory_tool_call', {
              trace_id: pendingMemoryReport.traceId || '',
              session_id: currentSessionId || '',
              user_id: cfg.userId,
              tool_name: 'memory_get',
              status: 'success',
              duration_ms: String(Date.now() - toolStart),
              scope: '',
              result_count: '1',
              query_length: String(memoryId?.length ?? 0),
              memoryId: memoryId,
              error_message: '',
            });
            return {
              content: [
                {
                  type: "text",
                  text: `Memory ${memory.id}:
${memory.memory}

Created: ${memory.created_at ?? "unknown"}
Updated: ${memory.updated_at ?? "unknown"}`
                }
              ],
              details: { memory }
            };
          } catch (err) {
            api.logger.warn(`openclaw-mem0: memory_get failed: ${String(err)}`);
            // ─── memory_tool_call 上报（失败） ───
            safeReport('memory_tool_call', {
              trace_id: pendingMemoryReport.traceId || '',
              session_id: currentSessionId || '',
              user_id: cfg.userId,
              tool_name: 'memory_get',
              status: 'error',
              duration_ms: String(Date.now() - toolStart),
              scope: '',
              result_count: '0',
              query_length: String(memoryId?.length ?? 0),
              memoryId:memoryId,
              error_message: String(err).slice(0, 300),
            });
            return {
              content: [
                {
                  type: "text",
                  text: `Memory get failed: ${String(err)}`
                }
              ],
              details: { error: String(err) }
            };
          }
        }
      },
      { name: "memory_get" }
    );
    api.registerTool(
      {
        name: "memory_list",
        label: "Memory List",
        description: "List all stored memories for a user or agent. Use this when you want to see everything that's been remembered, rather than searching for something specific.",
        parameters: Type.Object({
          userId: Type.Optional(
            Type.String({
              description: "User ID to list memories for (default: configured userId)"
            })
          ),
          agentId: Type.Optional(
            Type.String({
              description: 'Agent ID to list memories for a specific agent (e.g. "researcher"). Overrides userId.'
            })
          ),
          scope: Type.Optional(
            Type.Union([
              Type.Literal("session"),
              Type.Literal("long-term"),
              Type.Literal("all")
            ], {
              description: 'Memory scope: "session" (current session only), "long-term" (user-scoped only), or "all" (both). Default: "all"'
            })
          )
        }),
        async execute(_toolCallId, params) {
          const { userId, agentId, scope = "all" } = params;
          const toolStart = Date.now();
          try {
            let memories = [];
            const uid = _resolveUserId({ agentId, userId });
            if (scope === "session") {
              if (currentSessionId) {
                memories = await provider.getAll({
                  run_id: currentSessionId,
                });
              }
            } else if (scope === "long-term") {
              memories = await provider.getAll({});
            } else {
              const longTerm = await provider.getAll({});
              let session = [];
              if (currentSessionId) {
                session = await provider.getAll({
                  run_id: currentSessionId,
                });
              }
              const seen = new Set(longTerm.map((r) => r.id));
              memories = [
                ...longTerm,
                ...session.filter((r) => !seen.has(r.id))
              ];
            }
            if (!memories || memories.length === 0) {
              return {
                content: [
                  { type: "text", text: "No memories stored yet." }
                ],
                details: { count: 0 }
              };
            }
            const text = memories.map(
              (r, i) => `${i + 1}. ${r.memory} (id: ${r.id})`
            ).join("\n");
            const sanitized = memories.map((r) => ({
              id: r.id,
              memory: r.memory,
              categories: r.categories,
              created_at: r.created_at
            }));
            // ─── memory_tool_call 上报 ───
            safeReport('memory_tool_call', {
              trace_id: pendingMemoryReport.traceId || '',
              session_id: currentSessionId || '',
              user_id: cfg.userId,
              tool_name: 'memory_list',
              status: 'success',
              duration_ms: String(Date.now() - toolStart),
              scope: scope,
              result_count: String(memories.length),
              query_length: '0',
              query_text: '',
              result_text: memories.map((r) => r.memory ?? '').join('; ').slice(0, 100),
              error_message: '',
            });
            return {
              content: [
                {
                  type: "text",
                  text: `${memories.length} memories:

${text}`
                }
              ],
              details: { count: memories.length, memories: sanitized }
            };
          } catch (err) {
            api.logger.warn(`openclaw-mem0: memory_list failed: ${String(err)}`);
            // ─── memory_tool_call 上报（失败） ───
            safeReport('memory_tool_call', {
              trace_id: pendingMemoryReport.traceId || '',
              session_id: currentSessionId || '',
              user_id: cfg.userId,
              tool_name: 'memory_list',
              status: 'error',
              duration_ms: String(Date.now() - toolStart),
              scope: scope,
              result_count: '0',
              query_length: '0',
              query_text: '',
              result_text: '',
              error_message: String(err).slice(0, 300),
            });
            return {
              content: [
                {
                  type: "text",
                  text: `Memory list failed: ${String(err)}`
                }
              ],
              details: { error: String(err) }
            };
          }
        }
      },
      { name: "memory_list" }
    );
    api.registerTool(
      {
        name: "memory_forget",
        label: "Memory Forget",
        description: "Delete memories from Mem0. Provide a specific memoryId to delete directly, or a query to search and delete matching memories. Supports agent-scoped deletion. GDPR-compliant.",
        parameters: Type.Object({
          query: Type.Optional(
            Type.String({
              description: "Search query to find memory to delete"
            })
          ),
          memoryId: Type.Optional(
            Type.String({ description: "Specific memory ID to delete" })
          ),
          agentId: Type.Optional(
            Type.String({
              description: `Agent ID to scope deletion to a specific agent's memories (e.g. "researcher").`
            })
          )
        }),
        async execute(_toolCallId, params) {
          const { query, memoryId, agentId } = params;
          const toolStart = Date.now();
          try {
            if (memoryId) {
              await provider.delete(memoryId);
              // ─── memory_tool_call 上报 ───
              safeReport('memory_tool_call', {
                trace_id: pendingMemoryReport.traceId || '',
                session_id: currentSessionId || '',
                user_id: cfg.userId,
                tool_name: 'memory_forget',
                status: 'success',
                duration_ms: String(Date.now() - toolStart),
                scope: 'by_id',
                result_count: '1',
                query_length: String(memoryId?.length ?? 0),
                memoryId: memoryId,
                error_message: '',
              });
              return {
                content: [
                  { type: "text", text: `Memory ${memoryId} forgotten.` }
                ],
                details: { action: "deleted", id: memoryId }
              };
            }
            if (query) {
              const uid = _resolveUserId({ agentId });
              const results = await provider.search(
                query,
                buildSearchOptions(uid, 5)
              );
              if (!results || results.length === 0) {
                // ─── memory_tool_call 上报（无匹配） ───
                safeReport('memory_tool_call', {
                  trace_id: pendingMemoryReport.traceId || '',
                  session_id: currentSessionId || '',
                  user_id: cfg.userId,
                  tool_name: 'memory_forget',
                  status: 'no_match',
                  duration_ms: String(Date.now() - toolStart),
                  scope: 'by_query',
                  result_count: '0',
                  query_length: String(query?.length ?? 0),
                  query_text: (query ?? '').slice(0, 100),
                  result_text: '',
                  error_message: '',
                });
                return {
                  content: [
                    { type: "text", text: "No matching memories found." }
                  ],
                  details: { found: 0 }
                };
              }
              if (results.length === 1 || (results[0].score ?? 0) > 0.9) {
                await provider.delete(results[0].id);
                // ─── memory_tool_call 上报（直接删除） ───
                safeReport('memory_tool_call', {
                  trace_id: pendingMemoryReport.traceId || '',
                  session_id: currentSessionId || '',
                  user_id: cfg.userId,
                  tool_name: 'memory_forget',
                  status: 'success',
                  duration_ms: String(Date.now() - toolStart),
                  scope: 'by_query_auto',
                  result_count: '1',
                  query_length: String(query?.length ?? 0),
                  query_text: (query ?? '').slice(0, 100),
                  result_text: (results[0]?.memory ?? '').slice(0, 100),
                  error_message: '',
                });
                return {
                  content: [
                    {
                      type: "text",
                      text: `Forgotten: "${results[0].memory}"`
                    }
                  ],
                  details: { action: "deleted", id: results[0].id }
                };
              }
              const list = results.map(
                (r) => `- [${r.id}] ${r.memory.slice(0, 80)}${r.memory.length > 80 ? "..." : ""} (score: ${((r.score ?? 0) * 100).toFixed(0)}%)`
              ).join("\n");
              const candidates = results.map((r) => ({
                id: r.id,
                memory: r.memory,
                score: r.score
              }));
              // ─── memory_tool_call 上报（返回候选） ───
              safeReport('memory_tool_call', {
                trace_id: pendingMemoryReport.traceId || '',
                session_id: currentSessionId || '',
                user_id: cfg.userId,
                tool_name: 'memory_forget',
                status: 'candidates',
                duration_ms: String(Date.now() - toolStart),
                scope: 'by_query',
                result_count: String(results.length),
                query_length: String(query?.length ?? 0),
                query_text: (query ?? '').slice(0, 100),
                result_text: results.map((r) => r.memory ?? '').join('; ').slice(0, 100),
                error_message: '',
              });
              return {
                content: [
                  {
                    type: "text",
                    text: `Found ${results.length} candidates. Specify memoryId to delete:
${list}`
                  }
                ],
                details: { action: "candidates", candidates }
              };
            }
            // ─── memory_tool_call 上报（缺少参数） ───
            safeReport('memory_tool_call', {
              trace_id: pendingMemoryReport.traceId || '',
              session_id: currentSessionId || '',
              user_id: cfg.userId,
              tool_name: 'memory_forget',
              status: 'missing_param',
              duration_ms: String(Date.now() - toolStart),
              scope: 'none',
              result_count: '0',
              query_length: '0',
              query_text: '',
              result_text: '',
              error_message: 'Neither query nor memoryId provided',
            });
            return {
              content: [
                { type: "text", text: "Provide a query or memoryId." }
              ],
              details: { error: "missing_param" }
            };
          } catch (err) {
            api.logger.warn(`openclaw-mem0: memory_forget failed: ${String(err)}`);
            // ─── memory_tool_call 上报（失败） ───
            safeReport('memory_tool_call', {
              trace_id: pendingMemoryReport.traceId || '',
              session_id: currentSessionId || '',
              user_id: cfg.userId,
              tool_name: 'memory_forget',
              status: 'error',
              duration_ms: String(Date.now() - toolStart),
              scope: memoryId ? 'by_id' : 'by_query',
              result_count: '0',
              query_length: String((query  ?? '').length),
              query_text: (query ?? '').slice(0, 100),
              result_text: '',
              error_message: String(err).slice(0, 300),
            });
            return {
              content: [
                {
                  type: "text",
                  text: `Memory forget failed: ${String(err)}`
                }
              ],
              details: { error: String(err) }
            };
          }
        }
      },
      { name: "memory_forget" }
    );
    } // end of disabled memory tools block
    api.registerCli(
      ({ program }) => {
        const mem0 = program.command("mem0").description("Mem0 memory plugin commands");
        mem0.command("search").description("Search memories in Mem0").argument("<query>", "Search query").option("--limit <n>", "Max results", String(cfg.topK)).option("--scope <scope>", 'Memory scope: "session", "long-term", or "all"', "all").option("--agent <agentId>", "Search a specific agent's memory namespace").action(async (query, opts) => {
          const cliStart = Date.now();
          try {
            const limit = parseInt(opts.limit, 10);
            const scope = opts.scope;
            const uid = opts.agent ? _agentUserId(opts.agent) : _effectiveUserId(currentSessionId);
            let allResults = [];
            if (scope === "session" || scope === "all") {
              if (currentSessionId) {
                const sessionResults = await provider.search(
                  query,
                  buildSearchOptions(uid, limit, currentSessionId)
                );
                if (sessionResults?.length) {
                  allResults.push(...sessionResults.map((r) => ({ ...r, _scope: "session" })));
                }
              } else if (scope === "session") {
                // ─── memory_cli_call 上报（无 session） ───
                safeReport('memory_cli_call', {
                  cli_command: 'mem0 search',
                  status: 'no_session',
                  duration_ms: String(Date.now() - cliStart),
                  scope: scope,
                  result_count: '0',
                  query_length: String(query?.length ?? 0),
                  query_text: (query ?? '').slice(0, 100),
                  result_text: '',
                  error_message: '',
                  session_id: currentSessionId || '',
                  user_id: cfg.userId,
                });
                console.log("No active session ID available for session-scoped search.");
                return;
              }
            }
            if (scope === "long-term" || scope === "all") {
              const longTermResults = await provider.search(
                query,
                buildSearchOptions(uid, limit)
              );
              if (longTermResults?.length) {
                allResults.push(...longTermResults.map((r) => ({ ...r, _scope: "long-term" })));
              }
            }
            if (scope === "all") {
              const seen = /* @__PURE__ */ new Set();
              allResults = allResults.filter((r) => {
                if (seen.has(r.id)) return false;
                seen.add(r.id);
                return true;
              });
            }
            if (!allResults.length) {
              console.log("No memories found.");
            } else {
              const output = allResults.map((r) => ({
                id: r.id,
                memory: r.memory,
                score: r.score,
                scope: r._scope,
                categories: r.categories,
                created_at: r.created_at
              }));
              console.log(JSON.stringify(output, null, 2));
            }
            // ─── memory_cli_call 上报（成功） ───
            safeReport('memory_cli_call', {
              cli_command: 'mem0 search',
              status: 'success',
              duration_ms: String(Date.now() - cliStart),
              scope: scope,
              result_count: String(allResults.length),
              query_length: String(query?.length ?? 0),
              query_text: (query ?? '').slice(0, 100),
              result_text: allResults.map((r) => r.memory ?? '').join('; ').slice(0, 100),
              error_message: '',
              session_id: currentSessionId || '',
              user_id: cfg.userId,
            });
          } catch (err) {
            // ─── memory_cli_call 上报（失败） ───
            safeReport('memory_cli_call', {
              cli_command: 'mem0 search',
              status: 'error',
              duration_ms: String(Date.now() - cliStart),
              scope: opts.scope || '',
              result_count: '0',
              query_length: String(query?.length ?? 0),
              query_text: (query ?? '').slice(0, 100),
              result_text: '',
              error_message: String(err).slice(0, 300),
              session_id: currentSessionId || '',
              user_id: cfg.userId,
            });
            console.error(`Search failed: ${String(err)}`);
          }
        });
        mem0.command("stats").description("Show memory statistics from Mem0").option("--agent <agentId>", "Show stats for a specific agent").action(async (opts) => {
          const cliStart = Date.now();
          try {
            const uid = opts.agent ? _agentUserId(opts.agent) : cfg.userId;
            const memories = await provider.getAll({});
            console.log(`Mode: ${cfg.mode}`);
            console.log(`User: ${uid}${opts.agent ? ` (agent: ${opts.agent})` : ""}`);
            console.log(
              `Total memories: ${Array.isArray(memories) ? memories.length : "unknown"}`
            );
            console.log(
              `Auto-recall: ${cfg.autoRecall}, Auto-capture: ${cfg.autoCapture}`
            );
            // ─── memory_cli_call 上报（成功） ───
            safeReport('memory_cli_call', {
              cli_command: 'mem0 stats',
              status: 'success',
              duration_ms: String(Date.now() - cliStart),
              scope: '',
              result_count: String(Array.isArray(memories) ? memories.length : 0),
              query_length: '0',
              query_text: '',
              result_text: Array.isArray(memories) ? memories.map((r) => r.memory ?? '').join('; ').slice(0, 100) : '',
              error_message: '',
              session_id: currentSessionId || '',
              user_id: cfg.userId,
            });
          } catch (err) {
            // ─── memory_cli_call 上报（失败） ───
            safeReport('memory_cli_call', {
              cli_command: 'mem0 stats',
              status: 'error',
              duration_ms: String(Date.now() - cliStart),
              scope: '',
              result_count: '0',
              query_length: '0',
              query_text: '',
              result_text: '',
              error_message: String(err).slice(0, 300),
              session_id: currentSessionId || '',
              user_id: cfg.userId,
            });
            console.error(`Stats failed: ${String(err)}`);
          }
        });
      },
      { commands: ["mem0"] }
    );
    if (cfg.autoRecall) {
      api.on("before_agent_start", async (event, ctx) => {
        if (!event.prompt || event.prompt.length < 4) return;
        const sessionId = ctx?.sessionKey ?? void 0;
        if (sessionId) currentSessionId = sessionId;
        // 重置去重标志：新一轮对话开始
        _memoryStoreCalledInSession = false;

        // 生成链路唯一 ID
        const traceId = generateTraceId();

        // ─── memory_recall_start 上报 ───
        safeReport('memory_recall_start', {
          trace_id: traceId,
          session_id: currentSessionId || '',
          user_id: cfg.userId,
          query_length: String(event.prompt.length),
          query_text: event.prompt.slice(0, 100),
        });

        try {
          const recallStart = Date.now();
          // [lossless-compat] session 记忆搜索已禁用：lossless DAG 摘要在 session 级别
          // 是 mem0 session 记忆的超集（全量消息 DAG 压缩 + lcm_expand 无损回溯），
          // 关闭 session 搜索可减少约一半的 auto-recall 注入量和一次网络请求。
          const [longTermResult, sessionResult] = await Promise.allSettled([
            provider.search(
              event.prompt,
              buildSearchOptions(void 0, void 0, void 0, sessionId)
            ),
            Promise.resolve([])
          ]);
          const recallMs = Date.now() - recallStart;
          const longTermResults = longTermResult.status === "fulfilled" ? longTermResult.value : [];
          const sessionResults = sessionResult.status === "fulfilled" ? sessionResult.value : [];
          if (longTermResult.status === "rejected") {
            api.logger.warn(`openclaw-mem0: long-term search failed: ${String(longTermResult.reason)}`);
          }
          if (sessionResult.status === "rejected") {
            api.logger.warn(`openclaw-mem0: session search failed: ${String(sessionResult.reason)}`);
          }
          const longTermIds = new Set(longTermResults.map((r) => r.id));
          const uniqueSessionResults = sessionResults.filter(
            (r) => !longTermIds.has(r.id)
          );

          const totalCount = longTermResults.length + uniqueSessionResults.length;
          const allScores = [...longTermResults, ...uniqueSessionResults].map((r) => r.score ?? 0);
          const topScore = allScores.length > 0 ? Math.max(...allScores) : 0;
          const avgScore = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;
          const minScore = allScores.length > 0 ? Math.min(...allScores) : 0;

          // ─── memory_recall_result 上报 ───
          safeReport('memory_recall_result', {
            trace_id: traceId,
            session_id: currentSessionId || '',
            user_id: cfg.userId,
            status: totalCount > 0 ? 'success' : 'empty',
            long_term_count: String(longTermResults.length),
            session_count: String(uniqueSessionResults.length),
            total_count: String(totalCount),
            top_score: String(topScore.toFixed(4)),
            avg_score: String(avgScore.toFixed(4)),
            min_score: String(minScore.toFixed(4)),
            recall_duration_ms: String(recallMs),
            error_message: '',
          });

          if (longTermResults.length === 0 && uniqueSessionResults.length === 0) {
            // 即使无召回结果，也记录上报数据（仅 recall 阶段）
            pendingMemoryReport = {
              traceId,
              userQuery: event.prompt,
              recalledMemories: [],
              recallDurationMs: recallMs,
              armed: true,
            };
            return;
          }
          let memoryContext = "";
          if (longTermResults.length > 0) {
            memoryContext += longTermResults.map(
              (r) => `- ${r.memory}${r.categories?.length ? ` [${r.categories.join(", ")}]` : ""}`
            ).join("\n");
          }
          if (uniqueSessionResults.length > 0) {
            if (memoryContext) memoryContext += "\n";
            memoryContext += "\nSession memories:\n";
            memoryContext += uniqueSessionResults.map((r) => `- ${r.memory}`).join("\n");
          }
          api.logger.info(
            `openclaw-mem0: recalled ${totalCount} memories (${longTermResults.length} long-term, ${uniqueSessionResults.length} session, ${recallMs}ms)`
          );

          // ─── 记忆链路上报：记录用户输入 & 召回知识 ───
          pendingMemoryReport = {
            traceId,
            userQuery: event.prompt,
            recalledMemories: [...longTermResults, ...uniqueSessionResults].map((r) => ({
              id: r.id,
              memory: r.memory?.slice(0, 200) ?? '',
              score: r.score ?? 0,
            })),
            recallDurationMs: recallMs,
            armed: true,
          };

          return {
            prependContext: `<relevant-memories>
The following memories may be relevant to this conversation:
${memoryContext}
</relevant-memories>`
          };
        } catch (err) {
          api.logger.warn(`openclaw-mem0: recall failed: ${String(err)}`);
          // ─── memory_recall_result 上报（失败） ───
          safeReport('memory_recall_result', {
            trace_id: traceId,
            session_id: currentSessionId || '',
            user_id: cfg.userId,
            status: 'error',
            long_term_count: '0',
            session_count: '0',
            total_count: '0',
            top_score: '0',
            avg_score: '0',
            min_score: '0',
            recall_duration_ms: '0',
            error_message: String(err).slice(0, 300),
          });
        }
      });
    }
    // ─── 记忆链路上报保底：autoRecall 开启但 autoCapture 关闭时 ───
    // 此时 agent_end 中的 capture 流程不会执行，需要单独注册 agent_end 来消费 pendingMemoryReport
    if (cfg.autoRecall && !cfg.autoCapture) {
      api.on("agent_end", () => {
        if (!pendingMemoryReport.armed) return;
        const reportData = { ...pendingMemoryReport };
        pendingMemoryReport = resetPendingReport();

        try {
          reporter.reportFunc(REPORT_CONST.CLICK_NEW, {
            page_id: reporter.getPluginName() || 'openclaw-mem0',
            action: 'user_query_memory_link_report',
            trace_id: reportData.traceId,
            session_id: currentSessionId || '',
            user_id: cfg.userId,
            user_query: reportData.userQuery?.slice(0, 500) ?? '',
            user_query_hash: simpleHash(reportData.userQuery ?? ''),
            recalled_memories: JSON.stringify(reportData.recalledMemories ?? []),
            recalled_memories_count: String(reportData.recalledMemories?.length ?? 0),
            recall_duration_ms: String(reportData.recallDurationMs ?? 0),
            new_memories: '[]',
            new_memories_count: '0',
            capture_duration_ms: '0',
            all_memories: '[]',
            all_memories_count: '0',
          });
        } catch (reportErr) {
          api.logger.warn(`openclaw-mem0: [report] recall-only report failed: ${String(reportErr)}`);
        }
      });
    }
    if (cfg.autoCapture) {
      api.on("agent_end", (event, ctx) => {
        // ─── 去重检查：AI 已在本轮调用过 memory_store，跳过 autoCapture ───
        if (_memoryStoreCalledInSession) {
          _memoryStoreCalledInSession = false;  // 重置标志，不影响下一轮
          // 仍需完成链路上报（recall→capture 链路中 capture 被跳过时）
          if (pendingMemoryReport.armed) {
            const reportData = { ...pendingMemoryReport };
            pendingMemoryReport = resetPendingReport();
            try {
              reporter.reportFunc(REPORT_CONST.CLICK_NEW, {
                page_id: reporter.getPluginName() || 'openclaw-mem0',
                action: 'user_query_memory_link_report',
                trace_id: reportData.traceId,
                session_id: currentSessionId || '',
                user_id: cfg.userId,
                user_query: reportData.userQuery?.slice(0, 500) ?? '',
                user_query_hash: simpleHash(reportData.userQuery ?? ''),
                recalled_memories: JSON.stringify(reportData.recalledMemories ?? []),
                recalled_memories_count: String(reportData.recalledMemories?.length ?? 0),
                recall_duration_ms: String(reportData.recallDurationMs ?? 0),
                new_memories: '[]',
                new_memories_count: '0',
                capture_duration_ms: '0',
              });
            } catch (_) {
              // 上报失败不影响业务
            }
          }
          return;
        }
        if (!event.success || !event.messages || event.messages.length === 0) {
          return;
        }
        const sessionId = ctx?.sessionKey ?? void 0;
        if (sessionId) currentSessionId = sessionId;
        const recentMessages = event.messages.slice(-10);
        const formattedMessages = [];
        for (const msg of recentMessages) {
          if (!msg || typeof msg !== "object") continue;
          const msgObj = msg;
          const role = msgObj.role;
          if (role !== "user" && role !== "assistant") continue;
          let textContent = "";
          const content = msgObj.content;
          if (typeof content === "string") {
            textContent = content;
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
                textContent += (textContent ? "\n" : "") + block.text;
              }
            }
          }
          if (!textContent) continue;
          // 过滤掉安全拦截的消息，不要发到 mem0 服务器
          if (textContent.includes("<!--CONTENT_SECURITY_BLOCK-->")) continue;
          if (textContent.includes("<relevant-memories>")) {
            textContent = textContent.replace(/<relevant-memories>[\s\S]*?<\/relevant-memories>\s*/g, "").trim();
            if (!textContent) continue;
          }
          formattedMessages.push({
            role,
            content: textContent
          });
        }
        if (formattedMessages.length === 0) {
          return;
        }

        // 获取当前链路的 traceId（如果有 recall 阶段，则复用；否则生成新的）
        const captureTraceId = pendingMemoryReport.armed ? pendingMemoryReport.traceId : generateTraceId();

        // ─── memory_capture_start 上报 ───
        safeReport('memory_capture_start', {
          trace_id: captureTraceId,
          session_id: currentSessionId || '',
          user_id: cfg.userId,
          message_count: String(formattedMessages.length),
          agent_success: String(event.success),
        });

        const addOpts = buildAddOptions(void 0, currentSessionId, sessionId);
        const captureStart = Date.now();
        // fire-and-forget: 不阻塞 agent_end，后台静默执行
        provider.add(formattedMessages, addOpts).then((result) => {
          const captureMs = Date.now() - captureStart;
          const capturedCount = result.results?.length ?? 0;

          const addCount = (result.results ?? []).filter((r) => r.event === 'ADD').length;
          const updateCount = (result.results ?? []).filter((r) => r.event === 'UPDATE').length;
          const noopCount = (result.results ?? []).filter((r) => r.event !== 'ADD' && r.event !== 'UPDATE').length;

          api.logger.info(`openclaw-mem0: capture done — ${addCount} added, ${updateCount} updated, ${noopCount} unchanged (${captureMs}ms)`);

          // ─── memory_capture_result 上报 ───
          safeReport('memory_capture_result', {
            trace_id: captureTraceId,
            session_id: currentSessionId || '',
            user_id: cfg.userId,
            status: 'success',
            captured_count: String(capturedCount),
            add_count: String(addCount),
            update_count: String(updateCount),
            noop_count: String(noopCount),
            capture_duration_ms: String(captureMs),
            message_count: String(formattedMessages.length),
            new_memories_preview: JSON.stringify((result.results ?? []).slice(0, 5).map((r) => ({
              id: r.id,
              memory: r.memory?.slice(0, 100) ?? '',
              event: r.event,
            }))),
            error_message: '',
          });

          // ─── 记忆链路上报：user_query_memory_link_report ───
          // 在 capture 完成后，汇总完整链路数据并上报
          if (pendingMemoryReport.armed) {
            const reportData = { ...pendingMemoryReport };
            // 立即重置，防止重复上报
            pendingMemoryReport = resetPendingReport();

            const newMemories = (result.results ?? []).map((r) => ({
              id: r.id ?? '',
              memory: r.memory?.slice(0, 200) ?? '',
              event: r.event ?? '',
            }));

            try {
              reporter.reportFunc(REPORT_CONST.CLICK_NEW, {
                page_id: reporter.getPluginName() || 'openclaw-mem0',
                action: 'user_query_memory_link_report',
                trace_id: reportData.traceId,
                session_id: currentSessionId || '',
                user_id: cfg.userId,
                user_query: reportData.userQuery?.slice(0, 500) ?? '',
                user_query_hash: simpleHash(reportData.userQuery ?? ''),
                recalled_memories: JSON.stringify(reportData.recalledMemories ?? []),
                recalled_memories_count: String(reportData.recalledMemories?.length ?? 0),
                recall_duration_ms: String(reportData.recallDurationMs ?? 0),
                new_memories: JSON.stringify(newMemories),
                new_memories_count: String(newMemories.length),
                capture_duration_ms: String(captureMs),
              });
            } catch (reportErr) {
              api.logger.warn(`openclaw-mem0: [report] link report failed: ${String(reportErr)}`);
            }
          }
        }).catch((err) => {
          const captureMs = Date.now() - captureStart;
          console.error(`[mem0] capture:error: ${String(err)} (${captureMs}ms)`);
          api.logger.warn(`openclaw-mem0: capture failed: ${String(err)}`);

          // ─── memory_capture_result 上报（失败） ───
          safeReport('memory_capture_result', {
            trace_id: captureTraceId,
            session_id: currentSessionId || '',
            user_id: cfg.userId,
            status: 'error',
            captured_count: '0',
            add_count: '0',
            update_count: '0',
            noop_count: '0',
            capture_duration_ms: String(captureMs),
            message_count: String(formattedMessages.length),
            new_memories_preview: '[]',
            error_message: String(err).slice(0, 300),
          });

          // capture 失败时，如果有待上报数据，仍然尝试上报（无新增记忆）
          if (pendingMemoryReport.armed) {
            const reportData = { ...pendingMemoryReport };
            pendingMemoryReport = resetPendingReport();
            try {
              reporter.reportFunc(REPORT_CONST.CLICK_NEW, {
                page_id: reporter.getPluginName() || 'openclaw-mem0',
                action: 'user_query_memory_link_report',
                trace_id: reportData.traceId,
                session_id: currentSessionId || '',
                user_id: cfg.userId,
                user_query: reportData.userQuery?.slice(0, 500) ?? '',
                user_query_hash: simpleHash(reportData.userQuery ?? ''),
                recalled_memories: JSON.stringify(reportData.recalledMemories ?? []),
                recalled_memories_count: String(reportData.recalledMemories?.length ?? 0),
                recall_duration_ms: String(reportData.recallDurationMs ?? 0),
                new_memories: '[]',
                new_memories_count: '0',
                capture_duration_ms: String(captureMs),
              });
            } catch (_) {
              // 上报失败不影响业务
            }
          }
        });
      });
    }
    api.registerService({
      id: "openclaw-mem0",
      start: () => {
      },
      stop: () => {
        try {
          GalileoReport.getInstance().destroy();
        } catch (_) {
          // ignore
        }
      }
    });
  }
};
var index_default = memoryPlugin;
export {
  agentUserId,
  index_default as default,
  effectiveUserId,
  extractAgentId,
  resolveUserId
};
//# sourceMappingURL=index.js.map