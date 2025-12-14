// ============================================
// FORM SHIELD - Content Script
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
    ]
  };

  // ============================================
  // STATE
  // ============================================
  
  let saveTimeout = null;
  let lastSaveTime = null;
  let characterCount = 0;
  let badge = null;

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
    // Check input type
    if (CONFIG.EXCLUDED_INPUT_TYPES.includes(element.type)) {
      return true;
    }
    
    // Check field name/id against sensitive patterns
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
    
    // Find all input elements
    const inputs = document.querySelectorAll(
      'input, textarea, select, [contenteditable="true"]'
    );
    
    let totalChars = 0;
    
    inputs.forEach((input, index) => {
      // Skip sensitive fields
      if (isSensitiveField(input)) {
        return;
      }
      
      // Get value
      let value = '';
      if (input.getAttribute('contenteditable') === 'true') {
        value = input.innerText || input.textContent || '';
      } else {
        value = input.value || '';
      }
      
      // Skip empty fields
      if (!value.trim()) {
        return;
      }
      
      totalChars += value.length;
      
      // Create unique identifier for this field
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
    // Create a unique but consistent identifier
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
      // PRIMARY: Chrome Storage
      saveToChrome(storageKey, data),
      
      // BACKUP 1: IndexedDB
      saveToIndexedDB(storageKey, data),
      
      // BACKUP 2: localStorage
      saveToLocalStorage(storageKey, data)
    ]);
    
    // Check if at least one save succeeded
    const successCount = results.filter(
      r => r.status === 'fulfilled' && r.value === true
    ).length;
    
    if (successCount > 0) {
      lastSaveTime = Date.now();
      updateBadge('saved');
      return true;
    } else {
      updateBadge('error');
      return false;
    }
  }
  
  // Chrome Storage
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
  
  // IndexedDB
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
  
  // localStorage
  function saveToLocalStorage(key, data) {
    return new Promise((resolve) => {
      try {
        localStorage.setItem(key, JSON.stringify(data));
        resolve(true);
      } catch (e) {
        // Might fail if storage is full
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
    
    // Try Chrome Storage first
    let data = await loadFromChrome(storageKey);
    
    // Fallback to IndexedDB
    if (!data) {
      data = await loadFromIndexedDB(storageKey);
    }
    
    // Fallback to localStorage
    if (!data) {
      data = loadFromLocalStorage(storageKey);
    }
    
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
    
    // Check if data is too old
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
        
        // Trigger input event for React/Vue/Angular
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        
        restoredCount++;
      }
    });
    
    return { 
      success: true, 
      message: `Restored ${restoredCount} fields`,
      count: restoredCount
    };
  }
  
  function findMatchingElement(field) {
    // Try by ID first
    if (field.elementId) {
      const byId = document.getElementById(field.elementId);
      if (byId) return byId;
    }
    
    // Try by name
    if (field.name) {
      const byName = document.querySelector(`[name="${field.name}"]`);
      if (byName) return byName;
    }
    
    // Try by placeholder
    if (field.placeholder) {
      const byPlaceholder = document.querySelector(
        `[placeholder="${field.placeholder}"]`
      );
      if (byPlaceholder) return byPlaceholder;
    }
    
    return null;
  }

  // ============================================
  // VISUAL BADGE
  // ============================================
  
  function createBadge() {
    // Remove existing badge if any
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
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      badge.classList.add('formshield-minimized');
    }, 3000);
    
    // Show on hover
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
    
    // Re-minimize after 3 seconds
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
    
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  // ============================================
  // EVENT HANDLERS
  // ============================================
  
  function handleInput(event) {
    const element = event.target;
    
    // Check if it's an input element we care about
    const isInput = (
      element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.tagName === 'SELECT' ||
      element.getAttribute('contenteditable') === 'true'
    );
    
    if (!isInput) return;
    if (isSensitiveField(element)) return;
    
    // Debounce the save
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    
    updateBadge('saving');
    
    saveTimeout = setTimeout(() => {
      const data = collectFormData();
      if (data.fields.length > 0) {
        saveWithRedundancy(data);
      }
    }, CONFIG.DEBOUNCE_DELAY);
  }
  
  function handleBeforeUnload() {
    // Save immediately before page closes
    const data = collectFormData();
    if (data.fields.length > 0) {
      // Use synchronous localStorage as last resort
      const key = `formshield_${data.hostname}`;
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch (e) {
        // Can't do much here
      }
    }
  }
  
  function handleVisibilityChange() {
    if (document.hidden) {
      // Page is being hidden, save now
      const data = collectFormData();
      if (data.fields.length > 0) {
        saveWithRedundancy(data);
      }
    }
  }

  // ============================================
  // MESSAGE HANDLER (for popup communication)
  // ============================================
  
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'restore') {
      restoreFormData().then(result => {
        sendResponse(result);
      });
      return true; // Keep channel open for async response
    }
    
    if (request.action === 'getStatus') {
      loadSavedData().then(data => {
        sendResponse({
          hasSavedData: !!data,
          savedAt: data?.timestamp || null,
          fieldCount: data?.fields?.length || 0,
          charCount: data?.totalCharacters || 0,
          url: data?.url || null
        });
      });
      return true;
    }
    
    if (request.action === 'saveNow') {
      const data = collectFormData();
      saveWithRedundancy(data).then(success => {
        sendResponse({ success });
      });
      return true;
    }
    
    if (request.action === 'clearData') {
      const hostname = window.location.hostname;
      const key = `formshield_${hostname}`;
      
      Promise.all([
        new Promise(r => chrome.storage.local.remove([key], r)),
        new Promise(r => { localStorage.removeItem(key); r(); })
      ]).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }
  });

  // ============================================
  // INITIALIZATION
  // ============================================
  
  function init() {
    // Check if site is blacklisted
    if (isBlacklistedSite()) {
      console.log('Form Shield: Disabled on this site for security');
      return;
    }
    
    // Check if there are any forms on the page
    const hasInputs = document.querySelector(
      'input, textarea, select, [contenteditable="true"]'
    );
    
    if (!hasInputs) {
      return; // No forms, no need to run
    }
    
    // Create visual badge
    createBadge();
    
    // Attach event listeners
    document.addEventListener('input', handleInput, true);
    document.addEventListener('change', handleInput, true);
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Watch for dynamically added forms
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
    
    console.log('Form Shield: Active and protecting forms');
  }
  
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
})();