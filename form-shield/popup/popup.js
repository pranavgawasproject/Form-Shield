// ============================================
// FORM SHIELD - Popup Script
// ============================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await updateStatus();
  attachEventListeners();
}

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

function attachEventListeners() {
  // Restore Button
  document.getElementById('restoreBtn').addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ 
        active: true, 
        currentWindow: true 
      });
      
      const response = await chrome.tabs.sendMessage(tab.id, { 
        action: 'restore' 
      });
      
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
      const [tab] = await chrome.tabs.query({ 
        active: true, 
        currentWindow: true 
      });
      
      const response = await chrome.tabs.sendMessage(tab.id, { 
        action: 'saveNow' 
      });
      
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
    if (!confirm('Clear all saved data for this site?')) {
      return;
    }
    
    try {
      const [tab] = await chrome.tabs.query({ 
        active: true, 
        currentWindow: true 
      });
      
      await chrome.tabs.sendMessage(tab.id, { 
        action: 'clearData' 
      });
      
      showToast('Data cleared', 'success');
      await updateStatus();
    } catch (error) {
      showToast('Could not clear data', 'error');
    }
  });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

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