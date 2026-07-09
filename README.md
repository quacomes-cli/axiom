# Axiom

**Axiom** is a local-first AI agent for your desktop — a second brain that runs on your own machine.

Built with **Tauri 2 (Rust)** + **React 19 + TypeScript**, Axiom connects to local models (via Ollama) or cloud providers, and gives them safe, permissioned access to your computer: reading and writing files, running shell commands, browsing the web, and automating multi-step tasks — all under a scoped, user-controlled permission system.

## Highlights

- **Hardware-aware & permission-based** — every filesystem, network, or shell action is checked against an explicit, scoped permission model. Nothing runs behind your back.
- **Deep agent mode** — give it a goal, and it plans, chains tool calls, and synthesizes a result, with a live, expandable status view of every step it takes.
- **Voice assistant** — real-time speech-to-text (Whisper, with live partial transcription) and natural text-to-speech (Piper locally, or Edge TTS for more expressive voices), with barge-in support.
- **MCP client** — connect to Model Context Protocol servers and use their tools directly from chat.
- **Local document library (RAG)** — index PDFs, Word/PowerPoint/Excel files, EPUBs, HTML, and more; the assistant retrieves relevant passages automatically or on demand.
- **App integrations** — GitHub, Telegram, Discord, Notion, and more, with credentials stored securely in the OS credential manager, not in plaintext.
- **Mobile companion** — pair a phone over a direct, end-to-end P2P connection to view and continue chats on the go.
- **Multilingual UI** — English, Turkish, Spanish, German, French, Portuguese, Russian, Japanese, and Chinese.

## Download

Prebuilt Windows installers are published under [Releases](../../releases).

## Status

The source for this project is developed privately. This repository is kept public to host release binaries and update manifests.
