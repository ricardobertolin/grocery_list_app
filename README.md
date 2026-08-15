# Grocery List

An offline-first checklist PWA, built from the `Life List - Market` design doc.
Receipt-paper look, one item per line, a date stamped on everything you tick off.

It ships with a **generic weekly grocery list**, so anyone opening the site sees
a plain shopping list — not somebody's personal data. Your own list lives only in
your browser, and travels as a file you save and load yourself.

## Use

- Tap a row to tick it. Ticking stamps today's date; unticking clears it.
- `···` on a row edits the text, changes the date, or deletes it.
- **List** — the active section. **Aisles** — all sections with progress, plus
  add / rename / delete. **Receipts** — everything ticked, newest month first.
  **You** — stats, title and wording, and all the file operations.
- `/` focuses search (searches every section). `Esc` clears it.
- **Hide ticked** collapses what's already done.

Wording adapts: `You → Groceries / Life list / Plain` switches "In cart / Aisle"
to "Done / Chapter" and so on. Nothing else about the app changes.

**Light or dark:** `You → Appearance → Auto / Light / Dark`. Auto follows the
operating system and flips live when the system does; Light and Dark pin the app
regardless of the system setting. The choice is per-device and survives reloads.

## Your list

Storage is `localStorage` on the device, nothing else. To move a list between
devices, or to keep it in a repo, save a file:

- `You → Save .json` — the canonical format.
- `You → Save .md` — a plain GitHub-style checklist, ticks and dates included.
- `You → Load a file…`, or drag a file onto the window — then choose **Replace**
  or **Merge**.

An existing Markdown checklist (`## Section` headings, `- [ ]` items) loads as-is
with no conversion step. See [FORMAT.md](FORMAT.md) for the full spec.

`Clear all ticks` empties the checkboxes but keeps the items — handy for a list
you reuse every week. `Reset to sample list` puts the shipped grocery list back.
Both offer an Undo.

## Run and deploy

No build step, no dependencies. Serve the folder over HTTP — service workers do
not register from `file://`:

```sh
python -m http.server 8000
# then open http://localhost:8000
```

For GitHub Pages, point Pages at the repository root on `main`. Every path is
relative, so it works from a project subpath (`user.github.io/repo/`) as well as
a custom domain.

After changing any precached file, bump `CACHE` in `sw.js` so installed copies
pick it up; the app shows a "new version is ready" toast with a Reload button.

## Files

```
index.html                app shell
assets/app.css            styles (light + dark)
assets/app.js             state, rendering, import/export
assets/default-list.js    the generic grocery list everyone sees first
manifest.webmanifest      PWA manifest
sw.js                     offline cache
icons/                    app icons
FORMAT.md                 save format spec
```

`*.json` is gitignored, so exported lists dropped in this folder never get
committed by accident. `manifest.webmanifest` deliberately avoids the `.json`
extension so it stays tracked.
