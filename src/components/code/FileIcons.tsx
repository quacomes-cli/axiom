import {
  SiTypescript,
  SiJavascript,
  SiReact,
  SiPython,
  SiRust,
  SiHtml5,
  SiJson,
  SiMarkdown,
  SiGo,
  SiVuedotjs,
  SiSvelte,
  SiDocker,
  SiGit,
  SiSwift,
  SiPhp,
  SiRuby,
  SiCplusplus,
  SiC,
  SiDotnet,
  SiKotlin,
  SiDart,
  SiGraphql,
  SiGnubash,
  SiYaml,
  SiToml,
  SiSqlite,
  SiSass,
  SiWebassembly,
  SiXml,
} from "react-icons/si";
import { FaCss3} from "react-icons/fa";
import {
  VscFile,
  VscFileMedia,
  VscLock,
  VscSettingsGear,
  VscTerminalPowershell,
  VscSymbolMisc,
} from "react-icons/vsc";
import { FaFolder, FaFolderOpen } from "react-icons/fa";
import type { IconType } from "react-icons";
import { FaJava } from "react-icons/fa6";

const EXT_ICONS: Record<string, IconType> = {
  ts: SiTypescript,
  mts: SiTypescript,
  tsx: SiReact,
  jsx: SiReact,
  js: SiJavascript,
  mjs: SiJavascript,
  py: SiPython,
  pyi: SiPython,
  rs: SiRust,
  html: SiHtml5,
  htm: SiHtml5,
  css: FaCss3,
  scss: SiSass,
  sass: SiSass,
  json: SiJson,
  jsonc: SiJson,
  md: SiMarkdown,
  mdx: SiMarkdown,
  go: SiGo,
  java: FaJava,
  vue: SiVuedotjs,
  svelte: SiSvelte,
  swift: SiSwift,
  php: SiPhp,
  rb: SiRuby,
  cpp: SiCplusplus,
  hpp: SiCplusplus,
  cc: SiCplusplus,
  c: SiC,
  h: SiC,
  cs: SiDotnet,
  kt: SiKotlin,
  dart: SiDart,
  graphql: SiGraphql,
  gql: SiGraphql,
  sh: SiGnubash,
  bash: SiGnubash,
  zsh: SiGnubash,
  ps1: VscTerminalPowershell,
  yaml: SiYaml,
  yml: SiYaml,
  toml: SiToml,
  sql: SiSqlite,
  xml: SiXml,
  wasm: SiWebassembly,
  svg: VscFileMedia,
  png: VscFileMedia,
  jpg: VscFileMedia,
  jpeg: VscFileMedia,
  gif: VscFileMedia,
  ico: VscFileMedia,
  webp: VscFileMedia,
  lock: VscLock,
  env: VscSettingsGear,
  log: VscSymbolMisc,
};

const FILENAME_ICONS: Record<string, IconType> = {
  dockerfile: SiDocker,
  "docker-compose.yml": SiDocker,
  "docker-compose.yaml": SiDocker,
  ".dockerignore": SiDocker,
  ".gitignore": SiGit,
  ".gitmodules": SiGit,
  ".gitattributes": SiGit,
  ".env": VscSettingsGear,
  ".env.local": VscSettingsGear,
  ".env.production": VscSettingsGear,
};

export function FileIcon({ name, size = 14 }: { name: string; size?: number }) {
  const lower = name.toLowerCase();
  const ext = lower.split(".").pop() ?? "";
  const Icon = FILENAME_ICONS[lower] ?? EXT_ICONS[ext] ?? VscFile;
  return <Icon size={size} className="shrink-0 text-text-secondary" />;
}

export function FolderIcon({ open, size = 14 }: { open: boolean; size?: number }) {
  const Icon = open ? FaFolderOpen : FaFolder;
  return <Icon size={size} className="shrink-0 text-amber-400/70" />;
}
