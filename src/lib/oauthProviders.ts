// Provider-specific OAuth definitions and token exchange/refresh logic.
// Used by appStore + AppsHub.

import { ipc } from "./ipc";

export interface OAuthProvider {
  appId: string;
  /** OAuth authorize endpoint base */
  authUrlBase: string;
  /** OAuth token endpoint (code exchange + refresh) */
  tokenUrl: string;
  /** Permission scopes string (space-separated) */
  scopes: string;
  /** Show client_id & client_secret fields in AppsHub */
  needsClientSecret: boolean;
  /**
   * Hardcoded credentials set by us (the app developer).
   * When present, users don't need to enter their own app credentials.
   */
  builtinClientId?: string;
  builtinClientSecret?: string;
}

// ---------------------------------------------------------------------------
// Google OAuth credentials (Web Application client, registered by us).
// Read from Vite env (.env). Desktop apps with localhost redirect are
// considered "public clients" by Google, so bundling these is acceptable.
// ---------------------------------------------------------------------------
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET || "";

export const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  spotify: {
    appId: "spotify",
    authUrlBase: "https://accounts.spotify.com/authorize",
    tokenUrl: "https://accounts.spotify.com/api/token",
    scopes:
      "user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-recently-played playlist-read-private",
    needsClientSecret: true,
  },
  gmail: {
    appId: "gmail",
    authUrlBase: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes:
      "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
    needsClientSecret: false,
    builtinClientId: GOOGLE_CLIENT_ID,
    builtinClientSecret: GOOGLE_CLIENT_SECRET,
  },
  gcalendar: {
    appId: "gcalendar",
    authUrlBase: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes:
      "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events",
    needsClientSecret: false,
    builtinClientId: GOOGLE_CLIENT_ID,
    builtinClientSecret: GOOGLE_CLIENT_SECRET,
  },
};

/** Resolves the effective client_id for a provider (builtin takes priority). */
export function resolveClientId(provider: OAuthProvider, config: Record<string, string>): string {
  return provider.builtinClientId || config["client_id"] || "";
}

/** Resolves the effective client_secret for a provider (builtin takes priority). */
export function resolveClientSecret(provider: OAuthProvider, config: Record<string, string>): string {
  return provider.builtinClientSecret || config["client_secret"] || "";
}

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
}

/**
 * code + client_id (+secret) → access_token & refresh_token.
 * Google ek olarak `access_type=offline&prompt=consent` ister; bu zaten authUrl'de eklenir.
 */
export async function exchangeCodeForToken(
  provider: OAuthProvider,
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
  });

  const resp = await ipc.httpFetch({
    url: provider.tokenUrl,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (resp.status !== 200) {
    throw new Error(`Token alma hatası HTTP ${resp.status}: ${resp.body.slice(0, 200)}`);
  }
  const data = JSON.parse(resp.body);
  if (!data.access_token) {
    throw new Error(`Token cevabında access_token yok: ${resp.body.slice(0, 200)}`);
  }
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + expiresIn * 1000,
  };
}

export async function refreshAccessToken(
  provider: OAuthProvider,
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
  });
  const resp = await ipc.httpFetch({
    url: provider.tokenUrl,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (resp.status !== 200) {
    throw new Error(`Refresh hatası HTTP ${resp.status}: ${resp.body.slice(0, 200)}`);
  }
  const data = JSON.parse(resp.body);
  if (!data.access_token) {
    throw new Error(`Refresh cevabında access_token yok`);
  }
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  return {
    access_token: data.access_token,
    // Google refresh_token cevabı içermez — eskisini koru
    refresh_token: data.refresh_token || refreshToken,
    expires_at: Date.now() + expiresIn * 1000,
  };
}

/**
 * Token wrapper: config'teki access_token'ı döndürür; expired ise refresh eder
 * ve config'i günceller. Hiç token yoksa hata atar.
 * Builtin credentials varsa config'teki client_id/secret'e ihtiyaç duymaz.
 */
export async function getValidAccessToken(
  appId: string,
  config: Record<string, string>,
  updateConfig: (id: string, c: Record<string, string>) => void,
): Promise<string> {
  const provider = OAUTH_PROVIDERS[appId];
  if (!provider) throw new Error(`Bilinmeyen OAuth provider: ${appId}`);

  const accessToken = config["access_token"];
  const refreshToken = config["refresh_token"];
  const expiresAtStr = config["expires_at"];

  // Effective credentials: builtin takes priority over user-supplied
  const clientId = resolveClientId(provider, config);
  const clientSecret = resolveClientSecret(provider, config);

  // access_token yok ama refresh_token varsa → süresi geçmiş demektir, yenilemeye çalış.
  if (!accessToken && !refreshToken) {
    throw new Error("Hesap bağlı değil. Uygulamalar sekmesinden bağlan.");
  }

  const expiresAt = expiresAtStr ? parseInt(expiresAtStr, 10) : 0;
  // 60s marj — geçerli token varsa direkt döndür.
  if (accessToken && expiresAt > Date.now() + 60_000) return accessToken;

  if (!refreshToken) throw new Error("Oturum süresi doldu. Uygulamalar sekmesinden tekrar bağlan.");
  if (!clientId) throw new Error("Client ID eksik.");

  const fresh = await refreshAccessToken(provider, refreshToken, clientId, clientSecret);
  updateConfig(appId, {
    ...config,
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token || refreshToken,
    expires_at: String(fresh.expires_at),
  });
  return fresh.access_token;
}

/** Provider için authorize URL'i kurar. PKCE yok — localhost flow zaten güvenli. */
export function buildAuthUrl(
  provider: OAuthProvider,
  clientId: string,
  redirectUri: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: provider.scopes,
  });
  // Google offline refresh_token için
  if (provider.tokenUrl.includes("googleapis")) {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
    params.set("include_granted_scopes", "true");
  }
  return `${provider.authUrlBase}?${params.toString()}`;
}
