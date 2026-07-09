// Shared types that mirror the Rust IPC contracts (src-tauri/src/ipc, runtime/profiler.rs).
// Keep these in sync with the serde structs on the Rust side.

export interface HardwareProfile {
  cpuBrand: string;
  cpuCoresPhysical: number;
  cpuCoresLogical: number;
  totalRamMb: number;
  availableRamMb: number;
  gpuName: string | null;
  gpuVramMb: number | null;
  osName: string;
}

export interface AppInfo {
  name: string;
  version: string;
}

export type ViewId = "chat" | "library" | "tasks" | "models" | "models-manage" | "accelerate" | "code" | "skills" | "apps" | "telegram" | "price-tracker" | "settings";

export const VIEW_ORDER: ViewId[] = ["chat", "code", "library", "models", "models-manage", "accelerate", "apps",  "skills", "telegram", "price-tracker", "tasks", "settings"];

// ---- Permissions (mirror src-tauri/src/permissions/model.rs) ----

export type PermissionLevel = "allowed" | "confirm" | "blocked";

export interface ScopedRule {
  level: PermissionLevel;
  paths: string[];
}

export interface FilesystemPermissions {
  read: ScopedRule;
  write: ScopedRule;
  delete: PermissionLevel;
  watch: ScopedRule;
}

export interface ProcessPermissions {
  launch: PermissionLevel;
  launch_whitelist: string[];
  kill: PermissionLevel;
  list: PermissionLevel;
}

export interface NetworkPermissions {
  outbound: PermissionLevel;
  localhost: PermissionLevel;
  blocked_domains: string[];
}

export interface ShellPermissions {
  execute: PermissionLevel;
  blocked_commands: string[];
}

export interface ScreenPermissions {
  capture: PermissionLevel;
  continuous_watch: PermissionLevel;
}

export interface PermissionConfig {
  filesystem: FilesystemPermissions;
  process: ProcessPermissions;
  network: NetworkPermissions;
  shell: ShellPermissions;
  screen: ScreenPermissions;
}

export type Decision =
  | { kind: "allow" }
  | { kind: "confirm" }
  | { kind: "deny"; reason: string };

// ---- App Settings (mirror src-tauri/src/settings/model.rs) ----

export type Theme = "dark" | "light";
export type FontFamily = "inter" | "system" | "jetbrains";

export interface Shortcuts {
  toggleSidebar: string;
  search: string;
  toggleScreenVision: string;
  newChat: string;
  clipboard: string;
  /** Hızlı palet penceresi — GLOBAL kısayol (uygulama arka plandayken de çalışır). */
  palette: string;
}

export type AlarmSoundSource = "default" | "youtube" | "local";

export interface AlarmSoundConfig {
  source: AlarmSoundSource;
  youtubeUrl?: string;
  localPath?: string;
  cachedPath?: string;
  duration: number;
}

export interface AppSettings {
  theme: Theme;
  /** Arayüz dili: ISO kodu ("en", "tr", ...) veya "system" (OS'ten algıla). */
  language: string;
  fontSize: number;
  fontFamily: FontFamily;
  launchAtStartup: boolean;
  closeToTray: boolean;
  notifyResponse: boolean;
  notifyModelDownload: boolean;
  shortcuts: Shortcuts;
  modelConfig: ModelConfig;
  alarmSound: AlarmSoundConfig;
  voice: VoiceConfig;
  memory: MemoryConfig;
  tts: TtsConfig;
}

export interface TtsConfig {
  enabled: boolean;
  voice: string;     // SpeechSynthesisVoice.name; "" = default
  rate: number;      // 0.5..2.0
  autoSpeak: boolean;
}

export interface VoiceConfig {
  enabled: boolean;
  model: string;       // "base" | "small" | "medium" | ...
  language: string;    // "auto" | "tr" | "en" | ...
  pushToTalk: boolean;
  /** VAD: konuşma bittikten sonra beklenecek sessizlik süresi (ms). */
  vadSilenceMs: number;
  /** VAD: RMS eşiği — düşürmek mikrofonu daha hassas yapar. */
  vadThreshold: number;
}

export interface WhisperModelStatus {
  name: string;
  installed: boolean;
  path: string;
  sizeBytes: number;
}

export interface AudioTranscript {
  text: string;
  sampleCount: number;
  durationMs: number;
}

export interface AudioDownloadEvent {
  modelName: string;
  downloadedBytes: number;
  totalBytes: number;
  done: boolean;
  error: string | null;
}

// ---- Memory / RAG ---------------------------------------------------------

export interface MemoryConfig {
  enabled: boolean;
  embeddingModel: string;   // e.g. "nomic-embed-text"
  topK: number;
  scoreThreshold: number;   // 0..1 cosine
  crossChat: boolean;       // recall across all chats vs only-this-chat
}

export interface MemoryHit {
  id: number;
  chatId: string;
  messageId: string;
  role: string;
  text: string;
  score: number;
  createdAt: number;
}

export interface MemoryStats {
  totalChunks: number;
  totalChats: number;
  embeddingModel: string | null;
  dbSizeBytes: number;
}

export interface ChatSearchHit {
  chatId: string;
  chatTitle: string | null;
  messageId: string;
  role: string;
  text: string;
  createdAt: number;
  snippet: string;
  score: number;
}

// ---- Model Runtime (mirror src-tauri/src/runtime/) ----

export type ProviderKind = "ollama" | "cloud" | "llamacpp";

export interface ModelInfo {
  id: string;
  provider: ProviderKind;
  displayName: string;
  sizeBytes: number | null;
  quantization: string | null;
  parameterCount: string | null;
  contextLength: number | null;
  isActive: boolean;
  family: string | null;
  capabilities: string[] | null;
}

export interface ChatMessage {
  role: string;
  content: string;
  images?: string[];
}

export interface InferenceRequest {
  modelId: string;
  provider: ProviderKind;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  think?: boolean;
  numCtx?: number;
  /** Native function-calling şemaları (src/lib/toolRegistry.ts üretir). */
  tools?: unknown;
}

export interface InferenceResponse {
  content: string;
  tokensUsed: number | null;
  modelId: string;
}

export interface CloudProviderConfig {
  name: string;
  apiKey: string;
  baseUrl: string | null;
  enabled: boolean;
  models: CloudModelDef[];
}

export interface CloudModelDef {
  id: string;
  displayName: string;
  contextLength: number | null;
}

export interface ActiveModelRef {
  provider: ProviderKind;
  modelId: string;
}

export interface ModelConfig {
  ollamaBaseUrl: string;
  cloudProviders: CloudProviderConfig[];
  activeModel: ActiveModelRef | null;
  ggufPaths: string[];
  optimization: OptimizationConfig | null;
}

export type ProfilePreset = "hiz" | "denge" | "kalite" | "ozel";

export interface OptimizationConfig {
  preset: ProfilePreset;
  numGpu: number | null;
  numThread: number | null;
  numCtx: number | null;
  numBatch: number | null;
  mmap: boolean | null;
  useMlock: boolean | null;
  keepAlive: string | null;
  flashAttention: boolean;
  kvCacheType?: string | null;
}

export interface ModelDetail {
  family: string | null;
  parameterSize: string | null;
  quantizationLevel: string | null;
  format: string | null;
  parentModel: string | null;
  contextLength: number | null;
  memoryEstimate: MemoryEstimate;
}

export interface MemoryEstimate {
  modelSizeMb: number;
  kvCacheMb: number;
  totalMb: number;
  fitsVram: boolean;
  fitsRam: boolean;
  recommendedCtx: number;
}

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  path: string | null;
}

// ---- Ollama Library ----

export interface LibraryModel {
  id: string;
  description: string;
  pulls: string;
  updated: string;
  capabilities: string[];
  sizes: string[];
}

// ---- Skills ----

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  author: string;
  stars: number;
  url: string;
  topics: string[];
  avatarUrl: string;
}

export interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  systemPrompt: string;
  enabled: boolean;
  installedAt: number;
  sourceUrl: string;
}

export interface SkillContent {
  prompt: string;
  sourceFile: string;
}

// ---- Documents ----

export interface DocumentAttachment {
  id: string;
  filename: string;
  filePath: string;
  mimeType: string;
  extractedText: string;
  sizeBytes: number;
  base64Data?: string;
}

export interface ParsedDocument {
  filename: string;
  mimeType: string;
  extractedText: string;
  sizeBytes: number;
  base64Data?: string;
}

// ---- User Profile (Identification Engine) ----

export interface UserProfile {
  // Manuel alanlar (kullanıcı kendisi girer)
  name?: string;
  surname?: string;
  email?: string;
  location?: string;
  birthDate?: string;
  customFields: Array<{ key: string; value: string }>;

  // Otomatik çıkarılan alanlar (Identification Engine)
  profession?: string;
  interests: string[];
  languagePreference?: "tr" | "en" | "mixed";
  responseStyle?: string;
  jargon: string[];
  recurringTopics: string[];
  notes: string[];
  lastUpdated: number;
  factCount: number;
}

// ---- Code Tool ----

export type ToolActionKind = "read_file" | "write_file" | "run_command" | "list_dir" | "create_dir" | "web_search" | "search_docs" | "app_tool" | "get_settings" | "change_setting" | "weather" | "currency" | "create_task" | "list_tasks" | "update_task" | "complete_task" | "delete_task" | "schedule_task" | "edit_file" | "search" | "glob" | "delete_file" | "rename_file" | "mcp_call";

// ---- MCP (Model Context Protocol) ----

export interface McpServerConfig {
  name: string;
  /** Çalıştırılacak komut: "npx", "uvx" veya tam yol. */
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
}

export interface McpToolInfo {
  name: string;
  description: string;
  /** JSON Schema — native tool şemasına aynen geçer. */
  inputSchema: unknown;
}

export interface McpServerStatus {
  name: string;
  connected: boolean;
  toolCount: number;
}

export interface ToolAction {
  kind: ToolActionKind;
  path?: string;
  command?: string;
  content?: string;
  exitCode?: number;
  collapsed: boolean;
  cardType?: "weather" | "currency";
  cardData?: unknown;
  diff?: string;
  added?: number;
  removed?: number;
  toPath?: string;
}

export interface EditResult {
  path: string;
  diff: string;
  added: number;
  removed: number;
}

export interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

export interface CodeMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolActions: ToolAction[];
  timestamp: number;
}

export interface ShellOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  sizeBytes: number | null;
}

export interface ReadFileResult {
  content: string;
  path: string;
  sizeBytes: number;
}

// ---- Web Search ----

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ---- Weather ----

export interface WeatherData {
  city: string;
  tempC: number;
  feelsLikeC: number;
  humidity: number;
  description: string;
  windKph: number;
  icon: string;
  forecast: ForecastDay[];
}

export interface ForecastDay {
  date: string;
  maxTempC: number;
  minTempC: number;
  icon: string;
}

// ---- Currency ----

export interface CurrencyData {
  rates: CurrencyRate[];
  lastUpdated: string;
}

export interface CurrencyRate {
  code: string;
  name: string;
  rate: number;
  symbol: string;
}

// ---- Belge kütüphanesi (RAG) — mirror src-tauri/src/memory/docs.rs ----

export interface DocMeta {
  id: string;
  path: string;
  title: string;
  mime: string;
  sizeBytes: number;
  chunkCount: number;
  addedAt: number;
}

export interface DocHit {
  docId: string;
  title: string;
  seq: number;
  text: string;
  score: number;
}

export interface DocsIndexEvent {
  path: string;
  title: string;
  current: number;
  total: number;
  done: boolean;
  error: string | null;
}
