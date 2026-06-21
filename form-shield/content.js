// ============================================
// FORM SHIELD - Content Script
// Auto-save + restore + cross-tab sync + restore-on-reload banner
// ============================================

(function() {
  'use strict';

  // ============================================
  // CONFIGURATION
  // ============================================

  const CONFIG = {
    // Save after user stops typing for this many ms
    DEBOUNCE_DELAY: 2000,

    // Maximum data age (30 days in ms)
    MAX_DATA_AGE: 30 * 24 * 60 * 60 * 1000,

    // Banner auto-dismiss after this long (15s)
    BANNER_AUTO_DISMISS_MS: 15000,

    // Sites to NEVER run on (banking, health, etc.)
    BLACKLISTED_DOMAINS: [
      'chase.com',
      'bankofamerica.com',
      'wellsfargo.com',
      'paypal.com',
      'venmo.com',
      'healthcare.gov',
      'patient.portal',
      'mychart.com'
    ],

    // Input types to NEVER save
    EXCLUDED_INPUT_TYPES: [
      'password',
      'hidden',
      'file',
      'submit',
      'button',
      'reset',
      'image'
    ],

    // Field names that suggest sensitive data
    SENSITIVE_FIELD_PATTERNS: [
      /password/i,
      /ssn/i,
      /social.*security/i,
      /credit.*card/i,
      /cvv/i,
      /cvc/i,
      /pin/i,
      /secret/i
    ],

    // localStorage key for "dismissed restore" so we don't re-prompt
    DISMISS_KEY_PREFIX: 'formshield_dismissed_'
  };

  // ============================================
  // STATE
  // ============================================

  let saveTimeout = null;
  let lastSaveTime = null;
  let characterCount = 0;
  let badge = null;
  let restoreBanner = null;
  let currentDraftTimestamp = null; // to avoid echo when we receive remoteUpdate

  // ============================================
  // BLACKLIST CHECK
  // ============================================

  function isBlacklistedSite() {
    const hostname = window.location.hostname.toLowerCase();
    return CONFIG.BLACKLISTED_DOMAINS.some(domain =>
      hostname.includes(domain)
    );
  }

  // ============================================
  // SENSITIVE FIELD CHECK
  // ============================================

  function isSensitiveField(element) {
    if (CONFIG.EXCLUDED_INPUT_TYPES.includes(element.type)) {
      return true;
    }
    const fieldIdentifier = (
      (element.name || '') +
      (element.id || '') +
      (element.placeholder || '') +
      (element.getAttribute('aria-label') || '')
    ).toLowerCase();
    return CONFIG.SENSITIVE_FIELD_PATTERNS.some(pattern =>
      pattern.test(fieldIdentifier)
    );
  }

  // ============================================
  // FORM DATA COLLECTION
  // ============================================

  function collectFormData() {
    const formData = {
      url: window.location.href,
      hostname: window.location.hostname,
      title: document.title,
      timestamp: Date.now(),
      fields: []
    };

    const inputs = document.querySelectorAll(
      'input, textarea, select, [contenteditable="true"]'
    );

    let totalChars = 0;

    inputs.forEach((input, index) => {
      if (isSensitiveField(input)) return;

      let value = '';
      if (input.getAttribute('contenteditable') === 'true') {
        value = input.innerText || input.textContent || '';
      } else {
        value = input.value || '';
      }

      if (!value.trim()) return;

      totalChars += value.length;
      const fieldId = generateFieldId(input, index);

      formData.fields.push({
        id: fieldId,
        tagName: input.tagName.toLowerCase(),
        type: input.type || 'text',
        name: input.name || null,
        elementId: input.id || null,
        placeholder: input.placeholder || null,
        value: value,
        charCount: value.length
      });
    });

    formData.totalCharacters = totalChars;
    characterCount = totalChars;
    return formData;
  }

  function generateFieldId(element, index) {
    const parts = [
      element.tagName,
      element.type || 'text',
      element.name || '',
      element.id || '',
      index
    ];
    return parts.join('_').toLowerCase();
  }

  // ============================================
  // TRIPLE REDUNDANCY SAVE
  // ============================================

  async function saveWithRedundancy(data) {
    const storageKey = `formshield_${data.hostname}`;

    const results = await Promise.allSettled([
      saveToChrome(storageKey, data),
      saveToIndexedDB(storageKey, data),
      saveToLocalStorage(storageKey, data)
    ]);

    const successCount = results.filter(
      r => r.status === 'fulfilled' && r.value === true
    ).length;

    if (successCount > 0) {
      lastSaveTime = Date.now();
      currentDraftTimestamp = data.timestamp;
      updateBadge('saved');
      return true;
    } else {
      updateBadge('error');
      return false;
    }
  }

  async function saveToChrome(key, data) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [key]: data }, () => {
          if (chrome.runtime.lastError) {
            console.warn('Chrome storage error:', chrome.runtime.lastError);
            resolve(false);
          } else {
            resolve(true);
          }
        });
      } catch (e) {
        resolve(false);
      }
    });
  }

  async function saveToIndexedDB(key, data) {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open('FormShieldDB', 1);
        request.onerror = () => resolve(false);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('forms')) {
            db.createObjectStore('forms', { keyPath: 'key' });
          }
        };
        request.onsuccess = (event) => {
          try {
            const db = event.target.result;
            const transaction = db.transaction(['forms'], 'readwrite');
            const store = transaction.objectStore('forms');
            store.put({ key: key, data: data });
            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => resolve(false);
          } catch (e) {
            resolve(false);
          }
        };
      } catch (e) {
        resolve(false);
      }
    });
  }

  function saveToLocalStorage(key, data) {
    return new Promise((resolve) => {
      try {
        localStorage.setItem(key, JSON.stringify(data));
        resolve(true);
      } catch (e) {
        resolve(false);
      }
    });
  }

  // ============================================
  // RESTORE FUNCTIONALITY
  // ============================================

  async function loadSavedData() {
    const hostname = window.location.hostname;
    const storageKey = `formshield_${hostname}`;

    let data = await loadFromChrome(storageKey);
    if (!data) data = await loadFromIndexedDB(storageKey);
    if (!data) data = loadFromLocalStorage(storageKey);
    return data;
  }

  async function loadFromChrome(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([key], (result) => {
          resolve(result[key] || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function loadFromIndexedDB(key) {
    return new Promise((resolve) => {
      try {
        const request = indexedDB.open('FormShieldDB', 1);
        request.onerror = () => resolve(null);
        request.onsuccess = (event) => {
          try {
            const db = event.target.result;
            const transaction = db.transaction(['forms'], 'readonly');
            const store = transaction.objectStore('forms');
            const getRequest = store.get(key);
            getRequest.onsuccess = () => {
              resolve(getRequest.result?.data || null);
            };
            getRequest.onerror = () => resolve(null);
          } catch (e) {
            resolve(null);
          }
        };
      } catch (e) {
        resolve(null);
      }
    });
  }

  function loadFromLocalStorage(key) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  }

  async function restoreFormData() {
    const savedData = await loadSavedData();

    if (!savedData || !savedData.fields) {
      return { success: false, message: 'No saved data found' };
    }

    if (Date.now() - savedData.timestamp > CONFIG.MAX_DATA_AGE) {
      return { success: false, message: 'Saved data is too old' };
    }

    let restoredCount = 0;

    savedData.fields.forEach((field) => {
      const element = findMatchingElement(field);
      if (element && !isSensitiveField(element)) {
        if (element.getAttribute('contenteditable') === 'true') {
          element.innerText = field.value;
        } else {
          element.value = field.value;
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        restoredCount++;
      }
    });

    currentDraftTimestamp = savedData.timestamp;

    return {
      success: true,
      message: `Restored ${restoredCount} fields`,
      count: restoredCount
    };
  }

  function findMatchingElement(field) {
    if (field.elementId) {
      const byId = document.getElementById(field.elementId);
      if (byId) return byId;
    }
    if (field.name) {
      const byName = document.querySelector(`[name="${field.name}"]`);
      if (byName) return byName;
    }
    if (field.placeholder) {
      const byPlaceholder = document.querySelector(
        `[placeholder="${field.placeholder}"]`
      );
      if (byPlaceholder) return byPlaceholder;
    }
    return null;
  }

  // ============================================
  // RESTORE-ON-RELOAD BANNER
  // ============================================

  async function maybeShowRestoreBanner() {
    try {
      const savedData = await loadSavedData();
      if (!savedData || !savedData.fields || savedData.fields.length === 0) return;

      // Too old?
      if (Date.now() - savedData.timestamp > CONFIG.MAX_DATA_AGE) return;

      // Already restored in this tab? Skip.
      if (currentDraftTimestamp === savedData.timestamp) return;

      // Dismissed recently?
      const dismissKey = CONFIG.DISMISS_KEY_PREFIX + window.location.hostname;
      const dismissedAt = parseInt(localStorage.getItem(dismissKey) || '0', 10);
      if (Date.now() - dismissedAt < 60 * 60 * 1000) return; // 1h cooldown

      // Only show if user is NOT actively typing on the page
      const hasUnsavedInputs = Array.from(
        document.querySelectorAll('input, textarea, [contenteditable="true"]')
      ).some((el) => {
        if (isSensitiveField(el)) return false;
        const v = el.value || el.innerText || '';
        return v.trim().length > 0;
      });

      if (hasUnsavedInputs) return; // don't interrupt active typing

      showRestoreBanner(savedData);
    } catch (e) {
      // silent
    }
  }

  function showRestoreBanner(savedData) {
    // Remove old banner
    if (restoreBanner) restoreBanner.remove();

    const timeAgo = getTimeAgo(savedData.timestamp);
    const fieldCount = savedData.fields.length;
    const charCount = savedData.totalCharacters || 0;

    restoreBanner = document.createElement('div');
    restoreBanner.id = 'formshield-restore-banner';
    restoreBanner.innerHTML = `
      <div class="formshield-banner-content">
        <div class="formshield-banner-icon">🛡️</div>
        <div class="formshield-banner-text">
          <strong>Form Shield found ${fieldCount} unsaved field${fieldCount === 1 ? '' : 's'}</strong>
          <span>${charCount} characters · saved ${timeAgo}</span>
        </div>
        <div class="formshield-banner-actions">
          <button class="formshield-banner-btn formshield-restore" type="button">Restore</button>
          <button class="formshield-banner-btn formshield-dismiss" type="button" aria-label="Dismiss">✕</button>
        </div>
      </div>
    `;

    document.body.appendChild(restoreBanner);

    // Animate in
    requestAnimationFrame(() => {
      restoreBanner.classList.add('formshield-banner-visible');
    });

    // Wire buttons
    restoreBanner.querySelector('.formshield-restore').addEventListener('click', async () => {
      const result = await restoreFormData();
      hideRestoreBanner();
      if (result.success) {
        updateBadge('saved');
      }
    });

    restoreBanner.querySelector('.formshield-dismiss').addEventListener('click', () => {
      const dismissKey = CONFIG.DISMISS_KEY_PREFIX + window.location.hostname;
      try { localStorage.setItem(dismissKey, String(Date.now())); } catch (_) {}
      hideRestoreBanner();
    });

    // Auto dismiss
    setTimeout(() => hideRestoreBanner(), CONFIG.BANNER_AUTO_DISMISS_MS);
  }

  function hideRestoreBanner() {
    if (!restoreBanner) return;
    restoreBanner.classList.remove('formshield-banner-visible');
    setTimeout(() => {
      if (restoreBanner) {
        restoreBanner.remove();
        restoreBanner = null;
      }
    }, 300);
  }

  // ============================================
  // CROSS-TAB SYNC
  // ============================================
  // When another tab on the same hostname saves data, we receive
  // 'remoteUpdate' from the background worker and merge values into
  // our own inputs (without retriggering a save loop).

  function applyRemoteUpdate(data) {
    if (!data || !data.fields) return;
    // Skip echo
    if (data.timestamp === currentDraftTimestamp) return;

    let appliedCount = 0;
    data.fields.forEach((field) => {
      const element = findMatchingElement(field);
      if (!element || isSensitiveField(element)) return;

      const current =
        element.getAttribute('contenteditable') === 'true'
          ? element.innerText || ''
          : element.value || '';

      // Only overwrite empty fields (don't trample what the user is currently typing here)
      if (current.trim().length > 0) return;

      if (element.getAttribute('contenteditable') === 'true') {
        element.innerText = field.value;
      } else {
        element.value = field.value;
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      appliedCount++;
    });

    if (appliedCount > 0) {
      currentDraftTimestamp = data.timestamp;
      showToast(`🛡️ Synced ${appliedCount} field${appliedCount === 1 ? '' : 's'} from another tab`);
      updateBadge('saved');
    }
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'formshield-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('formshield-toast-visible'));
    setTimeout(() => {
      toast.classList.remove('formshield-toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ============================================
  // VISUAL BADGE
  // ============================================

  function createBadge() {
    const existing = document.getElementById('formshield-badge');
    if (existing) existing.remove();

    badge = document.createElement('div');
    badge.id = 'formshield-badge';
    badge.innerHTML = `
      <div class="formshield-badge-content">
        <span class="formshield-icon">🛡️</span>
        <span class="formshield-text">Form Shield Active</span>
        <span class="formshield-status"></span>
      </div>
    `;

    document.body.appendChild(badge);

    setTimeout(() => {
      badge.classList.add('formshield-minimized');
    }, 3000);

    badge.addEventListener('mouseenter', () => {
      badge.classList.remove('formshield-minimized');
    });

    badge.addEventListener('mouseleave', () => {
      setTimeout(() => {
        badge.classList.add('formshield-minimized');
      }, 1000);
    });
  }

  function updateBadge(status) {
    if (!badge) return;

    const statusEl = badge.querySelector('.formshield-status');
    const textEl = badge.querySelector('.formshield-text');

    badge.classList.remove('formshield-minimized');

    if (status === 'saved') {
      const timeAgo = getTimeAgo(lastSaveTime);
      statusEl.textContent = `✅ Saved ${timeAgo}`;
      textEl.textContent = `${characterCount} chars protected`;
      badge.className = 'formshield-saved';
    } else if (status === 'saving') {
      statusEl.textContent = '💾 Saving...';
      badge.className = 'formshield-saving';
    } else if (status === 'error') {
      statusEl.textContent = '⚠️ Save failed';
      badge.className = 'formshield-error';
    }

    setTimeout(() => {
      badge.classList.add('formshield-minimized');
    }, 3000);
  }

  function getTimeAgo(timestamp) {
    if (!timestamp) return 'never';

    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  // ============================================
  // EVENT HANDLERS
  // ============================================

  function handleInput(event) {
    const element = event.target;

    const isInput = (
      element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.tagName === 'SELECT' ||
      element.getAttribute('contenteditable') === 'true'
    );

    if (!isInput) return;
    if (isSensitiveField(element)) return;

    if (saveTimeout) clearTimeout(saveTimeout);

    updateBadge('saving');

    saveTimeout = setTimeout(() => {
      const data = collectFormData();
      if (data.fields.length > 0) {
        saveWithRedundancy(data);
      }
    }, CONFIG.DEBOUNCE_DELAY);
  }

  function handleBeforeUnload() {
    const data = collectFormData();
    if (data.fields.length > 0) {
      const key = `formshield_${data.hostname}`;
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch (e) {}
    }
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      const data = collectFormData();
      if (data.fields.length > 0) {
        saveWithRedundancy(data);
      }
    }
  }

  // ============================================
  // MESSAGE HANDLER (from popup + background)
  // ============================================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, message: err.message }));
    return true;
  });

  async function handleMessage(request) {
    switch (request.action) {
      case 'restore': {
        const r = await restoreFormData();
        hideRestoreBanner();
        return r;
      }

      case 'getStatus': {
        const data = await loadSavedData();
        return {
          hasSavedData: !!data,
          savedAt: data?.timestamp || null,
          fieldCount: data?.fields?.length || 0,
          charCount: data?.totalCharacters || 0,
          url: data?.url || null
        };
      }

      case 'saveNow': {
        const data = collectFormData();
        const ok = await saveWithRedundancy(data);
        return { success: ok };
      }

      case 'clearData': {
        const hostname = window.location.hostname;
        const key = `formshield_${hostname}`;

        await Promise.all([
          new Promise(r => chrome.storage.local.remove([key], r)),
          new Promise(r => { localStorage.removeItem(key); r(); }),
        ]);

        hideRestoreBanner();
        currentDraftTimestamp = null;
        return { success: true };
      }

      // From background worker — another tab saved fresh data
      case 'remoteUpdate': {
        if (request.hostname !== window.location.hostname) return { ok: true };
        applyRemoteUpdate(request.data);
        return { ok: true };
      }

      default:
        return { ok: false, error: 'unknown_action' };
    }
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  function init() {
    if (isBlacklistedSite()) {
      console.log('Form Shield: Disabled on this site for security');
      return;
    }

    const hasInputs = document.querySelector(
      'input, textarea, select, [contenteditable="true"]'
    );

    if (!hasInputs) return;

    createBadge();

    document.addEventListener('input', handleInput, true);
    document.addEventListener('change', handleInput, true);
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            const hasNewInputs = (
              node.matches?.('input, textarea, select') ||
              node.querySelector?.('input, textarea, select')
            );
            if (hasNewInputs && !badge) {
              createBadge();
            }
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Restore-on-reload banner — check shortly after load
    // (delay so we don't flash before the page is interactive)
    setTimeout(() => {
      maybeShowRestoreBanner();
    }, 1500);

    console.log('Form Shield: Active and protecting forms');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();