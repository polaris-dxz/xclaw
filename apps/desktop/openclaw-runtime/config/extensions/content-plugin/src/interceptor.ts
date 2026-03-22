import { SessionType } from "./types";
import type { InterceptorConfig } from "./types";
import {
  extractLastUserMessage,
  extractAssistantContent,
  sliceText,
  checkSlicesParallel,
  generateTraceparent,
  generateTraceId,
} from "./utils";
import { stripPromptMetadata } from "./service";
import { checkContentSecurity } from "./security";
import {
  getSessionId,
  ensureQAIDForTurn,
  markSessionBlocked,
  isSessionBlocked,
  clearSessionBlocked,
  addBlockedContent,
  sanitizeMessages,
} from "./session";
import {
  getExternalTraceId,
  getCurrentAgentCtx,
  getCurrentAgentSpanId,
  getCurrentLlmAuditContext,
  consumePendingChatSpanCallback,
} from "./state";


const PROMPT_MAX_LENGTH = 4000;

const OUTPUT_MAX_LENGTH = 120;

// ==================== 拦截器全局状态管理 ====================

const FETCH_INTERCEPTOR_STATE = Symbol.for("openclaw.contentSecurity.fetchInterceptorState");

interface FetchInterceptorState {
  installed: boolean;
  setupAttempts: number;
  triggerCount: number;
  llmRequestCount: number;
  outputAuditEndCount: number;
}

type GlobalWithFetchInterceptorState = typeof globalThis & {
  [FETCH_INTERCEPTOR_STATE]?: FetchInterceptorState;
};

const getFetchInterceptorState = (): FetchInterceptorState => {
  const globalState = globalThis as GlobalWithFetchInterceptorState;
  if (!globalState[FETCH_INTERCEPTOR_STATE]) {
    globalState[FETCH_INTERCEPTOR_STATE] = {
      installed: false,
      setupAttempts: 0,
      triggerCount: 0,
      llmRequestCount: 0,
      outputAuditEndCount: 0,
    };
  }
  return globalState[FETCH_INTERCEPTOR_STATE]!;
};

const logInterceptorDebug = (phase: string, data: Record<string, unknown>): void => {
  console.log(`[content-security] ${phase}`, data);
};
// ==================== 日志工具 ====================

// ==================== 核心：fetch 拦截器安装函数 ====================

export const setupFetchInterceptor = (config: InterceptorConfig, logTag: string = ""): void => {
  const interceptorState = getFetchInterceptorState();
  interceptorState.setupAttempts += 1;

  if (interceptorState.installed) {
    logInterceptorDebug("fetch_interceptor_install_skip", {
      setupAttempts: interceptorState.setupAttempts,
      triggerCount: interceptorState.triggerCount,
      llmRequestCount: interceptorState.llmRequestCount,
      outputAuditEndCount: interceptorState.outputAuditEndCount,
    });
    return;
  }

  const { api, client, enableLogging, shieldEndpoint } = config;

  const originalFetch = globalThis.fetch;

  const newFetch = async function (this: any, ...args: any[]) {
    const triggerSeq = interceptorState.triggerCount + 1;
    interceptorState.triggerCount = triggerSeq;

    const url = args[0]?.toString() || "";
    const options = args[1] || {};


    const parentCtx = getCurrentAgentCtx() ?? undefined;

    if (shieldEndpoint && url.includes(shieldEndpoint)) {
      return originalFetch.apply(this, args as any);
    }

    // ==================== 生成链路追踪信息 ====================

    const roundTraceId = getExternalTraceId() || generateTraceId();

    const currentSpanId = getCurrentAgentSpanId() ?? undefined;

    const { traceparent } = generateTraceparent(roundTraceId, currentSpanId);

    // ==================== 获取审核上下文 ====================

    const runtimeAuditCtx = getCurrentLlmAuditContext();
    const sessionKey = runtimeAuditCtx?.sessionKey || `fetch:${url}`;
    const turnKey = runtimeAuditCtx?.turnKey || roundTraceId;

    // ==================== 请求体解析与输入审核 ====================

    let jsonBody: any;  // 解析后的 JSON 请求体（如果是 JSON 格式的话）

    if (options.body) {
      let rawBody: string | undefined;

      // 将请求体统一转为字符串，支持 string / Uint8Array / ArrayBuffer 三种格式
      if (typeof options.body === "string") {
        rawBody = options.body;
      } else if (options.body instanceof Uint8Array || options.body instanceof ArrayBuffer) {
        rawBody = new TextDecoder().decode(options.body);
      }

      // 尝试将原始字符串解析为 JSON
      if (rawBody) {
        try {
          jsonBody = JSON.parse(rawBody);
        } catch {
          // 不是 JSON 请求体（如 FormData、纯文本），跳过审核
        }
      }

      // 如果成功解析为 JSON，开始进行输入侧的处理
      if (jsonBody) {
        // 提取最后一条用户消息（即当前轮次用户的输入）
        const messagesToModerate = extractLastUserMessage(jsonBody);

        // ==================== 清洗历史消息 ====================
        if (Array.isArray(jsonBody.messages)) {
          // 找到最后一条 user 消息的索引，清洗时跳过它（当前输入不需要清洗）
          let lastUserMsgIndex = -1;
          for (let i = jsonBody.messages.length - 1; i >= 0; i--) {
            if (jsonBody.messages[i].role === "user") {
              lastUserMsgIndex = i;
              break;
            }
          }

          // sanitizeMessages 会将历史消息中曾被阻断的内容替换为安全占位符
          const sanitizedCount = sanitizeMessages(jsonBody.messages, lastUserMsgIndex);

          if (sanitizedCount > 0) {
            // 清洗后需要将修改后的 messages 重新序列化回 options.body
            const newBody = JSON.stringify(jsonBody);

            // 根据原始 body 的类型，用对应格式写回
            if (typeof options.body === "string") {
              options.body = newBody;
            } else if (options.body instanceof Uint8Array) {
              options.body = new TextEncoder().encode(newBody);
            } else if (options.body instanceof ArrayBuffer) {
              const encoded = new TextEncoder().encode(newBody);
              options.body = encoded.buffer;
            }

            // 更新 args[1] 以确保修改生效（因为 options 可能是 args[1] 的浅拷贝）
            args[1] = options;
          }
        }

        if (isSessionBlocked(sessionKey)) {
          if (messagesToModerate.length > 0) {
            clearSessionBlocked(sessionKey);
          } else {
            const blockMessage = `<!--CONTENT_SECURITY_BLOCK-->抱歉该任务处理异常，请更换任务再尝试，为保障使用，该问答将在3秒被删除。`;

            const sseChunk = JSON.stringify({
              id: `block-${Date.now()}`,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: "content-security",
              choices: [{
                index: 0,
                delta: { role: "assistant", content: blockMessage },
                finish_reason: "stop",
              }],
            });
            const sseBody = `data: ${sseChunk}\n\ndata: [DONE]\n\n`;

            return new Response(sseBody, {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
              },
            });
          }
        }

        if (messagesToModerate.length > 0) {
          const msg = messagesToModerate[0];

          const sessionId = getSessionId(sessionKey);
          const qaid = ensureQAIDForTurn(sessionKey, turnKey);

          const slices = sliceText(msg.content, PROMPT_MAX_LENGTH);

          // 安全修复：遍历所有分片进行审核，防止超长内容截断绕过。
          // 只对第一个分片做 stripPromptMetadata（元数据前缀只存在于消息开头）。
          // 性能优化：prompt 类审核所有分片均为 SessionType.QUESTION，无顺序依赖，
          // 使用 checkSlicesParallel 并发审核（含并发上限控制和批次间短路优化）。
          const inputBlocked = await checkSlicesParallel(
            slices,
            (slice, i) => {
              const contentToCheck = i === 0 ? stripPromptMetadata(slice) : slice;
              return checkContentSecurity(
                api,
                client,
                "prompt",
                [{ Data: contentToCheck, MediaType: "Text" }],
                sessionId,
                SessionType.QUESTION,
                "llm_request",
                enableLogging,
                logTag,
                qaid,
                parentCtx,
              );
            },
          );

          if (inputBlocked) {
            // 标记会话为阻断状态（安全违规）
            markSessionBlocked(sessionKey);
            // 记录被阻断的内容，供后续 sanitizeMessages 清洗使用
            addBlockedContent(msg.content);

            const blockMessage = `<!--CONTENT_SECURITY_BLOCK-->抱歉该任务处理异常，请更换任务再尝试，为保障使用，该问答将在3秒后被删除。`;

            const sseChunk = JSON.stringify({
              id: `block-${Date.now()}`,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: "content-security",
              choices: [{
                index: 0,
                delta: { role: "assistant", content: blockMessage },
                finish_reason: "stop",
              }],
            });
            const sseBody = `data: ${sseChunk}\n\ndata: [DONE]\n\n`;

            return new Response(sseBody, {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
              },
            });
          }

          clearSessionBlocked(sessionKey);
        }
      }
    }

    const isLLMRequest = !!(jsonBody && (
        Array.isArray(jsonBody.messages) || typeof jsonBody.prompt === "string" || typeof jsonBody.input === "string"
    ));

    if (isLLMRequest) {
      interceptorState.llmRequestCount += 1;
    }

    // ==================== 触发延迟创建的 chat span ====================
    if (isLLMRequest) {
      consumePendingChatSpanCallback();
    }

    // ==================== 注入 traceparent header ====================

    if (!options.headers) {
      options.headers = {};
    }

    const conversationId = getSessionId(sessionKey);
    const conversationRequestId = roundTraceId;

    if (options.headers instanceof Headers) {
      options.headers.set("traceparent", traceparent);
      options.headers.set("X-Conversation-ID", conversationId);
      options.headers.set("X-Conversation-Request-ID", conversationRequestId);
    } else if (Array.isArray(options.headers)) {
      options.headers.push(["traceparent", traceparent]);
      options.headers.push(["X-Conversation-ID", conversationId]);
      options.headers.push(["X-Conversation-Request-ID", conversationRequestId]);
    } else {
      options.headers["traceparent"] = traceparent;
      options.headers["X-Conversation-ID"] = conversationId;
      options.headers["X-Conversation-Request-ID"] = conversationRequestId;
    }
    args[1] = options;

    // ==================== 调用原始 fetch 发出请求 ====================
    let resp: Response;
    try {
      resp = await originalFetch.apply(this, args as any);
    } catch (fetchError: any) {
      throw fetchError;
    }

    // ==================== 输出内容安全审核 ====================
    if (isLLMRequest && resp.ok) {
      if (isSessionBlocked(sessionKey)) {
        return resp;
      }

      const sessionId = getSessionId(sessionKey);
      const qaid = ensureQAIDForTurn(sessionKey, turnKey);

      const auditOutputSlices = async (assistantContent: string, source: string): Promise<void> => {
        if (assistantContent.length === 0) {
          interceptorState.outputAuditEndCount += 1;
          const emptyResult = await checkContentSecurity(
              api,
              client,
              "output",
              [{ Data: "", MediaType: "Text" }],
              sessionId,
              SessionType.ANSWER_END,
              source,
              enableLogging,
              logTag,
              qaid,
              parentCtx,
          );
          return;
        }

        const slices = sliceText(assistantContent, OUTPUT_MAX_LENGTH);

        for (let i = 0; i < slices.length; i++) {
          const isLastSlice = i === slices.length - 1;
          const sessionType = isLastSlice ? SessionType.ANSWER_END : SessionType.ANSWER;

          if (isLastSlice) {
            interceptorState.outputAuditEndCount += 1;
          }

          const result = await checkContentSecurity(
              api,
              client,
              "output",
              [{ Data: slices[i], MediaType: "Text" }],
              sessionId,
              sessionType,
              source,
              enableLogging,
              logTag,
              qaid,
              parentCtx,
          );
        }
      };

      const contentType = resp.headers.get("content-type") || "";
      const isSSE = contentType.includes("text/event-stream");

      if (isSSE) {

        const body = resp.body;
        if (body) {
          const reader = body.getReader();
          const decoder = new TextDecoder();
          const encoder = new TextEncoder();

          let auditBuffer = "";
          let sliceIndex = 0;
          let lineBuf = "";
          let detectedModelError = false;
          let detectedFinishReason = "";

          const parseDeltaContent = (line: string): string => {
            if (!line.startsWith("data:")) return "";
            const dataStr = line.slice(5).trim();
            if (dataStr === "[DONE]") return "";
            try {
              const json = JSON.parse(dataStr);
              if (Array.isArray(json.choices) && json.choices.length > 0) {
                const choice = json.choices[0];
                const delta = choice.delta;

                if (choice.finish_reason) {
                  detectedFinishReason = choice.finish_reason;
                  // content_filter 表示模型主动过滤了内容，视为模型错误
                  if (choice.finish_reason === "content_filter") {
                    detectedModelError = true;
                  }
                }

                if (delta && typeof delta.content === "string") {
                  return delta.content;
                }
              }
            } catch {
              // JSON 解析失败，忽略这一行
            }
            return "";
          };

          const flushAuditBuffer = async (): Promise<void> => {
            while (auditBuffer.length >= OUTPUT_MAX_LENGTH) {
              // 取出一个切片
              const slice = auditBuffer.slice(0, OUTPUT_MAX_LENGTH);
              auditBuffer = auditBuffer.slice(OUTPUT_MAX_LENGTH);
              sliceIndex++;

              // 发送中间切片的审核请求（类型为 ANSWER，非 ANSWER_END）
              const result = await checkContentSecurity(
                  api,
                  client,
                  "output",
                  [{ Data: slice, MediaType: "Text" }],
                  sessionId,
                  SessionType.ANSWER,
                  "llm_response_sse",
                  enableLogging,
                  logTag,
                  qaid,
                  parentCtx,
              );

              if (result.blocked) {
                // 内容安全审核阻断：设置 detectedModelError 标志，
                // 下次 pull() 调用时会触发 interceptStream 拦截流
                detectedModelError = true;
                markSessionBlocked(sessionKey);
                addBlockedContent(slice);
                // 跳出循环，不再继续审核后续切片
                break;
              }
            }
          };

          let streamIntercepted = false;

          const interceptStream = (controller: ReadableStreamDefaultController): void => {
            streamIntercepted = true;

            markSessionBlocked(sessionKey);
            // 构造阻断提示消息
            const blockMessage = `<!--CONTENT_SECURITY_BLOCK-->抱歉该任务处理异常，请更换任务再尝试，为保障使用，该问答将在3秒后被删除`;

            // 构造 SSE 格式的阻断 chunk
            const sseChunk = JSON.stringify({
              id: `block-model-error-${Date.now()}`,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: "content-security",
              choices: [{
                index: 0,
                delta: { role: "assistant", content: blockMessage },
                finish_reason: "stop",
              }],
            });
            const sseBody = `data: ${sseChunk}\n\ndata: [DONE]\n\n`;

            // 将阻断消息推送到上层消费者
            controller.enqueue(encoder.encode(sseBody));

            // 异步消费剩余的流数据，防止连接/资源泄漏
            (async () => {
              try {
                while (true) {
                  const { done } = await reader.read();
                  if (done) break;
                }
              } catch {
                // 忽略消费残余数据时的错误
              }
            })();

            // 发送 ANSWER_END 审核通知（告知安全服务本轮回答结束）
            interceptorState.outputAuditEndCount += 1;

            // 将审核缓冲区中剩余的内容作为最后一个切片发送审核
            checkContentSecurity(
                api,
                client,
                "output",
                [{ Data: auditBuffer, MediaType: "Text" }],
                sessionId,
                SessionType.ANSWER_END,
                "llm_response_sse",
                enableLogging,
                logTag,
                qaid,
                parentCtx,
            ).then((interceptResult) => {
            }).catch((e) => {
            });

            // 关闭流
            controller.close();
          };

          // ==================== 创建转换后的可读流 ====================
          const transformedStream = new ReadableStream({
            async pull(controller) {
              // 流已被拦截，不再处理
              if (streamIntercepted) return;

              try {
                const { done, value } = await reader.read();

                if (done) {
                  // ===== 流结束处理 =====

                  if (lineBuf.trim()) {
                    const content = parseDeltaContent(lineBuf);
                    if (content) {
                      auditBuffer += content;
                    }
                  }


                  if (detectedModelError) {
                    interceptStream(controller);
                    return;
                  }

                  sliceIndex++;

                  controller.close();

                  setTimeout(() => {
                    interceptorState.outputAuditEndCount += 1;

                    checkContentSecurity(
                        api,
                        client,
                        "output",
                        [{ Data: auditBuffer, MediaType: "Text" }],
                        sessionId,
                        SessionType.ANSWER_END,
                        "llm_response_sse",
                        enableLogging,
                        logTag,
                        qaid,
                        parentCtx,
                    ).then((endResult) => {
                      // 但仍需标记会话阻断状态，使后续 Agent Runner 重试请求被拦截
                      if (endResult.blocked) {
                        markSessionBlocked(sessionKey);
                        addBlockedContent(auditBuffer);
                      }
                    }).catch((e) => {
                    });
                  }, 0);

                  return;
                }

                // ===== 处理正常的流数据 chunk =====

                lineBuf += decoder.decode(value, { stream: true });

                const lines = lineBuf.split("\n");
                lineBuf = lines.pop() || "";

                for (const line of lines) {
                  const content = parseDeltaContent(line);
                  if (content) {
                    auditBuffer += content;
                  }
                }

                if (detectedModelError) {
                  interceptStream(controller);
                  return;
                }

                controller.enqueue(value);

                await flushAuditBuffer();

                if (detectedModelError) {
                  interceptStream(controller);
                  return;
                }
              } catch (e) {
                // 流处理出错，关闭流
                controller.close();
              }
            },
          });

          return new Response(transformedStream, {
            status: resp.status,
            statusText: resp.statusText,
            headers: resp.headers,
          });
        }
      } else {
        // ==================== JSON 格式响应审核 ====================
        const clonedResp = resp.clone();

        (async () => {
          try {
            const respBody = await clonedResp.json();
            const assistantContent = extractAssistantContent(respBody);

            await auditOutputSlices(assistantContent, "llm_response_json");
          } catch (e) {
            // JSON 解析失败或审核出错，忽略（不影响响应返回）
          }
        })();
      }
    }

    return resp;
  };

  globalThis.fetch = newFetch as typeof fetch;

  interceptorState.installed = true;
};