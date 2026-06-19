# 🛡️ Form Shield

> A Chrome extension (Manifest V3) that **never lets you lose form data again** — auto-saves everything you type and lets you recover it when things go wrong.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome)](https://developer.chrome.com/docs/extensions/)

## ✨ Features

- 💾 **Auto-Save** — every keystroke in any form is captured and stored locally
- 🔁 **One-Click Restore** — recover your draft when a page reloads or crashes
- 🔒 **Local-First** — all data stays in `chrome.storage`, never leaves your browser
- 🌐 **Universal** — works on every website (`<all_urls>`)
- 🪶 **Lightweight** — no background bloat, runs at `document_idle`
- 🎨 **Popup UI** — quick view of saved drafts and restore controls

## 🛠️ Tech Stack

- **Manifest V3** service worker
- **Vanilla JS** content + background scripts
- **Chrome Storage API** for persistence
- HTML / CSS popup

## 📁 Project Structure

```
.
├── form-shield/
│   ├── manifest.json
│   ├── background.js       # service worker
│   ├── content.js          # injected into pages
│   ├── styles/badge.css
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.css
│   │   └── popup.js
│   └── icons/
└── privacy.html
```

## 🚀 Install (Developer Mode)

1. Clone the repo
2. Open `chrome://extensions/`
3. Toggle **Developer mode** (top-right)
4. Click **Load unpacked** → select the `form-shield/` folder
5. Pin **Form Shield** to your toolbar and you're set

## 🔐 Privacy

Form Shield stores drafts locally via `chrome.storage.local`. No data is sent to any server. See [`privacy.html`](privacy.html) for the full policy.

## 📜 License

[MIT](LICENSE) © 2026 Pranav Gawas
