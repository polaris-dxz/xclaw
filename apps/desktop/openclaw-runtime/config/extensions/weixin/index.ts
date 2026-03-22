import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk";

import { weixinPlugin } from "./src/channel.js";
import { WeixinConfigSchema } from "./src/config/config-schema.js";
import { registerWeixinCli } from "./src/log-upload.js";
import { setWeixinRuntime } from "./src/runtime.js";

const plugin = {
  id: "openclaw-weixin",
  name: "Weixin",
  description: "Weixin channel (getUpdates long-poll + sendMessage)",
  configSchema: buildChannelConfigSchema(WeixinConfigSchema),
  register(api: OpenClawPluginApi) {
    if (!api?.runtime) {
      throw new Error("[weixin] api.runtime is not available in register()");
    }
    setWeixinRuntime(api.runtime);

    api.registerChannel({ plugin: weixinPlugin });

    const gw = weixinPlugin.gateway as {
      loginWithQrStart?: (p: {
        accountId?: string;
        force?: boolean;
        verbose?: boolean;
        timeoutMs?: number;
      }) => Promise<{ qrDataUrl?: string; message: string; sessionKey?: string }>;
      loginWithQrWait?: (p: {
        accountId?: string;
        sessionKey?: string;
        timeoutMs?: number;
      }) => Promise<{ connected: boolean; message: string; accountId?: string }>;
    };

    api.registerGatewayMethod("weixin.login.qr.start", async ({ params, respond }) => {
      if (!gw?.loginWithQrStart) {
        respond(false, undefined, { message: "weixin loginWithQrStart unavailable" } as any);
        return;
      }
      try {
        const force = Boolean((params as { force?: boolean }).force);
        const accountIdRaw = (params as { accountId?: string }).accountId;
        const accountId =
          typeof accountIdRaw === "string" && accountIdRaw.trim() ? accountIdRaw.trim() : undefined;
        const out = await gw.loginWithQrStart({ accountId, force, verbose: false });
        respond(true, out, undefined);
      } catch (err) {
        respond(false, undefined, { message: String(err) } as any);
      }
    });

    api.registerGatewayMethod("weixin.login.qr.wait", async ({ params, respond }) => {
      if (!gw?.loginWithQrWait) {
        respond(false, undefined, { message: "weixin loginWithQrWait unavailable" } as any);
        return;
      }
      try {
        const p = params as { sessionKey?: string; accountId?: string; timeoutMs?: number };
        const sessionKey =
          typeof p.sessionKey === "string" && p.sessionKey.trim() ? p.sessionKey.trim() : undefined;
        if (!sessionKey) {
          respond(false, undefined, { message: "sessionKey required" } as any);
          return;
        }
        const timeoutMs = typeof p.timeoutMs === "number" ? p.timeoutMs : 480_000;
        const out = await gw.loginWithQrWait({
          sessionKey,
          accountId: p.accountId,
          timeoutMs,
        });
        respond(true, out, undefined);
      } catch (err) {
        respond(false, undefined, { message: String(err) } as any);
      }
    });

    api.registerCli(({ program, config }) => registerWeixinCli({ program, config }), {
      commands: ["weixin"],
    });
  },
};

export default plugin;
