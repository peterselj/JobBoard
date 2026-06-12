# 🎯 JobBoard — a CRM for your job search

A weighted-pipeline CRM for jobhunters. Where a sales rep works deals to close revenue, you work
opportunities to close **a job offer** — and like any pipeline, most opps won't close, so the
winning strategy is volume + referrals + honest math.

**Live app:** https://peterselj.github.io/JobBoard/

## The core idea: the weighted pipeline

Each stage carries the realistic probability that an opp at that stage becomes an offer:

| Stage | Weight |
|---|---|
| New Opp | 0% |
| Cold Applied (portal drop, no referral) | 0.1% |
| Referral Convo | 2.5% |
| Applied w/ Referral | 5% |
| Recruiter Screen | 7.5% |
| Hiring Manager | 12.5% |
| Final Round | 33% |
| Negotiation | 75% |

Summing the weights of your active opps gives your **expected offers**. Most people are shocked
how small the number is — that's the point. The dashboard tells you how many new opps per week
you need to carry a full expected offer by your target date. All stages and weights are editable
(Settings), and you can add your own stages.

## Referral-first workflow

Dropping a resume in a portal barely counts (0.1%). The intended loop:

1. Identify a job you want → add it as a **New Opp**
2. Find a person there who can refer you (see below)
3. Have the convo, get the referral
4. *Then* apply — and interview

### Referral paths

Every opportunity tracks **referral paths**: each path is a target referrer, optionally reached
via a 1st-degree *bridge* who can make the intro (`Adrienne → Markus`). A 2nd-degree target with
three mutual connections gets three rows — one per bridge. Each path advances through
*identified → intro solicited → intro made → chat booked → referral made* (or *dead end*), and
every status change is logged to the opp's activity timeline automatically.

## LinkedIn integration (no scraping, ToS-safe)

LinkedIn has no API for your connections, but it lets you **export them yourself**
(Settings & Privacy → Data privacy → Get a copy of your data → Connections). Import that
`Connections.csv` on the Contacts tab and the app automatically surfaces **warm paths**: anyone
in your network at a company you're targeting lights up on that opp. Every opp also gets
one-click links into LinkedIn's own people search: 1st/2nd degree at the company, plus an
**alumni search per school** you add in Settings (multiple schools supported — uses LinkedIn's
numeric school ID in a people-search `schoolFilter`, with in-app instructions for grabbing the
ID once).

## Your data

Everything is stored in your browser (IndexedDB) — nothing is ever uploaded. Each visitor to the
app gets their own private workspace, so sharing the URL with a friend gives them a fresh,
separate pipeline. Use **Settings → Export backup** for a JSON backup / moving machines.

## Development

```
npm install
npm run dev     # local dev server
npm run build   # type-check + production build
```

Pushes to `main` auto-deploy to GitHub Pages via Actions. Stack: Vite, React, TypeScript,
Tailwind CSS, Dexie (IndexedDB), PapaParse.

## Versions

Releases are git tags; the running version is shown in the app footer. Schema changes ship as
in-place Dexie migrations so existing users' data is never dropped.

- **v0.2** — referral paths (bridge → target chains with status tracking), per-school alumni
  search via LinkedIn school IDs, warm-path list search/cap for big networks, FAQ, sticky opp
  header, Esc-to-close, funnel scaling fix, version footer
- **v0.1** — initial release: weighted pipeline, kanban, contacts + LinkedIn CSV import,
  warm-path matching, dashboard, backup/restore
