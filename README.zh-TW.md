# AI 模型額度監控 (`ai-quota-monitor`)

[English](README.md) | 繁體中文

在 Antigravity 右側輔助面板（Auxiliary Pane）即時顯示各 AI 模型（如 Gemini 4 Hydrogen、Gemini 4 Argon、Claude、GPT-OSS 等）的剩餘配額百分比、使用量進度條及重置倒數時間，並支援持久化自訂顯示順序。

## 功能特色

- **配額池總覽與分頁篩選**：自動彙整共用配額池的模型變體，支援切換「Gemini 額度」與「全部模型」。
- **自訂模型顯示順序**：點擊「調整順序」即可透過置頂 / 上移 / 下移按鈕或拖曳卡片調整排列順序，並持久化儲存於本地 `order-config.json`（已透過 `.gitignore` 排除）。
- **即時重置倒數**：計算距離下次配額重置的剩餘時間（天 / 時 / 分）與本地重置時間。
- **自動語系切換與主題同步**：依據介面語言自動切換繁體中文或英文（其他語言預設顯示英文），並透過 `sidecar_sdk` 自動同步深淺色主題，支援每 30 秒自動同步或手動立即刷新。

## 安裝方式

### 方式一：透過 Antigravity CLI（`agy`）安裝

```bash
agy plugin install https://github.com/atobad/ai-quota-monitor
```

### 方式二：手動安裝

將本專案 Clone 至全域 Antigravity 插件目錄後，重新啟動 Antigravity 即可使用：

```bash
git clone https://github.com/atobad/ai-quota-monitor.git ~/.gemini/config/plugins/ai-quota-monitor
```

Windows PowerShell：

```powershell
git clone https://github.com/atobad/ai-quota-monitor.git "$env:USERPROFILE\.gemini\config\plugins\ai-quota-monitor"
```

## 目錄結構

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

## 本機驗證與測試

執行單元測試（需具備 Node.js）：

```bash
node --test sidecars/quota-monitor/main.test.mjs
```

若本機已安裝 Antigravity CLI（`agy`），可在提交 Marketplace 前執行嚴格驗證：

```bash
agy plugin validate --strict .
```

## 授權條款

[MIT](LICENSE)
