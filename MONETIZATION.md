# Monetization Strategy — Form Shield

## Pricing Tiers

| Tier | Price | What You Get |
|------|-------|--------------|
| **Free** | $0 | Local-only auto-save, restore-on-reload, cross-tab sync, blacklist, popup UI |
| **Free + Google Drive** | $0 | Free tier + cloud backup into user's own Drive AppFolder |
| **Pro** | $5/mo | Cross-device sync via Supabase, unlimited drafts, priority support, future: AI draft suggestions |
| **Team** (future) | $12/user/mo | Shared form templates, admin console, audit log |

## Why $5/mo Works

- The Pro tier saves someone ~2 hours/year of lost form work on average → trivial ROI
- Below the "is this a subscription I need to think about" threshold
- Recurring revenue from people who lose forms = strong LTV

## Stripe Integration (Outline)

1. Create a Stripe product: "Form Shield Pro" — $5/mo recurring
2. Add a "Manage Billing" button in popup that opens Stripe Customer Portal
3. Track `stripe_customer_id` per Supabase user (add a `profiles` table)
4. On successful checkout → set `tier = 'pro'` via webhook
5. On subscription cancel → set `tier = 'free'`

Webhook endpoint: `https://YOUR-PROJECT.supabase.co/functions/v1/stripe-webhook`
(recommended: Supabase Edge Function)

## Revenue Projections (Conservative)

| MAU | Free → Pro Conversion | Pro Users | MRR |
|-----|----------------------|-----------|-----|
| 1,000 | 2% | 20 | $100 |
| 10,000 | 2% | 200 | $1,000 |
| 50,000 | 2.5% | 1,250 | $6,250 |
| 100,000 | 3% | 3,000 | $15,000 |

## Growth Channels

1. **Show HN** — "I lost 4 hours of a job application. So I built this."
2. **Reddit** — r/productivity, r/webdev, r/chrome_extensions, r/lifeprotips
3. **Product Hunt** — launch with the restore-on-reload demo
4. **Twitter/X dev community** — short videos of "watch me lose a form / watch me get it back"
5. **Dev communities** — Indie Hackers, DevHunt, BetaList
6. **SEO** — "never lose form data", "form autosave chrome extension"

## Why This Is YC-Fundable

YC doesn't fund GitHub stars. They fund **businesses with evidence of product-market fit**:

- ✅ Real, repeated pain (everyone loses forms)
- ✅ Free tier builds viral distribution
- ✅ Clear monetization path (5% conversion at $5/mo is meaningful ARR)
- ✅ Founder insight (you've felt the pain yourself)
- ✅ Expansion path: Team tier → B2B → enterprise form-loss is a real $XXM problem
- ✅ Defensible: Google Drive integration + Supabase backend + Chrome extension distribution moat

**The YC pitch (one-liner):**
> "Form Shield auto-saves every form you fill out and restores it on crash. 10K weekly active users, $X MRR, growing 30% MoM. We're building the universal 'undo button' for the web."

## Next Steps

1. Get first 100 installs (Show HN + Reddit)
2. Track activation: % of installs that have ≥1 saved draft by day 7
3. Get first 10 paying Pro users (offer lifetime deal to early supporters)
4. Apply to YC for next batch with these metrics