import { For, Show, createSignal } from "solid-js";
import {
  FiLogOut,
  FiMonitor,
  FiKey,
  FiPlus,
  FiX,
  FiCpu,
  FiUser,
  FiCheckCircle,
  FiSmartphone,
} from "solid-icons/fi";
import {
  currentUser,
  cloudDevices,
  status,
  chats,
  openChat,
  openChatId,
  tryDecryptCloudKeys,
  cloudKeysLoading,
  cloudKeysError,
  decryptedKeys,
  connectToCloudDevice,
  signOutGoogle,
  createDirectChat,
  disconnectFromPc,
  masterPassphrase,
} from "../lib/session";
import { useT } from "../i18n";

export const [sidebarOpen, setSidebarOpen] = createSignal(false);

export default function Sidebar(props: { onNavigateSettings?: () => void }) {
  const t = useT();
  const [passInput, setPassInput] = createSignal(masterPassphrase() || "");

  const user = () => currentUser();
  // Google hesabıyla girilmiş mi (paired-only kullanıcıda cloud bölümleri gizlenir)
  const isCloudUser = () => !!user() && !user()?.isAnonymous;
  const activeChat = () => openChatId();

  const handleDecrypt = async (e: Event) => {
    e.preventDefault();
    if (!passInput().trim()) return;
    await tryDecryptCloudKeys(passInput().trim());
  };

  const handleNewChat = async () => {
    const id = await createDirectChat();
    if (id) {
      setSidebarOpen(false);
    }
  };

  const handleSelectChat = (id: string) => {
    openChat(id);
    setSidebarOpen(false);
  };

  const handleSelectDevice = async (device: any) => {
    setSidebarOpen(false);
    await connectToCloudDevice(device);
  };

  return (
    <>
      {/* Backdrop (Dark Overlay) */}
      <Show when={sidebarOpen()}>
        <div
          onClick={() => setSidebarOpen(false)}
          class="fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 animate-fade-in"
        />
      </Show>

      {/* Sidebar Panel */}
      <div
        class={`fixed bottom-0 top-0 left-0 z-50 flex w-72 flex-col bg-surface border-r border-border transition-transform duration-300 ease-out ${
          sidebarOpen() ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header with Profile & Close Button */}
        <div class="flex items-center justify-between border-b border-border p-4 pt-12">
          <div class="flex items-center gap-3 min-w-0">
            <Show
              when={user()?.photoURL}
              fallback={
                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-3 text-text-secondary border border-border">
                  <FiUser size={18} />
                </div>
              }
            >
              <img
                src={user()?.photoURL || ""}
                alt="Avatar"
                class="h-10 w-10 rounded-full border border-border shrink-0"
              />
            </Show>
            <div class="flex flex-col min-w-0">
              <span class="text-[0.92rem] font-semibold text-text truncate">
                {user()?.displayName || t("sidebar.defaultUser")}
              </span>
              <span class="text-[0.72rem] text-text-faint truncate">
                {user()?.email || ""}
              </span>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            class="flex h-8 w-8 items-center justify-center rounded-lg text-text-faint hover:bg-surface-2 hover:text-text-secondary transition-colors"
          >
            <FiX size={18} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div class="flex-1 overflow-y-auto p-4 space-y-6">

          {/* Section 1: E2EE Master Key Decryption (yalnız cloud kullanıcı) */}
          <Show when={isCloudUser()}>
            <div class="space-y-2.5">
              <div class="flex items-center gap-2 px-1">
                <FiKey size={14} class="text-text-secondary" />
                <span class="text-[0.75rem] font-bold uppercase tracking-wider text-text-secondary">
                  {t("sidebar.cloudEncryption")}
                </span>
              </div>
              <form onSubmit={handleDecrypt} class="space-y-2">
                <div class="relative">
                  <input
                    type="password"
                    value={passInput()}
                    onInput={(e) => setPassInput(e.currentTarget.value)}
                    placeholder={t("sidebar.passPlaceholder")}
                    class="w-full rounded-xl bg-surface-2 border border-border px-3.5 py-2 text-[0.82rem] text-text placeholder:text-text-faint outline-none focus:border-accent-colorful/45 transition-colors"
                  />
                  <Show when={decryptedKeys()}>
                    <FiCheckCircle size={16} class="absolute right-3.5 top-2.5 text-success" />
                  </Show>
                </div>
                <div class="flex gap-2 items-center justify-between">
                  <button
                    type="submit"
                    disabled={cloudKeysLoading()}
                    class="w-full rounded-xl bg-surface-3 border border-border py-1.5 text-[0.8rem] font-semibold text-text-secondary hover:text-text hover:bg-surface-2 disabled:opacity-50 transition-colors"
                  >
                    {cloudKeysLoading()
                      ? t("sidebar.decrypting")
                      : decryptedKeys()
                        ? t("sidebar.update")
                        : t("sidebar.decrypt")}
                  </button>
                </div>
                <Show when={cloudKeysError()}>
                  <p class="text-[0.72rem] text-danger px-1">{cloudKeysError()}</p>
                </Show>
              </form>
            </div>
          </Show>

          {/* Section 2: Active Computers (yalnız cloud kullanıcı) */}
          <Show when={isCloudUser()}>
            <div class="space-y-2.5">
              <div class="flex items-center gap-2 px-1">
                <FiMonitor size={14} class="text-text-secondary" />
                <span class="text-[0.75rem] font-bold uppercase tracking-wider text-text-secondary">
                  {t("sidebar.activeDevices")}
                </span>
              </div>

              <Show
                when={cloudDevices().length > 0}
                fallback={
                  <div class="rounded-xl border border-border/60 bg-surface-2/10 p-3 text-center text-text-faint text-[0.78rem] leading-relaxed">
                    {t("sidebar.noDevices")}
                  </div>
                }
              >
                <div class="space-y-1.5">
                  <For each={cloudDevices()}>
                    {(device) => (
                      <div class="flex items-center justify-between rounded-xl border border-border/55 bg-surface-2/20 px-3.5 py-2">
                        <div class="flex items-center gap-2.5 min-w-0">
                          <div class="h-2 w-2 rounded-full bg-success animate-pulse shrink-0" />
                          <span class="text-[0.82rem] font-medium text-text truncate">{device.name}</span>
                        </div>
                        <button
                          onClick={() => void handleSelectDevice(device)}
                          class="rounded-lg bg-accent-colorful/15 border border-accent-colorful/25 hover:bg-accent-colorful/20 px-2.5 py-1 text-[0.75rem] font-semibold text-accent-colorful transition-colors"
                        >
                          {t("sidebar.connect")}
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>

          {/* Section 3: Chats History & New Chat */}
          <div class="space-y-2.5">
            <div class="flex items-center justify-between px-1">
              <div class="flex items-center gap-2">
                <FiCpu size={14} class="text-text-secondary" />
                <span class="text-[0.75rem] font-bold uppercase tracking-wider text-text-secondary">
                  {t("sidebar.chats")}
                </span>
              </div>
              <Show when={decryptedKeys() || status() === "paired"}>
                <button
                  onClick={handleNewChat}
                  class="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface-2 hover:bg-surface-3 text-text-secondary hover:text-text transition-colors"
                >
                  <FiPlus size={14} />
                </button>
              </Show>
            </div>

            <Show
              when={chats().length > 0}
              fallback={
                <div class="rounded-xl border border-border/60 bg-surface-2/10 p-3 text-center text-text-faint text-[0.78rem] leading-relaxed">
                  {t("sidebar.noChats")}
                </div>
              }
            >
              <div class="space-y-1 max-h-72 overflow-y-auto scrollbar-none">
                <For each={chats()}>
                  {(c) => (
                    <button
                      onClick={() => handleSelectChat(c.id)}
                      class={`group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[0.82rem] transition-colors ${
                        activeChat() === c.id
                          ? "bg-accent-colorful/10 border border-accent-colorful/20 text-accent-colorful"
                          : "text-text-secondary hover:bg-surface-2 hover:text-text"
                      }`}
                    >
                      <span class="truncate pr-2 font-medium">{c.title}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

        </div>

        {/* Footer */}
        <div class="border-t border-border p-4 bg-surface space-y-2">
          {/* PC bağlantısını kes — yalnız paired iken; Google oturumuna dokunmaz */}
          <Show when={status() === "paired"}>
            <button
              onClick={() => {
                setSidebarOpen(false);
                disconnectFromPc();
              }}
              class="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 hover:bg-warn/5 hover:text-warn hover:border-warn/20 py-2.5 text-[0.82rem] font-semibold text-text-secondary transition-all"
            >
              <FiSmartphone size={16} />
              <span>{t("sidebar.disconnectPc")}</span>
            </button>
          </Show>
          <button
            onClick={() => {
              setSidebarOpen(false);
              props.onNavigateSettings?.();
            }}
            class="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 hover:bg-surface-3 py-2.5 text-[0.82rem] font-semibold text-text-secondary transition-all"
          >
            <FiCpu size={16} />
            <span>{t("sidebar.settingsModels")}</span>
          </button>
          {/* Oturumu kapat — yalnız cloud kullanıcı */}
          <Show when={isCloudUser()}>
            <button
              onClick={() => {
                setSidebarOpen(false);
                void signOutGoogle();
              }}
              class="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 hover:bg-danger/5 hover:text-danger hover:border-danger/20 py-2.5 text-[0.82rem] font-semibold text-text-secondary transition-all"
            >
              <FiLogOut size={16} />
              <span>{t("sidebar.signOut")}</span>
            </button>
          </Show>
        </div>
      </div>
    </>
  );
}
