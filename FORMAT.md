# Save format

The app reads and writes two interchangeable formats. Both round-trip: what you
save is what loads back, ticks and dates included. Nothing is uploaded anywhere —
files are produced and read entirely in the browser.

## 1. JSON — `*.json`

The canonical format. This is also exactly what sits in `localStorage` under the
key `lifelist.v1`.

```json
{
  "format": "lifelist",
  "version": 1,
  "title": "Life List",
  "subtitle": "Everything here is meant to be provable.",
  "labels": {
    "done": "Done",
    "todo": "Still to do",
    "group": "Chapter",
    "groups": "Chapters"
  },
  "updated": "2026-08-15T12:00:00.000Z",
  "categories": [
    {
      "name": "Mind and skill",
      "note": "Optional line shown above the section.",
      "items": [
        { "title": "Sub-20 second Rubik's Cube", "done": true, "date": "2019-03-14" },
        { "title": "Memorize 1000 digits of pi", "done": false, "highlight": true }
      ]
    }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `format`, `version` | no | Informational. Anything with a `categories` array loads. |
| `title` | no | Defaults to `My list`. Shown in the header and the browser tab. |
| `subtitle` | no | The small monospace line under the title. |
| `labels` | no | Vocabulary used throughout the UI. Missing keys fall back to grocery wording. |
| `categories[].name` | yes | Section / aisle / chapter name. |
| `categories[].note` | no | One line of prose under the section heading. |
| `categories[].items[]` | yes | A string is accepted as shorthand for `{ "title": … }`. |
| `items[].done` | no | Boolean. |
| `items[].date` | no | `YYYY-MM` or `YYYY-MM-DD`. A date implies `done` unless `done: false`. |
| `items[].highlight` | no | Boolean. Marks the item with a star and an accent bar. |
| `items[].id` | no | Generated if absent. |

Item order within a section is meaningful and is preserved exactly as written.

Empty-titled items are dropped on load. A file with no sections is rejected with
an error rather than wiping your list.

## 2. Markdown — `*.md`

Human-readable and diffable, so a list can live in a repo. This is the format a
plain GitHub-style checklist already uses, which means an existing checklist file
loads without any conversion.

```markdown
# Life List
> Everything here is meant to be provable.
<!-- lifelist labels: {"done":"Done","todo":"Still to do","group":"Chapter","groups":"Chapters"} -->

## Mind and skill

- [x] Sub-20 second Rubik's Cube <!-- 2019-03-14 -->
- [ ] Memorize 1000 digits of pi <!-- highlight -->

## Strength and physical

Optional prose right under the heading becomes the section note.

- [ ] Deadlift 2x bodyweight
```

Parsing rules:

- `# Heading` → list title (first one wins). `> line` before any section → subtitle.
- `## Heading` (through `######`) → a new section.
- `- [ ]` / `- [x]` → an item. `*` and `+` bullets work too; `[X]` is fine.
- Trailing HTML comments carry metadata, in any order and any number:
  `<!-- 2024-06-09 -->` is the completion date of a ticked line (month
  precision, `<!-- 2024-06 -->`, also works), and `<!-- highlight -->` stars the
  item. Comments render as nothing in any Markdown viewer, so the file still
  reads cleanly on GitHub. Unrecognised comments are ignored.
- The `<!-- lifelist labels: … -->` line carries the vocabulary. Delete it and
  the grocery defaults apply.
- A plain `- bullet` with no checkbox becomes an unticked item.
- Any other prose directly under a heading, before its first item, becomes the
  section note; everything else is ignored — including `---` rules and trailing
  sections that contain no items, so a "Notes on using this" epilogue is
  silently skipped.

## Loading

`You → Load a file…`, or drag a `.json`/`.md` file anywhere onto the window.
You then choose:

- **Replace** — the loaded file becomes the whole list.
- **Merge** — sections are matched by name (case-insensitive) and items by
  title; new ones are appended, and a ticked item in the incoming file marks the
  existing one as done. Nothing is deleted.

Either way an **Undo** appears in the toast for a few seconds, and the previous
state is restored in full if you take it.
