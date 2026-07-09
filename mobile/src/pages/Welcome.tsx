import { FaSolidQrcode } from "solid-icons/fa";
import { FiLogOut, FiFolder } from "solid-icons/fi";
import { useT } from "../i18n";
import { currentUser, signInGoogleDirectly, signOutGoogle } from "../lib/session";
import { Show } from "solid-js";

function Welcome(props: { onPair: () => void }) {
  const t = useT();

  const user = () => currentUser();
  const isLoggedIn = () => user() && !user()?.isAnonymous;

  return (
    <div class="relative flex h-full w-full flex-col items-center justify-between p-6 pb-10 overflow-hidden bg-base">
      {/* Ambient background glows */}
      <div class="pointer-events-none absolute -top-40 -left-40 h-80 w-80 rounded-full bg-accent-colorful/20 blur-[100px]" />

      <div class="relative z-10 flex flex-1 flex-col items-center justify-center gap-4">
        <img src="/logo.svg" alt="Axiom" class="h-25 w-25 object-contain" />
        <a href="https://axiom.quacomes.com" target="_blank">
          <span class="text-5xl text-text font-semibold tracking-tight" style={{ "font-family": "Libre Baskerville, serif" }}>
            {t("welcome.title")}
          </span>
        </a>
        <p class="text-center text-[0.95rem] text-text-secondary max-w-[280px]">
          {t("welcome.tagline")}
        </p>

        {/* Logged in state info */}
        <Show when={isLoggedIn()}>
          <div class="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-border/60 bg-surface-2/40 p-4 w-full min-w-[260px] max-w-[280px] shadow-lg backdrop-blur-md animate-fade-in">
            <Show when={user()?.photoURL}>
              <img src={user()?.photoURL || ""} alt="Avatar" class="h-14 w-14 rounded-full border-2 border-accent-colorful/40 shadow-inner" />
            </Show>
            <div class="text-center">
              <p class="text-[0.95rem] font-medium text-text">
                {t("welcome.welcomeUser", { name: user()?.displayName || user()?.email || "" })}
              </p>
              <p class="text-[0.8rem] text-text-faint mt-0.5">{user()?.email}</p>
            </div>
          </div>
        </Show>
      </div>

      <div class="relative z-10 flex w-full flex-col gap-3.5 max-w-[340px]">
        <Show
          when={isLoggedIn()}
          fallback={
            <button
              onClick={() => void signInGoogleDirectly()}
              class="flex w-full items-center justify-center gap-2.5 rounded-xl border border-border bg-surface backdrop-blur-sm py-3.5 text-[1rem] font-medium text-text active:scale-[0.97] transition-all duration-200 hover:bg-surface-2"
            >
              <svg class="h-4.5 w-4.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              <span>{t("welcome.googleSignIn")}</span>
            </button>
          }
        >
          <button
            onClick={() => {
              // entering cloud mode list happens automatically since App.tsx router matches isLoggedIn
            }}
            class="flex w-full items-center justify-center gap-2.5 rounded-xl bg-accent-colorful py-3.5 text-[1rem] font-semibold text-white shadow-lg shadow-accent-colorful/20 active:scale-[0.97] transition-all duration-200 hover:brightness-105"
          >
            <FiFolder size={18} />
            <span>{t("welcome.goToChats")}</span>
          </button>

          <button
            onClick={() => void signOutGoogle()}
            class="flex w-full items-center justify-center gap-2.5 rounded-xl border border-border-hover/50 bg-surface-2/20 py-3 text-[0.9rem] text-text-faint active:scale-[0.97] transition-all duration-200 hover:text-text-secondary"
          >
            <FiLogOut size={16} />
            <span>{t("welcome.signOut")}</span>
          </button>
        </Show>

        <button
          onClick={props.onPair}
          class="flex w-full items-center justify-center gap-2.5 rounded-xl border border-border-hover bg-surface-2/60 backdrop-blur-sm py-3.5 text-[1rem] font-medium text-text active:scale-[0.97] transition-all duration-200 hover:border-border-hover/80 hover:bg-surface-2"
        >
          <FaSolidQrcode size={18} stroke-width={1} />
          <span>{t("welcome.pairDevice")}</span>
        </button>
        {/** Burayı bırak ben ekledim */}
        <p class="mx-auto text-text-faint">Powered by <a class="text-text" href="https://quacomes.com" target="_blank">Quacomes</a></p>
      </div>
    </div>
  );
}

export default Welcome;
