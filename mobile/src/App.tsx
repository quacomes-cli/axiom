import "./App.css";
import { createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import Welcome from "./pages/Welcome";
import Scanner from "./pages/Scanner";
import ChatList from "./pages/ChatList";
import ChatView from "./pages/ChatView";
import { useT } from "./i18n";
import {
  status,
  errorMsg,
  reset,
  openChatId,
  currentUser,
  pairFromQr,
} from "./lib/session";
import Sidebar, { sidebarOpen, setSidebarOpen } from "./components/Sidebar";
import Settings from "./pages/Settings";

function App() {
  const t = useT();
  const [currentView, setCurrentView] = createSignal<"chat" | "settings">("chat");
  const [page, setPage] = createSignal<"welcome" | "scanner">("welcome");

  // Klavye çözümü: #root'u her zaman görünür viewport'a (visualViewport) sabitle.
  // adjustResize edge-to-edge'de yok sayılabildiği için tek güvenilir yol bu —
  // yükseklik = vv.height, konum = vv.offsetTop ile klavye açılınca içerik
  // klavyenin üstünde kalır; yalnızca içteki liste kayar.
  onMount(() => {
    // Eşleşme varsa otomatik bağlanmayı dene
    const saved = localStorage.getItem("axiom_paired_session");
    if (saved) {
      void pairFromQr(saved);
    }

    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.getElementById("root");
    if (!root) return;
    const apply = () => {
      root.style.height = `${vv.height}px`;
      root.style.transform = `translateY(${vv.offsetTop}px)`;
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);

    // Edge Swipe Gesture listeners
    let touchStartX = 0;
    let touchStartY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const diffX = touchEndX - touchStartX;
      const diffY = touchEndY - touchStartY;

      if (Math.abs(diffX) > Math.abs(diffY) * 1.5) {
        if (diffX > 60 && touchStartX < 45) {
          setSidebarOpen(true);
        } else if (diffX < -60 && sidebarOpen()) {
          setSidebarOpen(false);
        }
      }
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });

    onCleanup(() => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
    });
  });

  const disconnect = () => {
    reset();
    setPage("welcome");
  };

  const isCloudMode = () => currentUser() && !currentUser()?.isAnonymous && status() !== "paired";

  return (
    <main class="h-full w-full bg-base text-text relative overflow-hidden">
      <Sidebar onNavigateSettings={() => setCurrentView("settings")} />
      <Show
        when={currentView() === "settings"}
        fallback={
          <Switch
            fallback={
              <Show when={page() === "scanner"} fallback={<Welcome onPair={() => setPage("scanner")} />}>
                <Scanner onBack={() => setPage("welcome")} />
              </Show>
            }
          >
            <Match when={status() === "paired"}>
              <Show when={openChatId()} fallback={<ChatList />}>
                <ChatView />
              </Show>
            </Match>

            <Match when={isCloudMode()}>
              <Show when={openChatId()} fallback={<ChatList />}>
                <ChatView />
              </Show>
            </Match>

            <Match when={status() === "connecting" || status() === "verifying"}>
              <div class="flex h-full w-full flex-col items-center justify-center gap-5 p-6 bg-base">
                <div class="h-12 w-12 animate-spin rounded-full border-2 border-border border-t-accent-colorful" />
                <p class="text-[1rem] font-medium text-text-secondary">{t("error.connecting")}</p>
                <button
                  onClick={disconnect}
                  class="mt-4 rounded-xl border border-border-hover bg-surface-2/40 px-5 py-2.5 text-[0.88rem] font-medium text-text-secondary hover:text-text hover:border-danger/30 hover:bg-danger/5 active:scale-95 transition-all duration-200"
                >
                  {t("error.resetPairing")}
                </button>
              </div>
            </Match>

            <Match when={status() === "error"}>
              <div class="flex h-full w-full flex-col items-center justify-center gap-4 p-6">
                <p class="text-[0.95rem] text-danger">{t("error.failed")}</p>
                <p class="text-center text-[0.8rem] text-text-faint">{errorMsg()}</p>
                <Show
                  when={localStorage.getItem("axiom_paired_session")}
                  fallback={
                    <button
                      onClick={disconnect}
                      class="mt-2 rounded-xl border border-border-hover px-4 py-2 text-[0.9rem] text-text-secondary active:scale-[0.98]"
                    >
                      {t("scanner.back")}
                    </button>
                  }
                >
                  <div class="flex w-full max-w-[200px] flex-col gap-2">
                    <button
                      onClick={() => {
                        const saved = localStorage.getItem("axiom_paired_session");
                        if (saved) void pairFromQr(saved);
                      }}
                      class="rounded-xl bg-surface-2 border border-border-hover px-4 py-2.5 text-[0.95rem] text-text active:scale-[0.98]"
                    >
                      {t("error.tryAgain")}
                    </button>
                    <button
                      onClick={disconnect}
                      class="rounded-xl border border-border-hover/50 px-4 py-2 text-[0.85rem] text-text-faint active:scale-[0.98]"
                    >
                      {t("error.resetPairing")}
                    </button>
                  </div>
                </Show>
              </div>
            </Match>
          </Switch>
        }
      >
        <Settings onBack={() => setCurrentView("chat")} />
      </Show>
    </main>
  );
}

export default App;
