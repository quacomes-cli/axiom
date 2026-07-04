import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useMcpStore } from "../../stores/mcpStore";
import type { McpServerConfig } from "../../types";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-5.25 w-9 shrink-0 rounded-full transition-colors duration-200 ${
        checked ? "bg-blue-400" : "bg-surface-3"
      }`}
    >
      <motion.span
        animate={{ x: checked ? 13.5 : 0.5 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className={`absolute top-0.5 left-0.5 block h-4 w-4 rounded-full ${checked ? "bg-white" : "bg-text-faint"}`}
      />
    </button>
  );
}

/** "npx -y @modelcontextprotocol/server-filesystem C:/yol" → command + args. */
function parseCommandLine(line: string): { command: string; args: string[] } {
  const parts = line.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const cleaned = parts.map((p) => p.replace(/^"|"$/g, ""));
  return { command: cleaned[0] || "", args: cleaned.slice(1) };
}

function emptyDraft(): { name: string; commandLine: string } {
  return { name: "", commandLine: "" };
}

export function McpSettings() {
  const { servers, statuses, connecting, lastError, toolsByServer, load, addServer, removeServer, updateServer, connectServer, disconnectServer } =
    useMcpStore();
  const [draft, setDraft] = useState(emptyDraft());
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd() {
    const name = draft.name.trim();
    if (!name || !draft.commandLine.trim()) return;
    // Ayraç `__` server adında olamaz (native tool ad çözümlemesini bozar).
    const safeName = name.replace(/__+/g, "_");
    const { command, args } = parseCommandLine(draft.commandLine.trim());
    if (!command) return;
    const cfg: McpServerConfig = { name: safeName, command, args, env: {}, enabled: true };
    await addServer(cfg);
    setDraft(emptyDraft());
    setShowAdd(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[0.9286rem] font-medium text-text">MCP Sunucuları</div>
          <div className="mt-0.5 text-xs text-text-faint">
            Model Context Protocol araç sunucuları (filesystem, git, vb.). Bağlanınca araçları sohbette kullanılabilir.
          </div>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="shrink-0 rounded-lg bg-surface-2 px-3 py-1.5 text-[0.8571rem] text-text-secondary transition-colors hover:bg-surface-3 hover:text-text"
        >
          {showAdd ? "İptal" : "+ Ekle"}
        </button>
      </div>

      {showAdd && (
        <div className="space-y-2 rounded-xl bg-surface-2 p-3.5">
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Sunucu adı (örn. filesystem)"
            className="w-full rounded-lg bg-surface px-3 py-2 text-[0.9286rem] text-text outline-none placeholder:text-text-faint"
          />
          <input
            value={draft.commandLine}
            onChange={(e) => setDraft({ ...draft, commandLine: e.target.value })}
            placeholder='Komut (örn. npx -y @modelcontextprotocol/server-filesystem C:/Users/...)'
            className="w-full rounded-lg bg-surface px-3 py-2 font-mono text-[0.8571rem] text-text outline-none placeholder:text-text-faint"
          />
          <button
            onClick={handleAdd}
            disabled={!draft.name.trim() || !draft.commandLine.trim()}
            className="w-full rounded-lg bg-surface-3 py-2 text-[0.8571rem] font-medium text-text transition-colors hover:bg-border-hover disabled:opacity-40"
          >
            Ekle ve Bağlan
          </button>
        </div>
      )}

      {servers.length === 0 && !showAdd && (
        <div className="rounded-xl bg-surface-2 px-3.5 py-6 text-center text-[0.8571rem] text-text-faint">
          Henüz MCP sunucusu yok. "+ Ekle" ile bir tane tanımla.
        </div>
      )}

      {servers.map((s) => {
        const status = statuses[s.name];
        const isConnecting = connecting[s.name];
        const err = lastError[s.name];
        const tools = toolsByServer[s.name] || [];
        const isOpen = expanded === s.name;
        return (
          <div key={s.name} className="rounded-xl bg-surface-2 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      status?.connected ? "bg-success" : err ? "bg-danger" : "bg-text-faint"
                    }`}
                  />
                  <span className="truncate text-[0.9286rem] text-text">{s.name}</span>
                  {status?.connected && (
                    <span className="shrink-0 text-xs text-text-faint">{status.toolCount} araç</span>
                  )}
                  {isConnecting && <span className="shrink-0 text-xs text-text-faint">bağlanıyor…</span>}
                </div>
                <div className="mt-1 truncate font-mono text-xs text-text-faint">
                  {s.command} {s.args.join(" ")}
                </div>
                {err && <div className="mt-1 text-xs text-danger">{err}</div>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Toggle
                  checked={s.enabled}
                  onChange={async (v) => {
                    await updateServer(s.name, { enabled: v });
                    if (v) await connectServer(s.name);
                    else await disconnectServer(s.name);
                  }}
                />
              </div>
            </div>

            <div className="mt-2.5 flex items-center gap-2">
              {status?.connected ? (
                <button
                  onClick={() => disconnectServer(s.name)}
                  className="rounded-lg bg-surface px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-3 hover:text-text"
                >
                  Bağlantıyı kes
                </button>
              ) : (
                <button
                  onClick={() => connectServer(s.name)}
                  disabled={isConnecting}
                  className="rounded-lg bg-surface px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-3 hover:text-text disabled:opacity-40"
                >
                  Bağlan
                </button>
              )}
              {tools.length > 0 && (
                <button
                  onClick={() => setExpanded(isOpen ? null : s.name)}
                  className="rounded-lg bg-surface px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-3 hover:text-text"
                >
                  {isOpen ? "Araçları gizle" : "Araçları göster"}
                </button>
              )}
              <button
                onClick={() => removeServer(s.name)}
                className="ml-auto rounded-lg px-2.5 py-1 text-xs text-text-faint transition-colors hover:text-danger"
              >
                Sil
              </button>
            </div>

            {isOpen && tools.length > 0 && (
              <div className="mt-2.5 space-y-1.5 border-t border-border pt-2.5">
                {tools.map((t) => (
                  <div key={t.name} className="text-xs">
                    <span className="font-mono text-text-secondary">{t.name}</span>
                    {t.description && <span className="text-text-faint"> — {t.description}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
