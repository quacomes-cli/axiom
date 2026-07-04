// MCP (Model Context Protocol) istemci durumu.
//
// Sunucu tanımlarının KAYNAK DOĞRULUĞU Rust settings'tir (mcp_servers) — bu
// store onu yansıtır ve her değişikliği mcpServersSet ile geri yazar. Araçlar
// kalıcı değildir; bağlantı kurulunca (mcpConnect) gelir ve bellekte tutulur.
//
// Yaşam döngüsü: App açılışında load() → connectEnabled() enabled sunucuları
// arka planda bağlar; başarısız olan sohbeti bloklamaz, sadece o sunucu
// araçsız kalır. Bağlantı kopması/yeniden başlatma Rust tarafındadır.

import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { McpServerConfig, McpToolInfo, McpServerStatus } from "../types";

interface McpState {
  servers: McpServerConfig[];
  /** server adı → araçları (yalnız bağlıyken dolu). */
  toolsByServer: Record<string, McpToolInfo[]>;
  statuses: Record<string, McpServerStatus>;
  /** Bağlanma sürüyor mu (UI spinner'ı için). */
  connecting: Record<string, boolean>;
  lastError: Record<string, string>;

  load: () => Promise<void>;
  connectEnabled: () => Promise<void>;
  addServer: (cfg: McpServerConfig) => Promise<void>;
  updateServer: (name: string, patch: Partial<McpServerConfig>) => Promise<void>;
  removeServer: (name: string) => Promise<void>;
  connectServer: (name: string) => Promise<boolean>;
  disconnectServer: (name: string) => Promise<void>;
  refreshStatus: () => Promise<void>;
}

async function persist(servers: McpServerConfig[]): Promise<void> {
  await ipc.mcpServersSet(servers);
}

export const useMcpStore = create<McpState>((set, get) => ({
  servers: [],
  toolsByServer: {},
  statuses: {},
  connecting: {},
  lastError: {},

  load: async () => {
    try {
      const servers = await ipc.mcpServersGet();
      set({ servers });
      await get().refreshStatus();
    } catch {
      /* settings okunamadı — boş kal */
    }
  },

  connectEnabled: async () => {
    const enabled = get().servers.filter((s) => s.enabled);
    // Paralel bağla; biri düşerse diğerlerini etkilemesin.
    await Promise.allSettled(enabled.map((s) => get().connectServer(s.name)));
  },

  addServer: async (cfg) => {
    const servers = [...get().servers.filter((s) => s.name !== cfg.name), cfg];
    set({ servers });
    await persist(servers);
    if (cfg.enabled) void get().connectServer(cfg.name);
  },

  updateServer: async (name, patch) => {
    const servers = get().servers.map((s) => (s.name === name ? { ...s, ...patch } : s));
    set({ servers });
    await persist(servers);
  },

  removeServer: async (name) => {
    await get().disconnectServer(name);
    const servers = get().servers.filter((s) => s.name !== name);
    set((st) => {
      const tools = { ...st.toolsByServer };
      delete tools[name];
      return { servers, toolsByServer: tools };
    });
    await persist(servers);
  },

  connectServer: async (name) => {
    set((st) => ({ connecting: { ...st.connecting, [name]: true } }));
    try {
      const tools = await ipc.mcpConnect(name);
      set((st) => ({
        toolsByServer: { ...st.toolsByServer, [name]: tools },
        lastError: { ...st.lastError, [name]: "" },
      }));
      await get().refreshStatus();
      return true;
    } catch (e) {
      set((st) => ({ lastError: { ...st.lastError, [name]: String(e) } }));
      return false;
    } finally {
      set((st) => ({ connecting: { ...st.connecting, [name]: false } }));
    }
  },

  disconnectServer: async (name) => {
    try {
      await ipc.mcpDisconnect(name);
    } catch {
      /* zaten kapalı olabilir */
    }
    set((st) => {
      const tools = { ...st.toolsByServer };
      delete tools[name];
      return { toolsByServer: tools };
    });
    await get().refreshStatus();
  },

  refreshStatus: async () => {
    try {
      const list = await ipc.mcpStatus();
      const statuses: Record<string, McpServerStatus> = {};
      for (const s of list) statuses[s.name] = s;
      set({ statuses });
    } catch {
      /* yoksay */
    }
  },
}));

/** Bağlı tüm MCP araçlarını {server, tool} düzleminde döner. */
export function getConnectedMcpTools(): { server: string; tool: McpToolInfo }[] {
  const { toolsByServer } = useMcpStore.getState();
  const out: { server: string; tool: McpToolInfo }[] = [];
  for (const [server, tools] of Object.entries(toolsByServer)) {
    for (const tool of tools) out.push({ server, tool });
  }
  return out;
}

/**
 * Native tool adı: `mcp__<server>__<tool>`. Rust (tool_call_to_block) bunu
 * ayrıştırıp `tool:mcp_call` bloğuna çevirir; ayraç `__` olduğu için server
 * adında `__` bulunmamalı (addServer'da sanitize edilir).
 */
export function mcpNativeName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

/** Prompt-tabanlı modeller için MCP araçlarını markdown blok olarak üretir. */
export function buildMcpToolsPrompt(): string | null {
  const tools = getConnectedMcpTools();
  if (tools.length === 0) return null;

  const lines = tools.map(({ server, tool }) => {
    const desc = tool.description ? ` — ${tool.description}` : "";
    // Şema özet: parametre adlarını çıkar (varsa).
    let params = "";
    try {
      const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
      if (schema?.properties) {
        const keys = Object.keys(schema.properties);
        if (keys.length) params = ` (parametreler: ${keys.join(", ")})`;
      }
    } catch { /* şema yok */ }
    return `### ${server} / ${tool.name}${desc}${params}\n` +
      "```tool:mcp_call\n" +
      `server: ${server}\n` +
      `tool: ${tool.name}\n` +
      "---\n" +
      "{ ...JSON argümanlar... }\n" +
      "```";
  });

  return (
    "# MCP Araçları\n" +
    "Aşağıdaki harici MCP sunucu araçlarına erişimin var. Kullanmak için " +
    "`tool:mcp_call` bloğu yaz: `server:` ve `tool:` satırları, ardından `---` " +
    "ve tek satırda JSON argümanlar. Argüman gerekmiyorsa `{}` yaz.\n\n" +
    lines.join("\n\n")
  );
}
