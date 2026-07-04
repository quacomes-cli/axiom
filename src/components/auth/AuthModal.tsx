import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, Eye, EyeOff } from "lucide-react";
import { useAuthStore } from "../../stores/authStore";
import { useT } from "../../i18n";

type AuthTab = "login" | "register";

export function AuthModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<AuthTab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const { signInEmail, signUpEmail, signInGoogle, loading, error, clearError } = useAuthStore();

  function switchTab(next: AuthTab) {
    setTab(next);
    clearError();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (tab === "login") {
        await signInEmail(email, password);
      } else {
        await signUpEmail(email, password, name);
      }
      onSuccess();
    } catch { /* error shown via store */ }
  }

  async function handleGoogle() {
    try {
      await signInGoogle();
      onSuccess();
    } catch { /* error shown via store */ }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text">
            {tab === "login" ? t("auth.signInTitle") : t("auth.createAccountTitle")}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1 text-text-faint hover:bg-hover">
            <X size={18} />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="mb-4 flex rounded-xl bg-surface-2 p-1">
          {(["login", "register"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => switchTab(mode)}
              className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors ${
                tab === mode ? "bg-surface text-text shadow-sm" : "text-text-secondary hover:text-text"
              }`}
            >
              {mode === "login" ? t("auth.loginTab") : t("auth.registerTab")}
            </button>
          ))}
        </div>

        {/* Google sign in */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-medium text-text transition-colors hover:bg-hover disabled:opacity-50"
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          {t("auth.googleContinue")}
        </button>

        <div className="mb-3 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-text-faint">{t("auth.or")}</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <AnimatePresence mode="popLayout">
            {tab === "register" && (
              <motion.div
                key="name"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
              >
                <input
                  type="text"
                  placeholder={t("auth.namePlaceholder")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required={tab === "register"}
                  className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-text outline-none placeholder:text-text-faint focus:border-primary"
                />
              </motion.div>
            )}
          </AnimatePresence>

          <input
            type="email"
            placeholder={t("auth.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm text-text outline-none placeholder:text-text-faint focus:border-primary"
          />

          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              placeholder={t("auth.passwordPlaceholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5 pr-10 text-sm text-text outline-none placeholder:text-text-faint focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint hover:text-text-secondary"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-xs text-red-400"
            >
              {error}
            </motion.p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/80 disabled:opacity-50"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {tab === "login" ? t("auth.loginTab") : t("auth.createAccountTitle")}
          </button>
        </form>
      </motion.div>
    </motion.div>
  );
}
