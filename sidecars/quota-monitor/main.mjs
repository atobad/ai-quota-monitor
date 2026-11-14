/**
 * @fileoverview Antigravity Sidecar for monitoring Gemini & AI model usage quotas.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarApp } from 'sidecar_sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ORDER_FILE = join(__dirname, 'order-config.json');

export const DEFAULT_FAMILY_ORDER = [
  'Gemini 4 Hydrogen',
  'Gemini 4 Argon',
  'Orchestrator (Argon)',
];

/**
 * Resolves UI language ('zh' or 'en') from candidate locale strings.
 * Defaults to 'en' for any language other than Chinese or English.
 * @param {string | string[] | null | undefined} candidates
 * @returns {'zh' | 'en'}
 */
export function resolveUiLocale(candidates) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const normalized = raw.trim().toLowerCase();
    if (!normalized) continue;
    if (normalized === 'zh' || normalized.startsWith('zh-') || normalized.startsWith('zh_')) {
      return 'zh';
    }
    return 'en';
  }
  return 'en';
}

/**
 * Extracts a normalized model family name by stripping effort suffixes like "(High)", "(XHigh)", "(Medium)", "(Low)".
 * @param {string} label
 * @returns {string}
 */
export function extractModelFamily(label) {
  if (!label || typeof label !== 'string') return 'Unknown Model';
  return label.replace(/\s*\((X?Low|Medium|X?High|Fast|Thinking|Minimal)\)\s*$/i, '').trim() || label.trim();
}

/**
 * Loads the persisted custom family order from disk, falling back to DEFAULT_FAMILY_ORDER.
 * @param {string} [filePath]
 * @returns {string[]}
 */
export function loadFamilyOrder(filePath = DEFAULT_ORDER_FILE) {
  try {
    if (!existsSync(filePath)) {
      return [...DEFAULT_FAMILY_ORDER];
    }
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (Array.isArray(raw?.order)) {
      return raw.order.filter((item) => typeof item === 'string' && item.trim().length > 0);
    }
  } catch {
    // Fall back to default order if config file is corrupted or unreadable
  }
  return [...DEFAULT_FAMILY_ORDER];
}

/**
 * Persists the custom family order to disk.
 * @param {string[]} order
 * @param {string} [filePath]
 * @returns {string[]}
 */
export function saveFamilyOrder(order, filePath = DEFAULT_ORDER_FILE) {
  const sanitized = Array.isArray(order)
    ? Array.from(new Set(order.filter((item) => typeof item === 'string' && item.trim().length > 0)))
    : [...DEFAULT_FAMILY_ORDER];
  writeFileSync(
    filePath,
    JSON.stringify({ order: sanitized, updatedAt: new Date().toISOString() }, null, 2),
    'utf-8'
  );
  return sanitized;
}

/**
 * Sorts pool or model items by the provided family order, then Gemini-first, then alphabetically.
 * @template T
 * @param {T[]} items
 * @param {string[]} [familyOrder]
 * @returns {T[]}
 */
export function sortByFamilyOrder(items, familyOrder = DEFAULT_FAMILY_ORDER) {
  const rank = new Map();
  familyOrder.forEach((name, idx) => {
    if (!rank.has(name)) {
      rank.set(name, idx);
    }
  });

  return [...items].sort((a, b) => {
    const rankA = rank.has(a.family) ? rank.get(a.family) : Number.MAX_SAFE_INTEGER;
    const rankB = rank.has(b.family) ? rank.get(b.family) : Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    if (a.isGemini !== b.isGemini) return a.isGemini ? -1 : 1;
    return a.family.localeCompare(b.family);
  });
}

/**
 * Transforms the raw GetUserStatus payload from LanguageServerService into structured quota data.
 * @param {object} rawResponse
 * @param {string} [nowIso]
 * @param {string[]} [familyOrder]
 * @returns {object}
 */
export function transformUserStatus(
  rawResponse,
  nowIso = new Date().toISOString(),
  familyOrder = DEFAULT_FAMILY_ORDER
) {
  const userStatus = rawResponse?.userStatus ?? {};
  const planInfo = userStatus?.planStatus?.planInfo ?? {};
  const userTier = userStatus?.userTier ?? {};
  const configs = Array.isArray(userStatus?.cascadeModelConfigData?.clientModelConfigs)
    ? userStatus.cascadeModelConfigData.clientModelConfigs
    : [];

  const models = configs.map((cfg) => {
    const label = cfg.label || cfg.modelId || 'Unknown';
    const modelId = cfg.modelId || '';
    const family = extractModelFamily(label);
    const isGemini = /gemini/i.test(label) || /gemini/i.test(modelId);
    const rawFraction = cfg.quotaInfo?.remainingFraction;
    const hasQuota = typeof rawFraction === 'number' && Number.isFinite(rawFraction);
    const remainingFraction = hasQuota ? Math.max(0, Math.min(1, rawFraction)) : null;
    const remainingPercent = remainingFraction !== null
      ? Math.round(remainingFraction * 1000) / 10
      : null;
    const usedPercent = remainingPercent !== null
      ? Math.round((100 - remainingPercent) * 10) / 10
      : null;
    const resetTime = cfg.quotaInfo?.resetTime || null;

    return {
      label,
      modelId,
      family,
      isGemini,
      remainingFraction,
      remainingPercent,
      usedPercent,
      resetTime,
      tagTitle: cfg.tagTitle || null,
      tagDescription: cfg.tagDescription || null,
    };
  });

  // Group models that share the same family + quota state into shared quota pools
  const poolMap = new Map();
  for (const model of models) {
    const poolKey = `${model.family}|${model.remainingFraction ?? 'na'}|${model.resetTime ?? 'na'}`;
    if (!poolMap.has(poolKey)) {
      poolMap.set(poolKey, {
        family: model.family,
        isGemini: model.isGemini,
        remainingFraction: model.remainingFraction,
        remainingPercent: model.remainingPercent,
        usedPercent: model.usedPercent,
        resetTime: model.resetTime,
        variants: [],
      });
    }
    poolMap.get(poolKey).variants.push(model.label);
  }

  const pools = sortByFamilyOrder(Array.from(poolMap.values()), familyOrder);
  const sortedModels = sortByFamilyOrder(models, familyOrder);

  return {
    updatedAt: nowIso,
    familyOrder,
    tier: {
      name: userTier.name || planInfo.planName || 'Standard',
      description: userTier.description || '',
      teamsTier: planInfo.teamsTier || '',
      upgradeUri: userTier.upgradeSubscriptionUri || null,
      upgradeText: userTier.upgradeSubscriptionText || null,
    },
    credits: {
      availablePromptCredits: userStatus?.planStatus?.availablePromptCredits ?? null,
      availableFlowCredits: userStatus?.planStatus?.availableFlowCredits ?? null,
      monthlyPromptCredits: planInfo.monthlyPromptCredits ?? null,
      monthlyFlowCredits: planInfo.monthlyFlowCredits ?? null,
    },
    pools,
    models: sortedModels,
  };
}

/**
 * Queries the local Antigravity Language Server Connect-RPC endpoint for current user status.
 * @param {object} [options]
 * @param {string} [options.lsAddress]
 * @param {string} [options.csrfToken]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {string} [options.orderFile]
 * @returns {Promise<object>}
 */
export async function fetchQuotaData({
  lsAddress = process.env.ANTIGRAVITY_LS_ADDRESS || 'localhost:5387',
  csrfToken = process.env.ANTIGRAVITY_CSRF_TOKEN || '',
  fetchImpl = fetch,
  orderFile = DEFAULT_ORDER_FILE,
} = {}) {
  const url = `http://${lsAddress}/exa.language_server_pb.LanguageServerService/GetUserStatus`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-codeium-csrf-token': csrfToken,
    },
    body: '{}',
  });

  if (!response.ok) {
    throw new Error(`LanguageServer GetUserStatus failed with HTTP ${response.status}`);
  }

  const raw = await response.json();
  const familyOrder = loadFamilyOrder(orderFile);
  return transformUserStatus(raw, new Date().toISOString(), familyOrder);
}

/**
 * Renders the HTML page for the Auxiliary Pane UI.
 * @returns {string}
 */
export function renderHtml() {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI 模型額度監控</title>
  <script src="/preload.js"></script>
  <style>
    :root {
      --card-bg: rgba(127, 127, 127, 0.08);
      --card-border: rgba(127, 127, 127, 0.2);
      --muted: rgba(127, 127, 127, 0.85);
      --accent: #38bdf8;
      --good: #22c55e;
      --warn: #f59e0b;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      background: var(--background, #0f172a);
      color: var(--foreground, #f8fafc);
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 14px;
      flex-wrap: wrap;
    }
    .title-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .title {
      font-size: 16px;
      font-weight: 700;
      margin: 0;
    }
    .tier-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(56, 189, 248, 0.16);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.35);
    }
    .controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      gap: 8px;
    }
    button {
      font: inherit;
      font-size: 12px;
      padding: 5px 10px;
      border-radius: 6px;
      border: 1px solid var(--card-border);
      background: var(--card-bg);
      color: inherit;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    button:hover { opacity: 0.85; }
    button:disabled { opacity: 0.5; cursor: default; }
    .tabs {
      display: flex;
      gap: 6px;
      margin-bottom: 12px;
    }
    .tab-btn {
      flex: 1;
      text-align: center;
      padding: 6px 8px;
      font-weight: 500;
    }
    .tab-btn.active {
      border-color: var(--accent);
      background: rgba(56, 189, 248, 0.15);
      color: var(--accent);
      font-weight: 600;
    }
    .section-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      opacity: 0.75;
      margin: 14px 0 8px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 12px;
      margin-bottom: 10px;
    }
    .card.gemini-card {
      border-color: rgba(56, 189, 248, 0.35);
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 6px;
    }
    .model-name {
      font-weight: 600;
      font-size: 14px;
    }
    .pct-value {
      font-size: 16px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .progress-track {
      width: 100%;
      height: 8px;
      background: rgba(127, 127, 127, 0.2);
      border-radius: 999px;
      overflow: hidden;
      margin: 8px 0;
    }
    .progress-fill {
      height: 100%;
      border-radius: 999px;
      transition: width 0.3s ease;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11.5px;
      opacity: 0.82;
      flex-wrap: wrap;
      gap: 4px;
    }
    .variants {
      font-size: 11px;
      opacity: 0.7;
      margin-top: 6px;
    }
    .status-footer {
      margin-top: 14px;
      font-size: 11px;
      opacity: 0.7;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
    }
    .error-box {
      padding: 10px 12px;
      border-radius: 8px;
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: var(--danger);
      margin-bottom: 12px;
      display: none;
    }
    .btn-active {
      border-color: var(--accent);
      background: rgba(56, 189, 248, 0.18);
      color: var(--accent);
      font-weight: 600;
    }
    .order-toolbar {
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 10px;
      margin-bottom: 10px;
      border-radius: 8px;
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.3);
      font-size: 12px;
      flex-wrap: wrap;
    }
    .order-toolbar.visible {
      display: flex;
    }
    .order-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .order-btn {
      padding: 2px 7px;
      font-size: 11px;
      line-height: 1.4;
    }
    .rank-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 4px;
      background: rgba(127, 127, 127, 0.2);
      margin-right: 6px;
      font-variant-numeric: tabular-nums;
    }
    .card.reorderable {
      cursor: grab;
    }
    .card.drag-over {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.25);
    }
    .save-hint {
      font-size: 11px;
      color: var(--good);
      opacity: 0;
      transition: opacity 0.2s;
    }
    .save-hint.visible {
      opacity: 1;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title-group">
      <h1 id="app-title" class="title">AI 模型額度監控</h1>
      <span id="tier-badge" class="tier-badge">...</span>
    </div>
    <div class="controls">
      <button id="refresh-btn" type="button">立即刷新</button>
      <button id="order-toggle-btn" type="button">調整順序</button>
    </div>
  </div>

  <div id="error-box" class="error-box"></div>

  <div id="order-toolbar" class="order-toolbar">
    <span id="order-toolbar-hint">點擊 ⤒ ↑ ↓ 或拖曳卡片調整顯示順序</span>
    <div class="order-actions">
      <span id="save-hint" class="save-hint">已儲存</span>
      <button id="reset-order-btn" type="button" class="order-btn">恢復預設</button>
    </div>
  </div>

  <div class="tabs">
    <button id="tab-gemini" class="tab-btn active" data-filter="gemini" type="button">Gemini 額度</button>
    <button id="tab-all" class="tab-btn" data-filter="all" type="button">全部模型</button>
  </div>

  <div id="pools-section-title" class="section-title">配額池總覽 (Shared Quota Pools)</div>
  <div id="pools-container"></div>

  <div id="models-section-title" class="section-title">各模型明細 (Model Variants)</div>
  <div id="models-container"></div>

  <div class="status-footer">
    <span id="updated-at">尚未同步</span>
    <span id="auto-sync-label">每 30 秒自動同步</span>
  </div>

  <script>
    const I18N = {
      zh: {
        title: 'AI 模型額度監控',
        loading: '載入中...',
        refresh: '立即刷新',
        syncing: '同步中...',
        reorder: '調整順序',
        done: '完成調整',
        reorderHint: '點擊 ⤒ ↑ ↓ 或拖曳卡片調整顯示順序',
        saved: '已儲存',
        resetDefault: '恢復預設',
        tabGemini: 'Gemini 額度',
        tabAll: '全部模型',
        poolsTitle: '配額池總覽 (Shared Quota Pools)',
        modelsTitle: '各模型明細 (Model Variants)',
        notSynced: '尚未同步',
        autoSync: '每 30 秒自動同步',
        emptyPools: '目前沒有符合篩選條件的配額池資料。',
        emptyModels: '無模型明細。',
        remainingPrefix: '剩餘 ',
        usedPrefix: '已使用 ',
        modelsPrefix: '包含模型：',
        noResetInfo: '無重置時間資訊',
        unknown: '未知',
        resettingSoon: '即將重置',
        countdownPrefix: '重置倒數：',
        resetAtPrefix: '重置時間：',
        dayUnit: ' 天',
        hourUnit: ' 小時',
        minUnit: ' 分',
        moveTop: '移至第一',
        moveUp: '上移',
        moveDown: '下移',
        updatedPrefix: '最後更新：',
        errLoad: '無法取得額度資料：',
        errSaveOrder: '儲存順序失敗：',
        errResetOrder: '恢復預設順序失敗：',
        dateLocale: 'zh-TW'
      },
      en: {
        title: 'AI Model Quota Monitor',
        loading: 'Loading...',
        refresh: 'Refresh',
        syncing: 'Syncing...',
        reorder: 'Reorder',
        done: 'Done',
        reorderHint: 'Click ⤒ ↑ ↓ or drag cards to reorder',
        saved: 'Saved',
        resetDefault: 'Reset Default',
        tabGemini: 'Gemini',
        tabAll: 'All Models',
        poolsTitle: 'Shared Quota Pools',
        modelsTitle: 'Model Variants',
        notSynced: 'Not synced yet',
        autoSync: 'Auto-sync every 30s',
        emptyPools: 'No quota pools match the current filter.',
        emptyModels: 'No model variants available.',
        remainingPrefix: 'Left ',
        usedPrefix: 'Used ',
        modelsPrefix: 'Models: ',
        noResetInfo: 'No reset info',
        unknown: 'Unknown',
        resettingSoon: 'Resetting soon',
        countdownPrefix: 'Resets in: ',
        resetAtPrefix: 'Reset at: ',
        dayUnit: 'd',
        hourUnit: 'h',
        minUnit: 'm',
        moveTop: 'Move to top',
        moveUp: 'Move up',
        moveDown: 'Move down',
        updatedPrefix: 'Updated: ',
        errLoad: 'Failed to load quota: ',
        errSaveOrder: 'Failed to save order: ',
        errResetOrder: 'Failed to reset order: ',
        dateLocale: 'en-US'
      }
    };

    function detectLocale(overrideLocale) {
      const params = new URLSearchParams(window.location.search);
      const candidates = [
        overrideLocale,
        params.get('lang'),
        params.get('locale'),
        ...(Array.isArray(navigator.languages) ? navigator.languages : []),
        navigator.language,
        Intl.DateTimeFormat().resolvedOptions().locale
      ];
      for (const raw of candidates) {
        if (typeof raw !== 'string') continue;
        const normalized = raw.trim().toLowerCase();
        if (!normalized) continue;
        if (normalized === 'zh' || normalized.startsWith('zh-') || normalized.startsWith('zh_')) {
          return 'zh';
        }
        return 'en';
      }
      return 'en';
    }

    let currentLang = detectLocale();
    let currentFilter = 'gemini';
    let latestData = null;
    let isEditOrder = false;
    let dragSourceFamily = null;
    let saveHintTimer = null;

    function t(key) {
      return (I18N[currentLang] && I18N[currentLang][key]) || I18N.en[key] || key;
    }

    function applyStaticTranslations() {
      document.documentElement.lang = currentLang === 'zh' ? 'zh-Hant' : 'en';
      document.title = t('title');
      document.getElementById('app-title').textContent = t('title');
      if (!latestData) {
        document.getElementById('tier-badge').textContent = t('loading');
      }
      const refreshBtn = document.getElementById('refresh-btn');
      if (!refreshBtn.disabled) refreshBtn.textContent = t('refresh');
      document.getElementById('order-toggle-btn').textContent = isEditOrder ? t('done') : t('reorder');
      document.getElementById('order-toolbar-hint').textContent = t('reorderHint');
      document.getElementById('save-hint').textContent = t('saved');
      document.getElementById('reset-order-btn').textContent = t('resetDefault');
      document.getElementById('tab-gemini').textContent = t('tabGemini');
      document.getElementById('tab-all').textContent = t('tabAll');
      document.getElementById('pools-section-title').textContent = t('poolsTitle');
      document.getElementById('models-section-title').textContent = t('modelsTitle');
      if (!latestData) {
        document.getElementById('updated-at').textContent = t('notSynced');
      }
      document.getElementById('auto-sync-label').textContent = t('autoSync');
    }

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'locale-change' || event.data?.type === 'language-change') {
        const nextLocale = event.data?.payload?.locale || event.data?.payload?.language || event.data?.locale;
        if (nextLocale) {
          currentLang = detectLocale(nextLocale);
          applyStaticTranslations();
          render();
        }
      }
    });

    function statusColor(pct) {
      if (pct === null || pct === undefined) return 'var(--accent)';
      if (pct >= 50) return 'var(--good)';
      if (pct >= 20) return 'var(--warn)';
      return 'var(--danger)';
    }

    function formatCountdown(resetTimeIso) {
      if (!resetTimeIso) return t('noResetInfo');
      const target = new Date(resetTimeIso).getTime();
      const now = Date.now();
      const diffMs = target - now;
      if (Number.isNaN(target)) return t('unknown');
      if (diffMs <= 0) return t('resettingSoon');

      const totalMinutes = Math.floor(diffMs / 60000);
      const days = Math.floor(totalMinutes / (60 * 24));
      const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
      const minutes = totalMinutes % 60;

      const parts = [];
      if (days > 0) parts.push(days + t('dayUnit'));
      if (hours > 0 || days > 0) parts.push(hours + t('hourUnit'));
      parts.push(minutes + t('minUnit'));
      return t('countdownPrefix') + parts.join(' ');
    }

    function formatLocalTime(resetTimeIso) {
      if (!resetTimeIso) return '';
      const d = new Date(resetTimeIso);
      if (Number.isNaN(d.getTime())) return '';
      return t('resetAtPrefix') + d.toLocaleString(t('dateLocale'), {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    }

    function escapeHtml(str) {
      return String(str ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[c]);
    }

    function showSavedHint() {
      const hint = document.getElementById('save-hint');
      hint.classList.add('visible');
      if (saveHintTimer) clearTimeout(saveHintTimer);
      saveHintTimer = setTimeout(() => hint.classList.remove('visible'), 1800);
    }

    function applyOrderLocally(newOrder) {
      if (!latestData) return;
      const rank = new Map();
      newOrder.forEach((name, idx) => {
        if (!rank.has(name)) rank.set(name, idx);
      });
      const cmp = (a, b) => {
        const ra = rank.has(a.family) ? rank.get(a.family) : Number.MAX_SAFE_INTEGER;
        const rb = rank.has(b.family) ? rank.get(b.family) : Number.MAX_SAFE_INTEGER;
        if (ra !== rb) return ra - rb;
        if (a.isGemini !== b.isGemini) return a.isGemini ? -1 : 1;
        return a.family.localeCompare(b.family);
      };
      latestData.familyOrder = newOrder;
      latestData.pools = [...(latestData.pools || [])].sort(cmp);
      latestData.models = [...(latestData.models || [])].sort(cmp);
    }

    async function persistOrder(newOrder) {
      applyOrderLocally(newOrder);
      render();
      try {
        const fetcher = window.sidecar?.fetch ? window.sidecar.fetch : fetch;
        const res = await fetcher('/api/order', {
          method: 'POST',
          body: JSON.stringify({ order: newOrder })
        });
        if (!res.ok) {
          throw new Error('HTTP ' + res.status);
        }
        showSavedHint();
      } catch (err) {
        const errBox = document.getElementById('error-box');
        errBox.textContent = t('errSaveOrder') + (err.message || String(err));
        errBox.style.display = 'block';
      }
    }

    function computeReorderedList(family, actionOrTargetFamily) {
      const allPools = latestData?.pools || [];
      const allUniqueFamilies = Array.from(new Set(allPools.map((p) => p.family)));
      const visibleFamilies = Array.from(
        new Set(allPools.filter((p) => currentFilter === 'all' || p.isGemini).map((p) => p.family))
      );
      const idx = visibleFamilies.indexOf(family);
      if (idx === -1) return null;

      const nextVisible = [...visibleFamilies];
      if (actionOrTargetFamily === 'top') {
        nextVisible.splice(idx, 1);
        nextVisible.unshift(family);
      } else if (actionOrTargetFamily === 'up' && idx > 0) {
        [nextVisible[idx - 1], nextVisible[idx]] = [nextVisible[idx], nextVisible[idx - 1]];
      } else if (actionOrTargetFamily === 'down' && idx < nextVisible.length - 1) {
        [nextVisible[idx + 1], nextVisible[idx]] = [nextVisible[idx], nextVisible[idx + 1]];
      } else if (typeof actionOrTargetFamily === 'string' && !['top', 'up', 'down'].includes(actionOrTargetFamily)) {
        const targetIdx = nextVisible.indexOf(actionOrTargetFamily);
        if (targetIdx === -1 || targetIdx === idx) return null;
        nextVisible.splice(idx, 1);
        nextVisible.splice(targetIdx, 0, family);
      } else {
        return null;
      }

      const visibleSet = new Set(visibleFamilies);
      let vCursor = 0;
      return allUniqueFamilies.map((fam) => {
        if (visibleSet.has(fam)) {
          return nextVisible[vCursor++];
        }
        return fam;
      });
    }

    function render() {
      if (!latestData) return;

      const tierBadge = document.getElementById('tier-badge');
      tierBadge.textContent = latestData.tier?.name || 'Standard';

      const poolsEl = document.getElementById('pools-container');
      const modelsEl = document.getElementById('models-container');

      const filteredPools = (latestData.pools || []).filter(
        (p) => currentFilter === 'all' || p.isGemini
      );
      const filteredModels = (latestData.models || []).filter(
        (m) => currentFilter === 'all' || m.isGemini
      );

      if (filteredPools.length === 0) {
        poolsEl.innerHTML = \`<div class="card">\${escapeHtml(t('emptyPools'))}</div>\`;
      } else {
        poolsEl.innerHTML = filteredPools.map((pool, index) => {
          const pct = pool.remainingPercent;
          const used = pool.usedPercent;
          const color = statusColor(pct);
          const pctText = pct !== null ? pct.toFixed(1) + '%' : 'N/A';
          const usedText = used !== null ? t('usedPrefix') + used.toFixed(1) + '%' : '';
          const width = pct !== null ? Math.max(0, Math.min(100, pct)) : 0;
          const isFirst = index === 0;
          const isLast = index === filteredPools.length - 1;
          const orderControls = isEditOrder ? \`
            <div class="order-actions">
              <button type="button" class="order-btn" data-move="top" data-family="\${escapeHtml(pool.family)}" \${isFirst ? 'disabled' : ''} title="\${escapeHtml(t('moveTop'))}">⤒</button>
              <button type="button" class="order-btn" data-move="up" data-family="\${escapeHtml(pool.family)}" \${isFirst ? 'disabled' : ''} title="\${escapeHtml(t('moveUp'))}">↑</button>
              <button type="button" class="order-btn" data-move="down" data-family="\${escapeHtml(pool.family)}" \${isLast ? 'disabled' : ''} title="\${escapeHtml(t('moveDown'))}">↓</button>
            </div>
          \` : '';
          const rankBadge = isEditOrder ? \`<span class="rank-badge">#\${index + 1}</span>\` : '';
          return \`
            <div class="card \${pool.isGemini ? 'gemini-card' : ''} \${isEditOrder ? 'reorderable' : ''}" \${isEditOrder ? 'draggable="true"' : ''} data-pool-family="\${escapeHtml(pool.family)}">
              <div class="card-header">
                <span class="model-name">\${rankBadge}\${escapeHtml(pool.family)}</span>
                \${isEditOrder ? orderControls : \`<span class="pct-value" style="color: \${color}">\${escapeHtml(t('remainingPrefix'))}\${pctText}</span>\`}
              </div>
              <div class="progress-track">
                <div class="progress-fill" style="width: \${width}%; background: \${color}"></div>
              </div>
              <div class="meta-row">
                <span>\${escapeHtml(usedText)}</span>
                <span>\${escapeHtml(formatCountdown(pool.resetTime))}</span>
              </div>
              <div class="meta-row" style="margin-top: 2px;">
                <span></span>
                <span>\${escapeHtml(formatLocalTime(pool.resetTime))}</span>
              </div>
              <div class="variants">\${escapeHtml(t('modelsPrefix'))}\${pool.variants.map(escapeHtml).join(currentLang === 'zh' ? '、' : ', ')}</div>
            </div>
          \`;
        }).join('');
      }

      if (isEditOrder) {
        poolsEl.querySelectorAll('button[data-move]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const nextOrder = computeReorderedList(btn.dataset.family, btn.dataset.move);
            if (nextOrder) persistOrder(nextOrder);
          });
        });

        poolsEl.querySelectorAll('.card[data-pool-family]').forEach((card) => {
          card.addEventListener('dragstart', (e) => {
            dragSourceFamily = card.dataset.poolFamily;
            e.dataTransfer.effectAllowed = 'move';
          });
          card.addEventListener('dragover', (e) => {
            e.preventDefault();
            card.classList.add('drag-over');
          });
          card.addEventListener('dragleave', () => {
            card.classList.remove('drag-over');
          });
          card.addEventListener('drop', (e) => {
            e.preventDefault();
            card.classList.remove('drag-over');
            const targetFamily = card.dataset.poolFamily;
            if (dragSourceFamily && targetFamily && dragSourceFamily !== targetFamily) {
              const nextOrder = computeReorderedList(dragSourceFamily, targetFamily);
              if (nextOrder) persistOrder(nextOrder);
            }
            dragSourceFamily = null;
          });
        });
      }

      if (filteredModels.length === 0) {
        modelsEl.innerHTML = \`<div class="card">\${escapeHtml(t('emptyModels'))}</div>\`;
      } else {
        modelsEl.innerHTML = filteredModels.map((m) => {
          const pct = m.remainingPercent;
          const color = statusColor(pct);
          const pctText = pct !== null ? pct.toFixed(1) + '%' : 'N/A';
          return \`
            <div class="card">
              <div class="card-header" style="margin-bottom: 2px;">
                <span style="font-weight: 500;">\${escapeHtml(m.label)}</span>
                <span style="font-weight: 700; color: \${color};">\${pctText}</span>
              </div>
              <div class="meta-row">
                <span><code>\${escapeHtml(m.modelId)}</code></span>
                <span>\${escapeHtml(formatCountdown(m.resetTime))}</span>
              </div>
            </div>
          \`;
        }).join('');
      }

      const updatedEl = document.getElementById('updated-at');
      const updatedDate = new Date(latestData.updatedAt);
      updatedEl.textContent = t('updatedPrefix') + (Number.isNaN(updatedDate.getTime())
        ? latestData.updatedAt
        : updatedDate.toLocaleTimeString(t('dateLocale'), { hour12: false }));
    }

    async function loadQuota() {
      const btn = document.getElementById('refresh-btn');
      const errBox = document.getElementById('error-box');
      btn.disabled = true;
      btn.textContent = t('syncing');
      errBox.style.display = 'none';

      try {
        const fetcher = window.sidecar?.fetch ? window.sidecar.fetch : fetch;
        const res = await fetcher('/api/quota', { method: 'POST', body: '{}' });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'HTTP ' + res.status);
        }
        latestData = await res.json();
        render();
      } catch (err) {
        errBox.textContent = t('errLoad') + (err.message || String(err));
        errBox.style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.textContent = t('refresh');
      }
    }

    document.getElementById('refresh-btn').addEventListener('click', loadQuota);
    document.getElementById('order-toggle-btn').addEventListener('click', () => {
      isEditOrder = !isEditOrder;
      const toggleBtn = document.getElementById('order-toggle-btn');
      const toolbar = document.getElementById('order-toolbar');
      toggleBtn.classList.toggle('btn-active', isEditOrder);
      toggleBtn.textContent = isEditOrder ? t('done') : t('reorder');
      toolbar.classList.toggle('visible', isEditOrder);
      render();
    });
    document.getElementById('reset-order-btn').addEventListener('click', async () => {
      try {
        const fetcher = window.sidecar?.fetch ? window.sidecar.fetch : fetch;
        const res = await fetcher('/api/order', {
          method: 'POST',
          body: JSON.stringify({ reset: true })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        applyOrderLocally(data.order || []);
        render();
        showSavedHint();
      } catch (err) {
        const errBox = document.getElementById('error-box');
        errBox.textContent = t('errResetOrder') + (err.message || String(err));
        errBox.style.display = 'block';
      }
    });
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter || 'gemini';
        render();
      });
    });

    applyStaticTranslations();
    loadQuota();
    setInterval(loadQuota, 30000);
  </script>
</body>
</html>`;
}

/**
 * Starts the SidecarApp server.
 */
export async function startServer() {
  const app = new SidecarApp();
  app.page('/', () => renderHtml());
  app.api('/api/quota', async () => fetchQuotaData(), 'POST');
  app.api('/api/quota', async () => fetchQuotaData(), 'GET');
  app.api('/api/order', async () => ({ order: loadFamilyOrder() }), 'GET');
  app.api('/api/order', async (data) => {
    if (data?.reset) {
      return { order: saveFamilyOrder(DEFAULT_FAMILY_ORDER) };
    }
    return { order: saveFamilyOrder(data?.order) };
  }, 'POST');
  return app.run();
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  startServer().catch((err) => {
    console.error('[ai-quota-monitor] fatal error:', err);
    process.exit(1);
  });
}
