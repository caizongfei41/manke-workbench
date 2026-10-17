# Manke Workbench (漫客工作台)

**A local-first image and video creation workbench for ComfyUI.**

Everything runs against your own ComfyUI instance — no account, no API key, no
asset ever leaves your machine. The primary UI language is Chinese; English and
Japanese catalogues ship alongside it.

![Manke Workbench home](docs/assets/home.png)

> This is a fork of [BeatDesign](https://github.com/BeatAPI/BeatDesign)
> (Apache-2.0). See [NOTICE](NOTICE) for the list of changes.
> The full documentation is currently written in Chinese:
> [README.md](README.md) · [deployment guide](docs/DEPLOYMENT-WINDOWS.zh-CN.md).

---

## What it is

Four views over a single local project:

| View | Purpose |
| --- | --- |
| **Studio** | Prompt-driven generation with a feed of past results |
| **Canvas** | Infinite canvas for composing assets and generation nodes |
| **Editor** | Browser-native timeline editor, exports without system FFmpeg |
| **Assets** | One library for everything the project has produced |

## What this fork adds

- **A local ComfyUI generation provider** — the workspace generates through a
  local ComfyUI instance instead of a hosted API.
- **Per-step generation progress** — step counts are read from ComfyUI's
  WebSocket and rendered as a progress bar with `step N/M`.
- **A local model catalogue** — 16 image, video and TTS models, each backed by an
  ordinary ComfyUI API-format workflow JSON in `data/comfyui/workflows/`.
- **Windows deployment tooling** — a one-click launcher and a GUI start/stop
  console, no command windows to keep open.
- **Chinese and Japanese UI.**

## Quick start

Requirements: Node.js ≥ 22, pnpm ≥ 10, and a reachable ComfyUI (default
`http://127.0.0.1:8188`).

```bash
git clone https://github.com/caizongfei41/manke-workbench.git
cd manke-workbench
pnpm install
# edit data/comfyui.config.json to point at your ComfyUI
pnpm build
pnpm start          # http://127.0.0.1:3020
```

The bundled workflow templates expect specific ComfyUI custom nodes and model
weights (Qwen Image 2.1, Flux.2 Klein, MiniMax H3, SeedVR2, DLSS …). Those are
not vendored here; a model whose nodes are missing is reported as unavailable
rather than failing silently. Run `node scripts/validate-templates.mjs` to check
your environment.

## Development

```bash
pnpm dev            # dev server with HMR
pnpm typecheck
pnpm test
pnpm i18n:check
pnpm build
```

## Licence and provenance

- Code: [Apache License 2.0](LICENSE).
- Forked from **BeatDesign**, Copyright 2026 BeatAPI. Modifications are listed in
  [NOTICE](NOTICE) as required by section 4(b) of the licence.
- "BeatDesign" and "BeatAPI" are trademarks of BeatAPI; they appear here only to
  describe the origin of this work. This fork is not endorsed by or affiliated
  with BeatAPI. See [docs/TRADEMARKS.md](docs/TRADEMARKS.md).
