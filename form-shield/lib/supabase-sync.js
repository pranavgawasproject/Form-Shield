// ============================================
// FORM SHIELD - Supabase Sync (Pro / Paid Tier)
// Cross-device encrypted sync. Requires user account.
// ============================================

// ============================================
// CONFIG — replace with your Supabase project
// ============================================
// Get these from Supabase Dashboard → Project Settings → API
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';

const SESSION_KEY = 'formshield_supabase_session';

let cachedSession = null;
let cachedUserId = null;
let cachedEmail = null;

// ============================================
// AUTH
// ============================================

export async function signIn(email, password) {
  if (!isConfigured()) return { ok: false, error: 'supabase_not_configured' };
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error_description || json.msg || 'signin_failed' };

    cachedSession = json;
    cachedUserId = json.user?.id;
    cachedEmail = json.user?.email;
    await chrome.storage.local.set({
      [SESSION_KEY]: { session: json, email: cachedEmail, savedAt: Date.now() },
    });
    await markEnabled();
    return { ok: true, email: cachedEmail };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function signUp(email, password) {
  if (!isConfigured()) return { ok: false, error: 'supabase_not_configured' };
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json.error_description || json.msg || 'signup_failed' };

    // Supabase may require email confirmation before session is returned.
    if (!json?.access_token) {
      return {
        ok: true,
        email,
        needsConfirmation: true,
        message: 'Check your email to confirm your account, then sign in.',
      };
    }

    cachedSession = json;
    cachedUserId = json.user?.id;
    cachedEmail = json.user?.email;
    await chrome.storage.local.set({
      [SESSION_KEY]: { session: json, email: cachedEmail, savedAt: Date.now() },
    });
    await markEnabled();
    return { ok: true, email: cachedEmail };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function signOut() {
  cachedSession = null;
  cachedUserId = null;
  cachedEmail = null;
  await chrome.storage.local.remove([SESSION_KEY]);
  const settings = (await chrome.storage.local.get(['formshield_settings']))
    .formshield_settings || {};
  await chrome.storage.local.set({
    formshield_settings: {
      ...settings,
      supabaseEnabled: false,
      supabaseEmail: null,
      supabaseUserId: null,
      tier: 'free',
    },
  });
  return { ok: true };
}

export async function status() {
  const stored = (await chrome.storage.local.get([SESSION_KEY]))[SESSION_KEY];
  const settings = (await chrome.storage.local.get(['formshield_settings']))
    .formshield_settings || {};
  return {
    ok: true,
    connected: !!stored?.session?.access_token && !!settings.supabaseEnabled,
    email: settings.supabaseEmail || stored?.email || null,
    tier: settings.tier || 'free',
    configured: isConfigured(),
  };
}

export async function rehydrate() {
  const stored = (await chrome.storage.local.get([SESSION_KEY]))[SESSION_KEY];
  if (!stored?.session?.access_token) return;
  // Validate by hitting /auth/v1/user
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${stored.session.access_token}`,
      },
    });
    if (!res.ok) {
      // Try refresh
      const refreshed = await refreshSession(stored.session.refresh_token);
      if (!refreshed) {
        await signOut();
        return;
      }
    }
    cachedSession = stored.session;
    cachedUserId = stored.session.user?.id;
    cachedEmail = stored.session.user?.email || stored.email;
  } catch (_) {
    // network blip — keep cached session, will fail later if truly bad
  }
}

async function refreshSession(refreshToken) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    cachedSession = json;
    cachedUserId = json.user?.id;
    cachedEmail = json.user?.email;
    await chrome.storage.local.set({
      [SESSION_KEY]: { session: json, email: cachedEmail, savedAt: Date.now() },
    });
    return json;
  } catch (_) {
    return null;
  }
}

async function markEnabled() {
  const settings = (await chrome.storage.local.get(['formshield_settings']))
    .formshield_settings || {};
  await chrome.storage.local.set({
    formshield_settings: {
      ...settings,
      supabaseEnabled: true,
      supabaseEmail: cachedEmail,
      supabaseUserId: cachedUserId,
      cloudSyncEnabled: true,
      tier: 'pro',
    },
  });
}

// ============================================
// PUSH / PULL
// ============================================

export async function push(hostname, data) {
  if (!isConfigured()) return { ok: false, error: 'not_configured' };
  if (!cachedSession?.access_token) await rehydrate();
  if (!cachedSession?.access_token) return { ok: false, error: 'not_signed_in' };

  try {
    // Upsert into drafts table. Schema:
    //   user_id uuid (PK part), hostname text (PK part), data jsonb, updated_at timestamptz
    const row = {
      user_id: cachedUserId,
      hostname,
      data: { ...data, syncedAt: Date.now() },
      updated_at: new Date().toISOString(),
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/drafts?on_conflict=user_id,hostname`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${cachedSession.access_token}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([row]),
    });

    if (res.status === 401) {
      // Token expired — try refresh once
      const refreshed = await refreshSession(cachedSession.refresh_token);
      if (refreshed) return push(hostname, data);
      return { ok: false, error: 'auth_expired' };
    }

    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: `push_failed_${res.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function pull(hostname) {
  if (!isConfigured()) return { ok: false, error: 'not_configured' };
  if (!cachedSession?.access_token) await rehydrate();
  if (!cachedSession?.access_token) return { ok: false, error: 'not_signed_in' };

  try {
    const url = `${SUPABASE_URL}/rest/v1/drafts?user_id=eq.${encodeURIComponent(
      cachedUserId
    )}&hostname=eq.${encodeURIComponent(hostname)}&select=data&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${cachedSession.access_token}`,
      },
    });
    if (!res.ok) return { ok: false, error: `pull_failed_${res.status}` };
    const rows = await res.json();
    if (!rows || rows.length === 0) return { ok: true, data: null };
    return { ok: true, data: rows[0].data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function isConfigured() {
  return (
    SUPABASE_URL &&
    !SUPABASE_URL.includes('YOUR-PROJECT') &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_ANON_KEY.includes('YOUR-ANON-KEY')
  );
}

// ============================================
// SETUP NOTE
// ============================================
// To enable Supabase paid tier:
//   1. Create a Supabase project
//   2. Run this SQL in Supabase SQL editor:
//
//      create table public.drafts (
//        user_id uuid references auth.users(id) on delete cascade,
//        hostname text not null,
//        data jsonb not null,
//        updated_at timestamptz default now(),
//        primary key (user_id, hostname)
//      );
//      alter table public.drafts enable row level security;
//      create policy "own drafts" on public.drafts
//        for all using (auth.uid() = user_id);
//      create policy "own drafts insert" on public.drafts
//        for insert with check (auth.uid() = user_id);
//
//   3. Replace SUPABASE_URL and SUPABASE_ANON_KEY above
//   4. Rebuild the extension
// ============================================