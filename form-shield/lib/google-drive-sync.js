// ============================================
// FORM SHIELD - Google Drive Sync (Free Tier)
// Saves drafts into user's own Drive AppFolder.
// User keeps ownership of their data.
// ============================================

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FILE_NAME = 'formshield-drafts.json';
const TOKEN_KEY = 'formshield_gdrive_token';

let cachedToken = null;
let cachedFileId = null;
let cachedEmail = null;

// ============================================
// AUTH
// ============================================

export async function connect() {
  try {
    const token = await getAuthToken({ interactive: true });
    cachedToken = token;
    const profile = await fetchUserProfile(token);
    cachedEmail = profile.email;

    await chrome.storage.local.set({
      [TOKEN_KEY]: { token, email: profile.email, obtainedAt: Date.now() },
    });

    const settings = (await chrome.storage.local.get(['formshield_settings']))
      .formshield_settings || {};
    await chrome.storage.local.set({
      formshield_settings: {
        ...settings,
        googleDriveEnabled: true,
        googleDriveEmail: profile.email,
        cloudSyncEnabled: true,
      },
    });

    // Pre-create the file so we have an ID
    await ensureFile(token);

    return { ok: true, email: profile.email };
  } catch (err) {
    console.error('[FormShield GDrive] connect failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function disconnect() {
  try {
    if (cachedToken) {
      await new Promise((r) =>
        chrome.identity.removeCachedAuthToken({ token: cachedToken }, r)
      );
    }
  } catch (_) {}
  cachedToken = null;
  cachedEmail = null;
  cachedFileId = null;
  await chrome.storage.local.remove([TOKEN_KEY]);
  const settings = (await chrome.storage.local.get(['formshield_settings']))
    .formshield_settings || {};
  await chrome.storage.local.set({
    formshield_settings: {
      ...settings,
      googleDriveEnabled: false,
      googleDriveEmail: null,
    },
  });
  return { ok: true };
}

export async function status() {
  const stored = (await chrome.storage.local.get([TOKEN_KEY]))[TOKEN_KEY];
  const settings = (await chrome.storage.local.get(['formshield_settings']))
    .formshield_settings || {};
  return {
    ok: true,
    connected: !!stored?.token && !!settings.googleDriveEnabled,
    email: settings.googleDriveEmail || stored?.email || null,
  };
}

export async function rehydrate() {
  const stored = (await chrome.storage.local.get([TOKEN_KEY]))[TOKEN_KEY];
  if (!stored?.token) return;
  cachedToken = stored.token;
  cachedEmail = stored.email;
  // Verify token still valid by listing appfolder
  try {
    await driveApi('/files?spaces=appDataFolder&pageSize=1');
  } catch (e) {
    // Token expired — clear silently
    await disconnect();
  }
}

// ============================================
// TOKEN
// ============================================

function getAuthToken({ interactive }) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'no_token'));
        return;
      }
      resolve(token);
    });
  });
}

async function fetchUserProfile(token) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('profile_fetch_failed');
  return await res.json();
}

// ============================================
// DRIVE OPS
// ============================================

async function driveApi(path, init = {}) {
  if (!cachedToken) await rehydrate();
  if (!cachedToken) throw new Error('not_authenticated');

  const res = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${cachedToken}`,
    },
  });

  // Token expired → refresh once
  if (res.status === 401) {
    await new Promise((r) =>
      chrome.identity.removeCachedAuthToken({ token: cachedToken }, r)
    );
    cachedToken = await getAuthToken({ interactive: false });
    const stored = (await chrome.storage.local.get([TOKEN_KEY]))[TOKEN_KEY];
    await chrome.storage.local.set({
      [TOKEN_KEY]: { ...stored, token: cachedToken, obtainedAt: Date.now() },
    });
    return driveApi(path, init);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`drive_api_${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
}

async function ensureFile(token) {
  // Search for existing file in appDataFolder
  const search = await driveApi(
    `/files?spaces=appDataFolder&q=name='${FILE_NAME}'&fields=files(id,name,modifiedTime)`
  );
  const json = await search.json();
  if (json.files && json.files.length > 0) {
    cachedFileId = json.files[0].id;
    return cachedFileId;
  }

  // Create empty file
  const create = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: FILE_NAME,
      parents: ['appDataFolder'],
      description: 'Form Shield saved drafts. Stored in your own Google Drive.',
    }),
  });
  if (!create.ok) throw new Error('file_create_failed');
  const created = await create.json();
  cachedFileId = created.id;
  return cachedFileId;
}

// ============================================
// PUSH / PULL
// ============================================

export async function push(hostname, data) {
  try {
    const token = await ensureAuth();
    if (!cachedFileId) await ensureFile(token);

    // Load existing payload (merge across hostnames)
    const existing = await readFile();
    const merged = { ...(existing?.drafts || {}) };
    merged[hostname] = { ...data, syncedAt: Date.now() };

    const payload = {
      version: 1,
      updatedAt: Date.now(),
      drafts: merged,
    };

    const body = JSON.stringify(payload);
    const res = await fetch(
      `${UPLOAD_API}/files/${cachedFileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
      }
    );

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`push_failed_${res.status}: ${t.slice(0, 200)}`);
    }

    return { ok: true, bytes: body.length };
  } catch (err) {
    console.warn('[FormShield GDrive] push failed:', err);
    return { ok: false, error: err.message };
  }
}

export async function pull(hostname) {
  try {
    const token = await ensureAuth();
    if (!cachedFileId) await ensureFile(token);

    const file = await readFile();
    const draft = file?.drafts?.[hostname];
    if (!draft) return { ok: true, data: null };
    return { ok: true, data: draft };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function readFile() {
  const res = await driveApi(`/files/${cachedFileId}?alt=media`);
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

async function ensureAuth() {
  if (cachedToken) return cachedToken;
  await rehydrate();
  if (!cachedToken) throw new Error('not_authenticated');
  return cachedToken;
}