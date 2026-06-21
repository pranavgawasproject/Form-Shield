# 🛡️ Form Shield

> Never lose form data again. Auto-saves everything you type — **locally, across tabs, and to your own cloud.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome)](https://developer.chrome.com/docs/extensions/)
[![Version](https://img.shields.io/badge/version-1.1.0-blue)](https://github.com/pranavgawasproject/Form-Shield/releases)

## ✨ Features

### Core (Free)
- 💾 **Auto-Save** — every keystroke captured, 2s debounce
- 🔁 **Restore-on-Reload Prompt** — banner appears after a refresh offering to restore your draft
- 🔄 **Cross-Tab Sync** — type in one tab, see it sync to other tabs on the same site instantly
- 🛡️ **Triple-Redundancy Storage** — chrome.storage + IndexedDB + localStorage
- 🔒 **Local-First** — by default nothing leaves your browser
- 🚫 **Smart Blacklist** — skips banking/health sites and sensitive fields (passwords, SSN, credit cards)
- 🎨 **Popup UI** — see stats, restore drafts, manage cloud sync

### Cloud Sync
- 📁 **Google Drive (Free)** — sync drafts to your own Drive AppFolder. You own the data.
- ⚡ **Form Shield Pro ($5/mo)** — Supabase-backed cross-device sync, unlimited drafts, priority support

## 📁 Project Structure

```
form-shield/
├── manifest.json
├── background.js              # service worker — orchestrator
├── content.js                 # injected into pages
├── lib/
│   ├── google-drive-sync.js   # free tier — Drive AppFolder
│   └── supabase-sync.js       # pro tier — cross-device
├── styles/
│   ├── badge.css              # floating shield indicator
│   └── restore-banner.css     # restore-on-reload banner
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
└── icons/
```

## 🚀 Install (Developer Mode)

1. Clone this repo
2. Open `chrome://extensions/`
3. Toggle **Developer mode** (top-right)
4. Click **Load unpacked** → select the `form-shield/` folder
5. Pin **Form Shield** to your toolbar

## ⚙️ Cloud Sync Setup

### Google Drive (Free, Optional)

1. Create a Google Cloud project at https://console.cloud.google.com
2. Enable the **Google Drive API**
3. Configure OAuth consent screen (set scope: `drive.appfolder`)
4. Create an OAuth 2.0 Client ID (type: **Chrome Extension**)
5. Copy the Client ID into `manifest.json` → `oauth2.client_id`
6. (Optional but recommended) Generate an extension key and paste into `manifest.json` → `key`
7. Reload the extension → click the popup → **Connect Google Drive**

### Form Shield Pro (Supabase, $5/mo)

> Skip this section if you only want the free local + Google Drive tiers.

1. Create a Supabase project at https://supabase.com
2. In the SQL editor, run:

   ```sql
   create table public.drafts (
     user_id uuid references auth.users(id) on delete cascade,
     hostname text not null,
     data jsonb not null,
     updated_at timestamptz default now(),
     primary key (user_id, hostname)
   );
   alter table public.drafts enable row level security;

   create policy "Users can manage their own drafts"
     on public.drafts for all
     using (auth.uid() = user_id)
     with check (auth.uid() = user_id);
   ```

3. In `lib/supabase-sync.js`, replace:
   - `SUPABASE_URL` → your project URL
   - `SUPABASE_ANON_KEY` → your anon key (from Project Settings → API)
4. Reload the extension → click popup → **Sign in** / **Create account**
5. (Optional) Wire up Stripe for $5/mo billing — see [MONETIZATION.md](MONETIZATION.md)

## 🛠️ Tech Stack

- **Manifest V3** service worker (ES modules)
- **Vanilla JS** — zero runtime dependencies
- **Chrome Storage API** + **IndexedDB** + **localStorage** for redundancy
- **Google Drive API v3** for free cloud sync
- **Supabase** (Postgres + Auth + RLS) for Pro tier

## 🔐 Privacy

Form Shield stores drafts locally by default. Cloud sync is **opt-in**:
- **Google Drive**: drafts go into your own Drive AppFolder — only you have access
- **Supabase (Pro)**: drafts are tied to your user account; row-level security ensures only you can read/write your data

See [`privacy.html`](privacy.html) for the full policy.

## 📜 License

[MIT](LICENSE) © 2026 Pranav Gawas

## 💼 Business & Contributing

- **Monetization strategy**: see [MONETIZATION.md](MONETIZATION.md)
- **Roadmap**: see [ROADMAP.md](ROADMAP.md)
- **Issues / feature requests**: open an issue on GitHub
- **Pull requests** welcome — please discuss big changes first

---

Built because everyone has lost at least one form they cared about. Don't let it happen again. 🛡️