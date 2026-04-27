# Garden — Plant Health Tracker

A lightweight, mobile-first PWA for tracking the health of your plants. Botanical-journal aesthetic, no backend, all data lives on your device.

## Features

- **Today** — dashboard surfacing plants that need watering or feeding
- **Plants list** — all your plants at a glance with health badge and last-watered tag
- **Plant detail** — photo, stats, quick-action buttons (Watered / Fed / Note), health-score chart, full history
- **Log entry sheet** — pick type (water / feed / observe / repot), date, 1–10 health slider, notes
- **Logs view** — chronological feed of all activity
- **Export / Import** — JSON backup so your data is portable
- **Installable** — add to iOS home screen and it runs full-screen, offline

## Deploy to GitHub Pages

Same flow as your habit tracker:

1. Create a new public repo on GitHub (e.g. `plant-tracker`)
2. Drop all the files from this folder into the repo root and commit
3. Go to **Settings → Pages**, set source to `main` branch, root folder
4. Wait a minute, then visit `https://samu3lp.github.io/plant-tracker/`
5. On iPhone: open in Safari → Share → **Add to Home Screen**

Once installed it'll have its own icon, launch full-screen, and work offline after first load.

## Files

- `index.html` — the entire app (HTML, CSS, JS in one file)
- `manifest.json` — PWA metadata
- `sw.js` — service worker for offline support
- `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` — PWA icons
- `apple-touch-icon.png` — 180×180 icon for iOS home screen

## Data

Everything is stored in `localStorage` under the key `garden_v1`. To back up, hit Settings → Export. To migrate to a new device, export then import the JSON file.

If you ever want to change the schema, the data shape is:

```json
{
  "plants": [{
    "id": "abc123",
    "name": "Living room monstera",
    "species": "Monstera deliciosa",
    "location": "Living room",
    "acquired": "2025-08-01",
    "wateringDays": 7,
    "fertilisingDays": 30,
    "notes": "",
    "photo": "data:image/jpeg;base64,..."
  }],
  "logs": [{
    "id": "xyz789",
    "plantId": "abc123",
    "type": "water",
    "date": "2026-04-27",
    "healthScore": 8,
    "notes": "New leaf unfurling"
  }]
}
```

## Tweaks you might want later

- A "next due" sort on the plants list
- Push notifications (requires a service worker upgrade and is a bit fiddly on iOS)
- Photo timeline view per plant — quick to add since photos are already attached to log entries
- Tags/categories beyond just location
