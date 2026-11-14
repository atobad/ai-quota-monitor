# AI 模型額度監控 (`ai-quota-monitor`)

在 Antigravity 右側輔助面板（Auxiliary Pane）即時顯示各 AI 模型（如 Gemini 4 Hydrogen、Gemini 4 Argon、Claude、GPT-OSS 等）的剩餘配額百分比、使用量進度條及重置倒數時間，並支援自訂顯示順序。

## 功能特色

- **配額池總覽與分頁篩選**：自動彙整共用配額池的模型群組，支援切換「Gemini 額度」與「全部模型」。
- **自訂模型顯示順序**：點擊「調整順序」即可透過置頂 / 上移 / 下移按鈕或拖曳卡片調整排列順序，並持久化儲存於本地。
- **即時重置倒數**：計算距離下次配額重置的剩餘時間（天 / 時 / 分）與本地重置時間。
- **主題同步與自動更新**：透過 Antigravity `sidecar_sdk` 自動同步深淺色主題，支援每 30 秒自動同步或手動立即刷新。

## 目錄結構

```text
ai-quota-monitor/
├── plugin.json
├── README.md
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

```bash
node --test sidecars/quota-monitor/main.test.mjs
```

若本機已安裝 Antigravity CLI（`agy`），可在提交 Marketplace 前執行嚴格驗證：

```bash
agy plugin validate --strict .
```
