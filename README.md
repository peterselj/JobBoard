# 🎯 JobBoard — a CRM for your job search

A high-volume, referral-first CRM for jobhunters. Where a sales rep works deals to close revenue,
you work opportunities to close **a job offer** — and like any pipeline, most opps won't close, so
the winning strategy is volume + referrals + honest math.

**Live app:** https://peterselj.github.io/JobBoard/

## The core idea: the weighted pipeline

Each stage carries the realistic probability that an opp at that stage becomes an offer:

| Stage | Weight |
|---|---|
| New Opp | 0% |
| Cold Applied (portal drop, no referral) | 0.1% |
| Source Connection (finding who can intro you) | 1% |
| Referral Convo | 2.5% |
| Applied w/ Referral | 5% |
| Recruiter Screen | 7.5% |
| Hiring Manager | 12.5% |
| Final Round | 33% |
| Negotiation | 75% |

Summing the weights of your active opps gives your **expected offers** — the headline KPI. Most
people are shocked how small the number is; that's the point. The dashboard's traffic-light KPIs,
weekly-reps rings, and "Do this today" queue keep the volume honest, and Best Practices includes a
calculator for the pace you need. All stages and weights are editable (Settings).

## Referral-first workflow

Dropping a resume in a portal barely counts (0.1%). The intended loop:

1. Identify a job you want → quick-add it (paste a URL or type a name — it lands as a draft to groom)
2. Open the opportunity and build **inroads** — your routes to a referral
3. Work the inroads to a referral, *then* apply — and interview

### Inroads

Every opportunity has its own mini-board of inroads: **1st degree** (someone you know there),
**2nd degree** (a target reached via a connector you know), or **alumni** from your schools. Drag
cards across *Identified → Contacted → In conversation* and into **Referred!** when someone puts
your name forward. Cards colour by staleness (amber ≥3 days quiet, brick ≥7) so nothing rots.
Double-click a card to edit contact details and log activity.

## LinkedIn integration (no scraping, ToS-safe)

Every opportunity gets one-click launchers into LinkedIn's own people search: 1st/2nd degree at
the company, plus an **alumni search per school** you add in Settings (uses LinkedIn's numeric
school ID in a people-search `schoolFilter`, with in-app instructions for grabbing the ID once).
Paste a profile URL back into an inroad field and the contact is created from it.

## Your data

Everything is stored in your browser (IndexedDB) — nothing is ever uploaded, no accounts. Each
visitor gets their own private workspace, so sharing the URL with a friend gives them a fresh,
separate pipeline. For durability beyond the browser, set up the **autosave backup file**
(Settings → Local backup file, Chromium browsers): the app silently rewrites a JSON file on your
machine after every change and offers one-click restore if the browser is ever wiped. Manual
export/import works everywhere.

## Development

```
npm install
npm run dev     # local dev server
npm run build   # type-check + production build
```

Pushes to `main` auto-deploy to GitHub Pages via Actions. Stack: Vite, React, TypeScript,
Tailwind CSS, Dexie (IndexedDB).

## Versions

Releases are git tags (see the tag list for the changelog); the running version is shown in the
Settings/Best Practices header. Schema changes ship as in-place Dexie migrations so existing
users' data is never dropped.
