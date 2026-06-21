// ============================================
// FORM SHIELD - Background Service Worker
// Orchestrates cross-tab sync + cloud sync
// ============================================

import { GoogleDriveSync } from './lib/google-drive-sync.js';
import { SupabaseSync } from './lib/supabase-sync.js';

// ============================================
// STATE
// ============================================

const SYNC_DEBOUNCE_MS = 3000; // wait this long after last change before cloud push
let syncPending = new Map(); // hostname -> timeout
let lastSyncedTimestamp = new Map(); // hostname -> last cloud-pushed timestamp

// ============================================
// CROSS-TAB BROADCAST
// ============================================
// When ANY tab saves data, all other tabs on the same hostname
// get notified and update their inputs in-place.

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  for (const [key, { newValue, oldValue }] of Object.entries(changes)) {
    if (!key.startsWith('formshield_')) continue;

    const hostname = key.replace('formshield_', '');
    const isSignificantChange =
      !oldValue ||
      !newValue ||
      oldValue.timestamp !== newValue.timestamp ||
      JSON.stringify(oldValue.fields) !== JSON.stringify(newValue.fields);

    if (!isSignificantChange) continue;

    broadcastToTabs(hostname, {
      type: 'remoteUpdate',
      hostname,
      data: newValue,
      previousTimestamp: oldValue?.timestamp || null,
    });

    // Trigger cloud sync (debounced per hostname)
    scheduleCloudSync(hostname, newValue);
  }
});

async function broadcastToTabs(hostname, message) {
  try {
    const tabs = await chrome.tabs.query({ url: `*://*.${hostname}/*` });
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, message);
      } catch (e) {
        // Tab may not have content script (chrome:// pages, store, pdf, etc.)
      }
    }
  } catch (e) {
    // hostname may not match any tabs
  }
}

// ============================================
// CLOUD SYNC ORCHESTRATION
// ============================================

function scheduleCloudSync(hostname, data) {
  // Skip cloud sync if no data
  if (!data || !data.fields || data.fields.length === 0) return;

  // Clear existing debounce
  const existing = syncPending.get(hostname);
  if (existing) clearTimeout(existing);

  // Schedule new debounced sync
  const timeout = setTimeout(() => {
    syncPending.delete(hostname);
    performCloudSync(hostname, data).catch((err) => {
      console.warn(`[FormShield] Cloud sync failed for ${hostname}:`, err);
    });
  }, SYNC_DEBOUNCE_MS);

  syncPending.set(hostname, timeout);
}

async function performCloudSync(hostname, data) {
  // Skip if data hasn't changed since last sync
  const lastTs = lastSyncedTimestamp.get(hostname);
  if (lastTs === data.timestamp) return;

  const settings = await getSyncSettings();

  const targets = [];
  if (settings.googleDriveEnabled) targets.push('gdrive');
  if (settings.supabaseEnabled) targets.push('supabase');

  if (targets.length === 0) return;

  const results = await Promise.allSettled([
    settings.googleDriveEnabled
      ? GoogleDriveSync.push(hostname, data)
      : Promise.resolve({ skipped: true }),
    settings.supabaseEnabled
      ? SupabaseSync.push(hostname, data)
      : Promise.resolve({ skipped: true }),
  ]);

  const anySuccess = results.some(
    (r) => r.status === 'fulfilled' && !r.value?.skipped && r.value?.ok !== false
  );

  if (anySuccess) {
    lastSyncedTimestamp.set(hostname, data.timestamp);
    await updateLastSyncTime(hostname);
  }
}

// ============================================
// SETTINGS STORAGE
// ============================================

const DEFAULT_SETTINGS = {
  googleDriveEnabled: false,
  googleDriveEmail: null,
  supabaseEnabled: false,
  supabaseEmail: null,
  supabaseUserId: null,
  restorePromptEnabled: true,
  crossTabSyncEnabled: true,
  cloudSyncEnabled: false,
  tier: 'free', // 'free' | 'pro'
};

async function getSyncSettings() {
  const result = await chrome.storage.local.get(['formshield_settings']);
  return { ...DEFAULT_SETTINGS, ...(result.formshield_settings || {}) };
}

async function setSyncSettings(patch) {
  const current = await getSyncSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ formshield_settings: next });
  return next;
}

async function updateLastSyncTime(hostname) {
  const key = `formshield_lastSync_${hostname}`;
  await chrome.storage.local.set({ [key]: Date.now() });
}

// ============================================
// MESSAGE HANDLERS (from popup + content scripts)
// ============================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error('[FormShield] message error:', err);
      sendResponse({ ok: false, error: err.message });
    });
  return true; // keep channel open for async response
});

async function handleMessage(request, sender) {
  switch (request.action) {
    // ----- Settings -----
    case 'getSettings':
      return await getSyncSettings();

    case 'setSettings':
      return await setSyncSettings(request.patch || {});

    // ----- Google Drive (free) -----
    case 'gdriveConnect':
      return await GoogleDriveSync.connect();

    case 'gdriveDisconnect':
      return await GoogleDriveSync.disconnect();

    case 'gdriveStatus':
      return await GoogleDriveSync.status();

    // ----- Supabase (paid) -----
    case 'supabaseSignIn':
      return await SupabaseSync.signIn(request.email, request.password);

    case 'supabaseSignUp':
      return await SupabaseSync.signUp(request.email, request.password);

    case 'supabaseSignOut':
      return await SupabaseSync.signOut();

    case 'supabaseStatus':
      return await SupabaseSync.status();

    // ----- Manual sync -----
    case 'forceCloudSync':
      return await forceSyncAllTabs();

    // ----- Restore from cloud on a new device -----
    case 'pullCloudDrafts':
      return await pullCloudDrafts(request.hostname);

    default:
      return { ok: false, error: 'unknown_action' };
  }
}

async function forceSyncAllTabs() {
  const all = await chrome.storage.local.get(null);
  const settings = await getSyncSettings();
  let pushed = 0;

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith('formshield_')) continue;
    if (key === 'formshield_settings') continue;
    if (key.startsWith('formshield_lastSync_')) continue;
    if (!value?.fields) continue;

    const hostname = key.replace('formshield_', '');
    const results = await Promise.allSettled([
      settings.googleDriveEnabled ? GoogleDriveSync.push(hostname, value) : null,
      settings.supabaseEnabled ? SupabaseSync.push(hostname, value) : null,
    ]);
    if (results.some((r) => r.status === 'fulfilled' && r.value?.ok !== false)) {
      pushed++;
      lastSyncedTimestamp.set(hostname, value.timestamp);
    }
  }

  return { ok: true, pushed };
}

async function pullCloudDrafts(hostname) {
  const settings = await getSyncSettings();
  const results = [];

  if (settings.googleDriveEnabled) {
    const r = await GoogleDriveSync.pull(hostname);
    if (r?.data) results.push({ source: 'gdrive', data: r.data });
  }
  if (settings.supabaseEnabled) {
    const r = await SupabaseSync.pull(hostname);
    if (r?.data) results.push({ source: 'supabase', data: r.data });
  }

  if (results.length === 0) return { ok: false, error: 'no_cloud_data' };

  // Use the freshest one
  results.sort((a, b) => (b.data.timestamp || 0) - (a.data.timestamp || 0));
  return { ok: true, data: results[0].data };
}

// ============================================
// INSTALL / STARTUP
// ============================================

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    console.log('[FormShield] Installed — version', chrome.runtime.getManifest().version);
    await setSyncSettings(DEFAULT_SETTINGS);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await getSyncSettings();
  if (settings.googleDriveEnabled) {
    GoogleDriveSync.rehydrate().catch(() => {});
  }
  if (settings.supabaseEnabled) {
    SupabaseSync.rehydrate().catch(() => {});
  }
});