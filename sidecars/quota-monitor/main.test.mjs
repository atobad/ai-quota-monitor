import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_FAMILY_ORDER,
  extractModelFamily,
  resolveUiLocale,
  loadFamilyOrder,
  saveFamilyOrder,
  sortByFamilyOrder,
  transformUserStatus,
  fetchQuotaData,
  renderHtml,
} from './main.mjs';

test('extractModelFamily removes effort level suffixes including XHigh', () => {
  assert.equal(extractModelFamily('Gemini 4 Argon (Medium)'), 'Gemini 4 Argon');
  assert.equal(extractModelFamily('Gemini 4 Hydrogen (XHigh)'), 'Gemini 4 Hydrogen');
  assert.equal(extractModelFamily('Gemini 3.8 Flash (High)'), 'Gemini 3.8 Flash');
  assert.equal(extractModelFamily('Claude Sonnet 5.5 (Low)'), 'Claude Sonnet 5.5');
  assert.equal(extractModelFamily('Orchestrator (Argon)'), 'Orchestrator (Argon)');
});

test('transformUserStatus applies default order: Hydrogen -> Argon -> Orchestrator -> others', () => {
  const samplePayload = {
    userStatus: {
      userTier: {
        name: 'Google AI Pro',
        description: 'Google AI Pro',
      },
      planStatus: {
        planInfo: {
          planName: 'Pro',
          teamsTier: 'TEAMS_TIER_PRO',
          monthlyPromptCredits: 50000,
          monthlyFlowCredits: 150000,
        },
        availablePromptCredits: 500,
        availableFlowCredits: 100,
      },
      cascadeModelConfigData: {
        clientModelConfigs: [
          {
            label: 'Gemini 3.8 Flash (High)',
            modelId: 'gemini-3.8-flash-high',
            quotaInfo: { remainingFraction: 0.98, resetTime: '2026-11-15T00:00:00Z' },
          },
          {
            label: 'Gemini 4 Argon (Medium)',
            modelId: 'gemini-4-argon-medium',
            quotaInfo: { remainingFraction: 0.83739376, resetTime: '2026-11-15T00:49:48Z' },
          },
          {
            label: 'Orchestrator (Argon)',
            modelId: 'gemini-pro-orchestrator-g1-pro',
            quotaInfo: { remainingFraction: 0.83739376, resetTime: '2026-11-15T00:49:48Z' },
          },
          {
            label: 'Gemini 4 Hydrogen (XHigh)',
            modelId: 'gemini-4-hydrogen-xhigh',
            quotaInfo: { remainingFraction: 0.9, resetTime: '2026-11-15T00:49:48Z' },
          },
          {
            label: 'Gemini 4 Hydrogen (High)',
            modelId: 'gemini-4-hydrogen-high',
            quotaInfo: { remainingFraction: 0.9, resetTime: '2026-11-15T00:49:48Z' },
          },
          {
            label: 'Claude Sonnet 5.5 (High)',
            modelId: 'claude-sonnet-5-5-high',
            quotaInfo: { remainingFraction: 1, resetTime: '2026-11-08T06:15:06Z' },
          },
        ],
      },
    },
  };

  const result = transformUserStatus(samplePayload, '2026-11-14T14:00:00Z');
  assert.equal(result.tier.name, 'Google AI Pro');
  assert.deepEqual(
    result.pools.map((p) => p.family),
    ['Gemini 4 Hydrogen', 'Gemini 4 Argon', 'Orchestrator (Argon)', 'Gemini 3.8 Flash', 'Claude Sonnet 5.5']
  );
  assert.deepEqual(result.pools[0].variants, ['Gemini 4 Hydrogen (XHigh)', 'Gemini 4 Hydrogen (High)']);
});

test('loadFamilyOrder and saveFamilyOrder persist custom order and fall back safely', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gemini-quota-test-'));
  const filePath = join(dir, 'order-config.json');

  try {
    assert.deepEqual(loadFamilyOrder(filePath), DEFAULT_FAMILY_ORDER);

    const custom = ['Orchestrator (Argon)', 'Gemini 4 Hydrogen', 'Gemini 4 Hydrogen', 'Gemini 4 Argon'];
    const saved = saveFamilyOrder(custom, filePath);
    assert.deepEqual(saved, ['Orchestrator (Argon)', 'Gemini 4 Hydrogen', 'Gemini 4 Argon']);
    assert.deepEqual(loadFamilyOrder(filePath), ['Orchestrator (Argon)', 'Gemini 4 Hydrogen', 'Gemini 4 Argon']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sortByFamilyOrder prioritizes custom list and appends unseen models cleanly', () => {
  const items = [
    { family: 'Claude Sonnet 5.5', isGemini: false },
    { family: 'Gemini 5 Future', isGemini: true },
    { family: 'Gemini 4 Argon', isGemini: true },
    { family: 'Gemini 4 Hydrogen', isGemini: true },
  ];
  const sorted = sortByFamilyOrder(items, ['Gemini 4 Argon', 'Claude Sonnet 5.5']);
  assert.deepEqual(
    sorted.map((i) => i.family),
    ['Gemini 4 Argon', 'Claude Sonnet 5.5', 'Gemini 4 Hydrogen', 'Gemini 5 Future']
  );
});

test('fetchQuotaData calls GetUserStatus with CSRF token and uses custom order file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gemini-quota-fetch-'));
  const orderFile = join(dir, 'order-config.json');
  saveFamilyOrder(['Gemini 3.8 Flash', 'Gemini 4 Hydrogen'], orderFile);

  let capturedUrl = '';
  let capturedInit = null;

  const mockFetch = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          userStatus: {
            userTier: { name: 'Google AI Pro' },
            cascadeModelConfigData: {
              clientModelConfigs: [
                {
                  label: 'Gemini 4 Hydrogen (Medium)',
                  modelId: 'gemini-4-hydrogen-medium',
                  quotaInfo: { remainingFraction: 0.9, resetTime: '2026-11-15T00:00:00Z' },
                },
                {
                  label: 'Gemini 3.8 Flash (High)',
                  modelId: 'gemini-3.8-flash-high',
                  quotaInfo: { remainingFraction: 0.978, resetTime: '2026-11-15T00:00:00Z' },
                },
              ],
            },
          },
        };
      },
    };
  };

  try {
    const data = await fetchQuotaData({
      lsAddress: '127.0.0.1:5387',
      csrfToken: 'test-csrf-token',
      fetchImpl: mockFetch,
      orderFile,
    });

    assert.equal(
      capturedUrl,
      'http://127.0.0.1:5387/exa.language_server_pb.LanguageServerService/GetUserStatus'
    );
    assert.equal(capturedInit.method, 'POST');
    assert.equal(capturedInit.headers['x-codeium-csrf-token'], 'test-csrf-token');
    assert.deepEqual(data.pools.map((p) => p.family), ['Gemini 3.8 Flash', 'Gemini 4 Hydrogen']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renderHtml includes preload.js, updated title, and button order', () => {
  const html = renderHtml();
  assert.match(html, /<script src="\/preload\.js"><\/script>/);
  assert.match(html, /<title>AI 模型額度監控<\/title>/);
  assert.match(html, /<h1 id="app-title" class="title">AI 模型額度監控<\/h1>/);
  assert.match(html, /id="pools-container"/);
  assert.match(html, /id="models-container"/);
  assert.match(html, /id="order-toggle-btn"/);
  assert.match(html, /id="reset-order-btn"/);
  const refreshIdx = html.indexOf('id="refresh-btn"');
  const orderIdx = html.indexOf('id="order-toggle-btn"');
  assert.ok(refreshIdx !== -1 && orderIdx !== -1 && refreshIdx < orderIdx, 'refresh-btn should appear before order-toggle-btn');
});

test('computeReorderedList deduplicates families when multiple pools share a family', () => {
  const html = renderHtml();
  const fnMatch = html.match(/function computeReorderedList\(family, actionOrTargetFamily\) \{[\s\S]*?\n    \}/);
  assert.ok(fnMatch, 'computeReorderedList should exist in rendered script');

  const compute = new Function(
    'latestData',
    'currentFilter',
    `${fnMatch[0]}; return computeReorderedList;`
  )(
    {
      pools: [
        { family: 'Gemini 4 Hydrogen', isGemini: true },
        { family: 'Gemini 4 Hydrogen', isGemini: true },
        { family: 'Gemini 4 Argon', isGemini: true },
        { family: 'Claude Sonnet 5.5', isGemini: false },
      ],
    },
    'gemini'
  );

  assert.deepEqual(compute('Gemini 4 Argon', 'up'), [
    'Gemini 4 Argon',
    'Gemini 4 Hydrogen',
    'Claude Sonnet 5.5',
  ]);
});

test('resolveUiLocale switches between Chinese and English, defaulting non-zh/en to English', () => {
  assert.equal(resolveUiLocale('zh-TW'), 'zh');
  assert.equal(resolveUiLocale('zh-Hans'), 'zh');
  assert.equal(resolveUiLocale('zh'), 'zh');
  assert.equal(resolveUiLocale('en-US'), 'en');
  assert.equal(resolveUiLocale('en'), 'en');
  assert.equal(resolveUiLocale('ja-JP'), 'en');
  assert.equal(resolveUiLocale('fr-FR'), 'en');
  assert.equal(resolveUiLocale(['', 'ko-KR', 'zh-TW']), 'en');
  assert.equal(resolveUiLocale(null), 'en');
});

test('renderHtml includes bilingual I18N dictionaries and detectLocale', () => {
  const html = renderHtml();
  assert.match(html, /const I18N = \{/);
  assert.match(html, /AI Model Quota Monitor/);
  assert.match(html, /function detectLocale\(/);
});
