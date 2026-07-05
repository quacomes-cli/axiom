import "./App.css";
import { createSignal, Match, Show, Switch } from "solid-js";
import Welcome from "./pages/Welcome";
import Scanner from "./pages/Scanner";
import { status, errorMsg, reset } from "./lib/session";

function App() {
  const [page, setPage] = createSignal<"welcome" | "scanner">("welcome");

  const disconnect = () => {
    reset();
    setPage("welcome");
  };

  return (
    <main class="h-full w-full bg-base text-text">
      <Show
        when={status() !== "idle"}
        fallback={
          <Show when={page() === "scanner"} fallback={<Welcome onPair={() => setPage("scanner")} />}>
            <Scanner onBack={() => setPage("welcome")} />
          </Show>
        }
      >
        <div class="flex h-full w-full flex-col items-center justify-center gap-4 p-6">
          <Switch>
            <Match when={status() === "connecting" || status() === "verifying"}>
              <div class="h-10 w-10 animate-spin rounded-full border-2 border-border-hover border-t-text" />
              <p class="text-[0.95rem] text-text-faint">Bağlanıyor…</p>
            </Match>

            <Match when={status() === "paired"}>
              <div class="flex h-16 w-16 items-center justify-center rounded-full border border-success/40 bg-success/10">
                <span class="text-2xl text-success">✓</span>
              </div>
              <p class="text-[1rem] text-text">Bağlandı</p>
              <p class="text-center text-[0.85rem] text-text-faint">
                Sohbet arayüzü yakında burada olacak.
              </p>
              <button
                onClick={disconnect}
                class="mt-2 rounded-xl border border-border-hover px-4 py-2 text-[0.9rem] text-text-secondary active:scale-[0.98]"
              >
                Bağlantıyı kes
              </button>
            </Match>

            <Match when={status() === "error"}>
              <p class="text-[0.95rem] text-danger">Bağlantı başarısız</p>
              <p class="text-center text-[0.8rem] text-text-faint">{errorMsg()}</p>
              <button
                onClick={disconnect}
                class="mt-2 rounded-xl border border-border-hover px-4 py-2 text-[0.9rem] text-text-secondary active:scale-[0.98]"
              >
                Tekrar dene
              </button>
            </Match>
          </Switch>
        </div>
      </Show>
    </main>
  );
}

export default App;
