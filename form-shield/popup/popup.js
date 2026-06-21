// ============================================
// FORM SHIELD - Popup Script
// ============================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await updateStatus();
  await updateCloudSyncUI();
  attachEventListeners();
}

// ============================================
// STATUS (existing — per-tab)
// ============================================

async function updateStatus() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id) {
      showNoAccess();
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'getStatus'
    });

    updateUI(response);
  } catch (error) {
    showNoAccess();
  }
}

function updateUI(status) {
  const statusCard = document.getElementById('statusCard');
  const statusIcon = document.getElementById('statusIcon');
  const statusTitle = document.getElementById('statusTitle');
  const statusDetail = document.getElementById('statusDetail');
  const fieldCount = document.getElementById('fieldCount');
  const charCount = document.getElementById('charCount');
  const timeAgo = document.getElementById('timeAgo');
  const restoreBtn = document.getElementById('restoreBtn');

  if (status && status.hasSavedData) {
    statusCard.className = 'status-card has-data';
    statusIcon.textContent = '✅';
    statusTitle.textContent = 'Data Saved';
    statusDetail.textContent = `From: ${getDomain(status.url)}`;

    fieldCount.textContent = status.fieldCount || 0;
    charCount.textContent = formatNumber(status.charCount || 0);
    timeAgo.textContent = formatTimeAgo(status.savedAt);

    restoreBtn.disabled = false;
  } else {
    statusCard.className = 'status-card no-data';
    statusIcon.textContent = '📝';
    statusTitle.textContent = 'Monitoring';
    statusDetail.textContent = 'Start typing to auto-save';

    fieldCount.textContent = '0';
    charCount.textContent = '0';
    timeAgo.textContent = '-';

    restoreBtn.disabled = true;
  }
}

function showNoAccess() {
  const statusCard = document.getElementById('statusCard');
  const statusIcon = document.getElementById('statusIcon');
  const statusTitle = document.getElementById('statusTitle');
  const statusDetail = document.getElementById('statusDetail');
  const restoreBtn = document.getElementById('restoreBtn');
  const saveBtn = document.getElementById('saveBtn');

  statusCard.className = 'status-card';
  statusIcon.textContent = '🚫';
  statusTitle.textContent = 'Not Available';
  statusDetail.textContent = 'Cannot access this page';

  restoreBtn.disabled = true;
  saveBtn.disabled = true;
}

// ============================================
// CLOUD SYNC UI
// ============================================

async function updateCloudSyncUI() {
  try {
    const [gdrive, supabase, settings] = await Promise.all([
      sendToBackground({ action: 'gdriveStatus' }),
      sendToBackground({ action: 'supabaseStatus' }),
      sendToBackground({ action: 'getSettings' }),
    ]);

    // Tier badge
    const tierBadge = document.getElementById('tierBadge');
    if (settings?.tier === 'pro' || supabase?.connected) {
      tierBadge.textContent = 'PRO';
      tierBadge.className = 'cloud-sync-tier pro';
    } else {
      tierBadge.textContent = 'FREE';
      tierBadge.className = 'cloud-sync-tier free';
    }

    // Google Drive row
    const gdriveBtn = document.getElementById('gdriveBtn');
    const gdriveDetail = document.getElementById('gdriveDetail');
    if (gdrive?.connected) {
      gdriveBtn.textContent = 'Disconnect';
      gdriveBtn.className = 'cloud-btn connected';
      gdriveDetail.innerHTML = `✅ Connected as <strong>${escapeHtml(gdrive.email || 'user')}</strong>`;
    } else {
      gdriveBtn.textContent = 'Connect';
      gdriveBtn.className = 'cloud-btn';
      gdriveDetail.textContent = 'Free — sync drafts to your own Google Drive. Your data, your account.';
    }

    // Supabase row
    const supabaseBtn = document.getElementById('supabaseBtn');
    const supabaseDetail = document.getElementById('supabaseDetail');
    if (supabase?.connected) {
      supabaseBtn.textContent = 'Sign out';
      supabaseBtn.className = 'cloud-btn connected';
      supabaseDetail.innerHTML = `✅ Signed in as <strong>${escapeHtml(supabase.email || 'user')}</strong>`;
    } else if (supabase?.configured === false) {
      supabaseBtn.textContent = 'Coming soon';
      supabaseBtn.disabled = true;
      supabaseBtn.className = 'cloud-btn disabled';
      supabaseDetail.textContent = 'Pro tier — cross-device sync. (Awaiting backend setup)';
    } else {
      supabaseBtn.textContent = 'Sign in';
      supabaseBtn.className = 'cloud-btn';
      supabaseDetail.textContent = '$5/mo — cross-device sync, unlimited drafts, priority support.';
    }
  } catch (e) {
    // silent
  }
}

function showSupabaseForm(show) {
  const form = document.getElementById('supabaseAuthForm');
  form.hidden = !show;
  if (show) {
    document.getElementById('supabaseEmail').focus();
  } else {
    document.getElementById('supabaseEmail').value = '';
    document.getElementById('supabasePassword').value = '';
    document.getElementById('supabaseMsg').textContent = '';
  }
}

// ============================================
// EVENT LISTENERS
// ============================================

function attachEventListeners() {
  // Restore Button
  document.getElementById('restoreBtn').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'restore' });

      if (response.success) {
        showToast(`Restored ${response.count} fields!`, 'success');
      } else {
        showToast(response.message || 'Nothing to restore', 'error');
      }
    } catch (error) {
      showToast('Could not restore data', 'error');
    }
  });

  // Save Now Button
  document.getElementById('saveBtn').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'saveNow' });

      if (response.success) {
        showToast('Saved successfully!', 'success');
        await updateStatus();
      } else {
        showToast('Save failed', 'error');
      }
    } catch (error) {
      showToast('Could not save data', 'error');
    }
  });

  // Clear Button
  document.getElementById('clearBtn').addEventListener('click', async () => {
    if (!confirm('Clear all saved data for this site?')) return;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { action: 'clearData' });
      showToast('Data cleared', 'success');
      await updateStatus();
    } catch (error) {
      showToast('Could not clear data', 'error');
    }
  });

  // Google Drive Button
  document.getElementById('gdriveBtn').addEventListener('click', async () => {
    const btn = document.getElementById('gdriveBtn');
    const detail = document.getElementById('gdriveDetail');

    if (btn.classList.contains('connected')) {
      // Disconnect
      btn.disabled = true;
      btn.textContent = '...';
      const r = await sendToBackground({ action: 'gdriveDisconnect' });
      if (r?.ok) showToast('Google Drive disconnected', 'success');
      else showToast('Disconnect failed', 'error');
      await updateCloudSyncUI();
      return;
    }

    // Connect
    btn.disabled = true;
    btn.textContent = 'Connecting...';
    detail.textContent = 'Opening Google sign-in...';

    const r = await sendToBackground({ action: 'gdriveConnect' });

    if (r?.ok) {
      showToast(`Connected to Google Drive`, 'success');
    } else {
      showToast(`Drive connect failed: ${r?.error || 'unknown'}`, 'error');
    }
    await updateCloudSyncUI();
  });

  // Supabase Button — toggle sign-in form
  document.getElementById('supabaseBtn').addEventListener('click', async () => {
    const btn = document.getElementById('supabaseBtn');

    if (btn.classList.contains('connected')) {
      // Sign out
      btn.disabled = true;
      const r = await sendToBackground({ action: 'supabaseSignOut' });
      if (r?.ok) showToast('Signed out of Pro', 'success');
      await updateCloudSyncUI();
      return;
    }

    if (btn.disabled) return;
    showSupabaseForm(true);
  });

  document.getElementById('supabaseCancelBtn').addEventListener('click', () => {
    showSupabaseForm(false);
  });

  document.getElementById('supabaseSignInBtn').addEventListener('click', async () => {
    const email = document.getElementById('supabaseEmail').value.trim();
    const password = document.getElementById('supabasePassword').value;
    const msg = document.getElementById('supabaseMsg');

    if (!email || !password) {
      msg.textContent = 'Email and password required.';
      return;
    }

    msg.textContent = 'Signing in...';
    const r = await sendToBackground({
      action: 'supabaseSignIn',
      email,
      password,
    });

    if (r?.ok) {
      msg.textContent = '';
      showToast('Welcome to Form Shield Pro!', 'success');
      showSupabaseForm(false);
      await updateCloudSyncUI();
    } else {
      msg.textContent = r?.error || 'Sign-in failed';
    }
  });

  document.getElementById('supabaseSignUpBtn').addEventListener('click', async () => {
    const email = document.getElementById('supabaseEmail').value.trim();
    const password = document.getElementById('supabasePassword').value;
    const msg = document.getElementById('supabaseMsg');

    if (!email || !password) {
      msg.textContent = 'Email and password required.';
      return;
    }
    if (password.length < 6) {
      msg.textContent = 'Password must be at least 6 characters.';
      return;
    }

    msg.textContent = 'Creating account...';
    const r = await sendToBackground({
      action: 'supabaseSignUp',
      email,
      password,
    });

    if (r?.ok) {
      if (r.needsConfirmation) {
        msg.textContent = r.message || 'Check your email to confirm.';
      } else {
        msg.textContent = '';
        showToast('Account created — welcome!', 'success');
        showSupabaseForm(false);
        await updateCloudSyncUI();
      }
    } else {
      msg.textContent = r?.error || 'Sign-up failed';
    }
  });
}

// ============================================
// HELPERS
// ============================================

function sendToBackground(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return '-';

  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatNumber(num) {
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k';
  }
  return num.toString();
}

function getDomain(url) {
  if (!url) return 'Unknown';
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return 'Unknown';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const toastIcon = document.getElementById('toastIcon');
  const toastMessage = document.getElementById('toastMessage');

  toastIcon.textContent = type === 'success' ? '✅' : '❌';
  toastMessage.textContent = message;
  toast.className = `toast ${type} show`;

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}