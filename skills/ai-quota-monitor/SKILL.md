---
name: ai-quota-monitor
description: Displays real-time AI model usage quotas, remaining percentages, and reset countdowns in the Auxiliary Pane sidecar. Use when the user asks to check or monitor their model usage quota.
---

# AI 模型額度監控 (`ai-quota-monitor`)

The **AI 模型額度監控** sidecar displays real-time model quota pools, remaining percentages, and reset timers in the Antigravity auxiliary side pane.

## Surfacing the Sidecar Panel

Whenever the user asks to see their model usage quota in the UI, include the following pill link in your response:

```markdown
[AI 模型額度監控](sidecar://ai-quota-monitor/quota-monitor/)
```
