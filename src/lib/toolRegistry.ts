// Native function-calling şema kaynağı (Faz 2).
//
// "tools" yeteneği olan modellere (Ollama /api/show capabilities) istek
// içinde yapısal şema gönderilir; model regex bloğu yazmak yerine native
// tool_calls üretir. Rust tarafı (ollama/client.rs tool_call_to_block)
// bu çağrıları mevcut ```tool:...``` blok metnine çevirir — böylece
// yürütme yolu (parseToolBlocks → executeToolBlock) hiç değişmez, sadece
// tespit güvenilirliği artar. Yeteneksiz modeller için prompt-tabanlı
// regex yolu aynen geçerli kalır.
//
// DİKKAT: Buradaki parametre adları, Rust'taki tool_call_to_block gövde
// üreticisinin ve chatStore.parseToolBlocks'un beklediği alan adlarıyla
// birebir aynı olmak zorunda (web_search→query, run_command→command,
// write_file→path+content, diğerleri→`anahtar: değer` satırları).

import { useAppStore } from "../stores/appStore";
import { getConnectedMcpTools, mcpNativeName } from "../stores/mcpStore";

interface NativeTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required?: string[];
    };
  };
}

function tool(
  name: string,
  displayText: string,
  description: string,
  properties: Record<string, { type: string; description: string; enum?: string[] }>,
  required: string[] = [],
): NativeTool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, ...(required.length ? { required } : {}) },
    },
  };
}

const BUILTIN_TOOLS: NativeTool[] = [
  tool("weather", "Weather", "Bir şehrin güncel hava durumunu getirir", {
    city: { type: "string", description: "Şehir adı, örn. Istanbul" },
  }, ["city"]),
  tool("currency", "Currency", "Güncel döviz kurlarını (TRY bazlı) getirir", {}),
  tool("web_search", "Searching", "Web'de arama yapar", {
    query: { type: "string", description: "Arama sorgusu" },
  }, ["query"]),
  tool("search_docs", "RAG", "Kullanıcının belge kütüphanesinde (eklediği PDF/dokümanlar) anlamsal arama yapar", {
    query: { type: "string", description: "Arama sorgusu" },
  }, ["query"]),
  tool("read_file", "Reading", "Diskten dosya okur", {
    path: { type: "string", description: "Tam dosya yolu" },
  }, ["path"]),
  tool("write_file", "Writing", "Diske dosya yazar (üzerine yazar)", {
    path: { type: "string", description: "Tam dosya yolu" },
    content: { type: "string", description: "Dosya içeriği" },
  }, ["path", "content"]),
  tool("list_dir", "Listing", "Dizin içeriğini listeler", {
    path: { type: "string", description: "Dizin yolu" },
  }, ["path"]),
  tool("create_dir", "Creating a direction.", "Yeni dizin oluşturur", {
    path: { type: "string", description: "Oluşturulacak dizin yolu" },
  }, ["path"]),
  tool("run_command", "Running", "Shell komutu çalıştırır", {
    command: { type: "string", description: "Çalıştırılacak komut" },
  }, ["command"]),
  tool("get_settings", "Get Settings", "Uygulama ayarlarını okur", {}),
  tool("change_setting", "Change Settings", "Bir uygulama ayarını değiştirir", {
    key: { type: "string", description: "Ayar adı", enum: ["theme", "fontSize", "fontFamily", "launchAtStartup"] },
    value: { type: "string", description: "Yeni değer" },
  }, ["key", "value"]),
  tool("create_task", "Creating a task", "Görev panosuna yeni görev ekler", {
    title: { type: "string", description: "Görev başlığı" },
    description: { type: "string", description: "Görev açıklaması" },
    priority: { type: "string", description: "Öncelik", enum: ["low", "medium", "high"] },
  }, ["title"]),
  tool("list_tasks", "List tasks", "Görevleri listeler", {
    status: { type: "string", description: "Durum filtresi (opsiyonel)" },
  }),
  tool("update_task", "Update task", "Var olan bir görevi günceller", {
    id: { type: "string", description: "Görev ID" },
    title: { type: "string", description: "Yeni başlık" },
    description: { type: "string", description: "Yeni açıklama" },
    status: { type: "string", description: "Yeni durum" },
    priority: { type: "string", description: "Yeni öncelik", enum: ["low", "medium", "high"] },
  }, ["id"]),
  tool("complete_task", "Task completed", "Görevi tamamlandı olarak işaretler", {
    id: { type: "string", description: "Görev ID" },
  }, ["id"]),
  tool("delete_task", "Task deleted", "Görevi siler", {
    id: { type: "string", description: "Görev ID" },
  }, ["id"]),
  tool("schedule_task", "Schedule task", "Zamanlayıcı/alarm/hatırlatıcı veya zamanlanmış agent görevi kurar", {
    title: { type: "string", description: "Görev başlığı" },
    delay: { type: "string", description: "Gecikme, örn. '10dk', '2sa' (at yoksa zorunlu)" },
    at: { type: "string", description: "Saat 'HH:MM' veya 'YYYY-MM-DD HH:MM' (delay yoksa zorunlu)" },
    action: { type: "string", description: "timer (alarm) veya agent (AI görevi)", enum: ["timer", "agent"] },
    message: { type: "string", description: "Bildirim mesajı / agent görev talimatı" },
    recurring: { type: "string", description: "Tekrar", enum: ["once", "daily", "weekly"] },
    prompt: { type: "string", description: "Agent için sistem promptu (opsiyonel)" },
  }, ["title"]),
];

/**
 * Etkin uygulama araçlarını (telegram_send_message, gmail_* vb.) native
 * şemaya çevirir. Parametre tanımı serbest metin ("owner, repo") olduğu
 * için hepsi string kabul edilir; model `anahtar: değer` üretir ve
 * rewriteAppToolBlocks doğru app_tool bloğuna dönüştürür.
 */
function buildAppTools(): NativeTool[] {
  const out: NativeTool[] = [];
  for (const app of useAppStore.getState().apps) {
    if (!app.enabled) continue;
    for (const t of app.tools) {
      const props: Record<string, { type: string; description: string }> = {};
      if (t.parameters && t.parameters !== "yok") {
        for (const raw of t.parameters.split(",")) {
          const p = raw.trim().split(" ")[0].replace(/[^a-zA-Z0-9_]/g, "");
          if (p) props[p] = { type: "string", description: raw.trim() };
        }
      }
      out.push(tool(t.name, t.displayText, `[${app.name}] ${t.description}`, props));
    }
  }
  return out;
}

/**
 * Bağlı MCP sunucularının araçlarını native şemaya çevirir. Ad
 * `mcp__<server>__<tool>`; sunucunun kendi inputSchema'sı aynen geçer
 * (özel tip/enum bilgisi korunur). Rust tool_call_to_block bu adı çözüp
 * `tool:mcp_call` bloğuna çevirir.
 */
function buildMcpTools(): NativeTool[] {
  const out: NativeTool[] = [];
  for (const { server, tool } of getConnectedMcpTools()) {
    const schema = (tool.inputSchema as NativeTool["function"]["parameters"] | undefined) ?? {
      type: "object",
      properties: {},
    };
    out.push({
      type: "function",
      function: {
        name: mcpNativeName(server, tool.name),
        description: `[MCP:${server}] ${tool.description || tool.name}`,
        parameters: {
          type: "object",
          properties: schema.properties ?? {},
          ...(schema.required?.length ? { required: schema.required } : {}),
        },
      },
    });
  }
  return out;
}

/**
 * Model native tool destekliyorsa istek için şema listesi döner; yoksa
 * undefined (istek alanı hiç gönderilmez, davranış eskisi gibi kalır).
 */
export function buildNativeTools(
  model: { capabilities?: string[] | null } | null | undefined,
): NativeTool[] | undefined {
  if (!model?.capabilities?.includes("tools")) return undefined;
  return [...BUILTIN_TOOLS, ...buildAppTools(), ...buildMcpTools()];
}
