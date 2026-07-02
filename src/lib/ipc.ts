// Type-safe wrappers around Tauri's `invoke`. Every Rust command the frontend
// calls is declared here so call sites get checked argument/return types
// instead of stringly-typed `invoke("...")` scattered through components.

import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  AppSettings,
  CloudProviderConfig,
  CurrencyData,
  Decision,
  FileEntry,
  ParsedDocument,
  ReadFileResult,
  ShellOutput,
  SkillContent,
  SkillInfo,
  HardwareProfile,
  InferenceRequest,
  InferenceResponse,
  LibraryModel,
  ModelInfo,
  OllamaStatus,
  PermissionConfig,
  ProviderKind,
  SearchResult,
  WeatherData,
} from "../types";

export const ipc = {
  /** Basic app metadata reported by the Rust core. */
  appInfo(): Promise<AppInfo> {
    return invoke<AppInfo>("app_info");
  },

  /** Profiles the host hardware (CPU/RAM, best-effort GPU). */
  hardwareProfile(): Promise<HardwareProfile> {
    return invoke<HardwareProfile>("hardware_profile");
  },

  /** Reads the current permission config. */
  permissionsGet(): Promise<PermissionConfig> {
    return invoke<PermissionConfig>("permissions_get");
  },

  /** Persists an updated permission config. */
  permissionsSet(config: PermissionConfig): Promise<void> {
    return invoke<void>("permissions_set", { config });
  },

  /** Evaluates a single action against the active config. */
  permissionsCheck(query: Record<string, unknown>): Promise<Decision> {
    return invoke<Decision>("permissions_check", { query });
  },

  /** Reads the current app settings. */
  settingsGet(): Promise<AppSettings> {
    return invoke<AppSettings>("settings_get");
  },

  /** Persists updated app settings. */
  settingsSet(settings: AppSettings): Promise<void> {
    return invoke<void>("settings_set", { settings });
  },

  /** Enables or disables launch-at-startup via OS autostart. */
  setAutostart(enabled: boolean): Promise<void> {
    return invoke<void>("set_autostart", { enabled });
  },

  // ---- Models ---------------------------------------------------------------

  modelsList(): Promise<ModelInfo[]> {
    return invoke<ModelInfo[]>("models_list");
  },

  modelsPull(provider: ProviderKind, modelId: string): Promise<void> {
    return invoke<void>("models_pull", { provider, modelId });
  },

  modelsDelete(provider: ProviderKind, modelId: string): Promise<void> {
    return invoke<void>("models_delete", { provider, modelId });
  },

  modelsQuantize(source: string, targetTag: string, quantType: string): Promise<void> {
    return invoke<void>("models_quantize", { source, targetTag, quantType });
  },

  modelsSetActive(provider: ProviderKind, modelId: string): Promise<void> {
    return invoke<void>("models_set_active", { provider, modelId });
  },

  modelsChat(req: InferenceRequest): Promise<InferenceResponse> {
    return invoke<InferenceResponse>("models_chat", { req });
  },

  modelsChatStream(req: InferenceRequest, chatId: string): Promise<void> {
    return invoke<void>("models_chat_stream", { req, chatId });
  },

  ollamaStatus(): Promise<boolean> {
    return invoke<boolean>("ollama_status");
  },

  ollamaCheck(): Promise<OllamaStatus> {
    return invoke<OllamaStatus>("ollama_check");
  },

  ollamaStart(): Promise<void> {
    return invoke<void>("ollama_start");
  },

  ollamaRestart(): Promise<void> {
    return invoke<void>("ollama_restart");
  },

  ollamaInstall(): Promise<void> {
    return invoke<void>("ollama_install");
  },

  ollamaLibrary(): Promise<LibraryModel[]> {
    return invoke<LibraryModel[]>("ollama_library");
  },

  ollamaRegistryTags(model: string): Promise<string[]> {
    return invoke<string[]>("ollama_registry_tags", { model });
  },

  cloudProvidersGet(): Promise<CloudProviderConfig[]> {
    return invoke<CloudProviderConfig[]>("cloud_providers_get");
  },

  cloudProvidersSet(configs: CloudProviderConfig[]): Promise<void> {
    return invoke<void>("cloud_providers_set", { configs });
  },

  // ---- Skills ------------------------------------------------------------------

  skillsDiscover(query?: string): Promise<SkillInfo[]> {
    return invoke<SkillInfo[]>("skills_discover", { query: query ?? null });
  },

  skillsFetchContent(owner: string, repo: string): Promise<SkillContent> {
    return invoke<SkillContent>("skills_fetch_content", { owner, repo });
  },

  // ---- Documents ----------------------------------------------------------------

  documentParse(filePath: string): Promise<ParsedDocument> {
    return invoke<ParsedDocument>("document_parse", { filePath });
  },

  // ---- Filesystem & Shell --------------------------------------------------------

  fsReadDir(path: string, projectRoot: string, maxDepth?: number): Promise<FileEntry[]> {
    return invoke<FileEntry[]>("fs_read_dir", { path, projectRoot, maxDepth: maxDepth ?? 2 });
  },

  fsReadFile(path: string, projectRoot: string, offset?: number, limit?: number): Promise<ReadFileResult> {
    return invoke<ReadFileResult>("fs_read_file", { path, projectRoot, offset: offset ?? null, limit: limit ?? null });
  },

  fsWriteFile(path: string, content: string, projectRoot: string): Promise<void> {
    return invoke<void>("fs_write_file", { path, content, projectRoot });
  },

  fsCreateDir(path: string, projectRoot: string): Promise<void> {
    return invoke<void>("fs_create_dir", { path, projectRoot });
  },

  fsApplyEdit(path: string, oldString: string, newString: string, replaceAll: boolean, projectRoot: string): Promise<import("../types").EditResult> {
    return invoke("fs_apply_edit", { path, oldString, newString, replaceAll, projectRoot });
  },

  fsDeletePath(path: string, projectRoot: string): Promise<void> {
    return invoke<void>("fs_delete_path", { path, projectRoot });
  },

  fsRenamePath(from: string, to: string, projectRoot: string): Promise<void> {
    return invoke<void>("fs_rename_path", { from, to, projectRoot });
  },

  fsSearch(query: string, projectRoot: string, path?: string, caseSensitive?: boolean): Promise<import("../types").SearchMatch[]> {
    return invoke("fs_search", { query, path: path ?? null, projectRoot, caseSensitive: caseSensitive ?? null });
  },

  fsGlob(pattern: string, projectRoot: string): Promise<string[]> {
    return invoke<string[]>("fs_glob", { pattern, projectRoot });
  },

  shellExec(command: string, cwd?: string): Promise<ShellOutput> {
    return invoke<ShellOutput>("shell_exec", { command, cwd: cwd ?? null });
  },

  shellExecStream(command: string, execId: string, cwd?: string, timeoutSecs?: number): Promise<void> {
    return invoke<void>("shell_exec_stream", { command, cwd: cwd ?? null, execId, timeoutSecs: timeoutSecs ?? null });
  },

  // ---- Web Search ---------------------------------------------------------------

  webSearch(query: string, maxResults?: number): Promise<SearchResult[]> {
    return invoke<SearchResult[]>("web_search", { query, maxResults });
  },

  // ---- Weather & Currency ---------------------------------------------------

  weatherFetch(city: string): Promise<WeatherData> {
    return invoke<WeatherData>("weather_fetch", { city });
  },

  currencyFetch(): Promise<CurrencyData> {
    return invoke<CurrencyData>("currency_fetch");
  },

  // ---- Generic HTTP (Apps Hub) ------------------------------------------------

  httpFetch(req: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; body: string }> {
    return invoke<{ status: number; body: string }>("http_fetch", { req });
  },

  // ---- Audio / STT ----------------------------------------------------------

  audioStartRecording(sessionId: string): Promise<void> {
    return invoke<void>("audio_start_recording", { sessionId });
  },

  audioCancelRecording(sessionId: string): Promise<void> {
    return invoke<void>("audio_cancel_recording", { sessionId });
  },

  audioStopAndTranscribe(
    sessionId: string,
    modelName: string,
    language?: string,
  ): Promise<import("../types").AudioTranscript> {
    return invoke("audio_stop_and_transcribe", {
      sessionId,
      modelName,
      language: language ?? null,
    });
  },

  audioModelStatus(modelName: string): Promise<import("../types").WhisperModelStatus> {
    return invoke("audio_model_status", { modelName });
  },

  audioDownloadModel(modelName: string): Promise<string> {
    return invoke<string>("audio_download_model", { modelName });
  },

  // ---- Screen Capture ----------------------------------------------------------

  screenListMonitors(): Promise<import("../components/shared/ScreenshotButton").MonitorInfo[]> {
    return invoke("screen_list_monitors");
  },

  screenCapture(monitorIndex?: number): Promise<{
    dataUrl: string;
    bytes: number;
    width: number;
    height: number;
  }> {
    return invoke("screen_capture", { monitorIndex: monitorIndex ?? null });
  },

  // ---- Memory / RAG --------------------------------------------------------

  memoryStore(args: {
    chatId: string;
    messageId: string;
    role: string;
    text: string;
    embeddingModel: string;
  }): Promise<number> {
    return invoke<number>("memory_store", args);
  },

  memoryRecall(args: {
    query: string;
    embeddingModel: string;
    topK?: number;
    excludeChatId?: string;
    onlyChatId?: string;
  }): Promise<import("../types").MemoryHit[]> {
    return invoke("memory_recall", {
      query: args.query,
      embeddingModel: args.embeddingModel,
      topK: args.topK ?? null,
      excludeChatId: args.excludeChatId ?? null,
      onlyChatId: args.onlyChatId ?? null,
    });
  },

  memoryClearChat(chatId: string): Promise<number> {
    return invoke<number>("memory_clear_chat", { chatId });
  },

  memoryClearAll(): Promise<number> {
    return invoke<number>("memory_clear_all");
  },

  memoryStats(): Promise<import("../types").MemoryStats> {
    return invoke("memory_stats");
  },

  chatHistoryIndex(args: {
    chatId: string;
    chatTitle?: string | null;
    messageId: string;
    role: string;
    text: string;
  }): Promise<void> {
    return invoke<void>("chat_history_index", {
      chatId: args.chatId,
      chatTitle: args.chatTitle ?? null,
      messageId: args.messageId,
      role: args.role,
      text: args.text,
    });
  },

  chatHistorySearch(query: string, limit?: number): Promise<import("../types").ChatSearchHit[]> {
    return invoke("chat_history_search", { query, limit: limit ?? null });
  },

  chatHistoryClear(chatId: string): Promise<number> {
    return invoke<number>("chat_history_clear", { chatId });
  },

  activeWindow(): Promise<{ title: string; processName: string }> {
    return invoke("active_window");
  },

  // ---- Alarm Audio Cache -------------------------------------------------------

  cacheAlarmAudio(source: "youtube" | "local", urlOrPath: string): Promise<string> {
    return invoke<string>("cache_alarm_audio", { source, urlOrPath });
  },

  // ---- OAuth -----------------------------------------------------------------

  oauthDeviceStart(clientId: string, scopes: string): Promise<{
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresIn: number;
    interval: number;
  }> {
    return invoke("oauth_device_start", { clientId, scopes });
  },

  oauthDevicePoll(clientId: string, deviceCode: string): Promise<{
    status: string;
    accessToken: string | null;
  }> {
    return invoke("oauth_device_poll", { clientId, deviceCode });
  },

  oauthLocalhostStart(provider: string, clientId: string, authUrlBase: string, scopes: string): Promise<{
    authUrl: string;
    port: number;
  }> {
    return invoke("oauth_localhost_start", { provider, clientId, authUrlBase, scopes });
  },

  // ---- Model Detail ----

  modelShow(modelId: string): Promise<import("../types").ModelDetail> {
    return invoke("model_show", { modelId });
  },

  memoryEstimate(params?: {
    hwOverride?: import("../types").HardwareProfile;
    paramCount?: string;
    quantization?: string;
    context?: number;
  }): Promise<import("../types").MemoryEstimate> {
    return invoke("memory_estimate", {
      hwOverride: params?.hwOverride ?? null,
      paramCount: params?.paramCount ?? null,
      quantization: params?.quantization ?? null,
      context: params?.context ?? null,
    });
  },

  // ---- Optimization ----
  optimizationGet(): Promise<import("../types").OptimizationConfig | null> {
    return invoke("optimization_get");
  },
  optimizationSet(config: import("../types").OptimizationConfig): Promise<void> {
    return invoke("optimization_set", { config });
  },
  optimizationAutoDetect(preset?: string, hwOverride?: import("../types").HardwareProfile): Promise<import("../types").OptimizationConfig> {
    return invoke("optimization_auto_detect", { preset: preset ?? null, hwOverride: hwOverride ?? null });
  },
};
