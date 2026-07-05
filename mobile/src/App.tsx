import "./App.css";
import { createSignal, Match, Show, Switch } from "solid-js";
import Welcome from "./pages/Welcome";
import Scanner from "./pages/Scanner";
import ChatList from "./pages/ChatList";
import ChatView from "./pages/ChatView";
import { status, errorMsg, reset, openChatId } from "./lib/session";

function App() {
  const [page, setPage] = createSignal<"welcome" | "scanner">("welcome");

  const disconnect = () => {
    reset();
    setPage("welcome");
  };

  return (
    <main class="h-full w-full bg-base text-text">
      <Switch
        fallback={
          <Show when={page() === "scanner"} fallback={<Welcome onPair={() => setPage("scanner")} />}>
            <Scanner onBack={() => setPage("welcome")} />
          </Show>
        }
      >
        <Match when={status() === "paired"}>
          <Show when={openChatId()} fallback={<ChatList onDisconnect={disconnect} />}>
            <ChatView />
          </Show>
        </Match>

        <Match when={status() === "connecting" || status() === "verifying"}>
          <div class="flex h-full w-full flex-col items-center justify-center gap-4 p-6">
            <div class="h-10 w-10 animate-spin rounded-full border-2 border-border-hover border-t-text" />
            <p class="text-[0.95rem] text-text-faint">Bağlanıyor…</p>
          </div>
        </Match>

        <Match when={status() === "error"}>
          <div class="flex h-full w-full flex-col items-center justify-center gap-4 p-6">
            <p class="text-[0.95rem] text-danger">Bağlantı başarısız</p>
            <p class="text-center text-[0.8rem] text-text-faint">{errorMsg()}</p>
            <button
              onClick={disconnect}
              class="mt-2 rounded-xl border border-border-hover px-4 py-2 text-[0.9rem] text-text-secondary active:scale-[0.98]"
            >
              Tekrar dene
            </button>
          </div>
        </Match>
      </Switch>
    </main>
  );
}

export default App;
