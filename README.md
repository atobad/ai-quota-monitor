# AI Model Quota Monitor (`ai-quota-monitor`)

English | [繁體中文](README.zh-TW.md)

An **Antigravity UI Sidecar** plugin that displays real-time AI model quota pools (such as Gemini 4 Hydrogen, Gemini 4 Argon, Claude, GPT-OSS, etc.), remaining percentages, progress bars, and reset countdowns directly in the Antigravity Auxiliary Pane, with persistent customizable display ordering.

## Features

- **Shared Quota Pool Overview & Tabs**: Automatically groups model variants that share the same quota pool and lets you switch between **Gemini** and **All Models** views.
- **Customizable Display Order**: Click **調整順序** (Reorder) to move model families to the top, up/down, or drag-and-drop cards. Custom order is persisted locally in `order-config.json` (excluded from Git).
- **Real-Time Reset Countdown**: Shows both the remaining time (`days / hours / minutes`) and the local reset timestamp.
- **Theme Sync & Auto-Refresh**: Automatically inherits Antigravity light/dark theme variables via `sidecar_sdk`, refreshes every 30 seconds, and supports manual instant refresh.

## Installation

### Option 1: Install via Antigravity CLI (`agy`)

```bash
agy plugin install https://github.com/atobad/ai-quota-monitor
```

### Option 2: Manual Installation

Clone this repository into your global Antigravity plugins directory and restart Antigravity:

```bash
git clone https://github.com/atobad/ai-quota-monitor.git ~/.gemini/config/plugins/ai-quota-monitor
```

On Windows PowerShell:

```powershell
git clone https://github.com/atobad/ai-quota-monitor.git "$env:USERPROFILE\.gemini\config\plugins\ai-quota-monitor"
```

## Project Structure

```text
ai-quota-monitor/
├── plugin.json
├── README.md
├── README.zh-TW.md
├── LICENSE
├── assets/logo.svg
├── rules/AGENTS.md
├── skills/ai-quota-monitor/SKILL.md
└── sidecars/quota-monitor/
    ├── sidecar.json
    ├── main.mjs
    └── main.test.mjs
```

## Development & Verification

Run the unit test suite (requires Node.js):

```bash
node --test sidecars/quota-monitor/main.test.mjs
```

Validate plugin schema and structure with Antigravity CLI before publishing:

```bash
agy plugin validate --strict .
```

## License

[MIT](LICENSE)
