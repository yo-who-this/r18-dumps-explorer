# r18-dumps-explorer

A local database explorer for browsing, searching, and bookmarking [r18.dev](https://r18.dev) database dumps in an organised HTML viewer — entirely local, no server required.

---

## How It Works

The r18.dev database dump is a PostgreSQL export containing **1.8 million+ entries** across normalised tables (videos, actresses, categories, studios, etc.). This tool converts it into a single optimised SQLite file, which the HTML viewer loads directly in your browser using [sql.js](https://sql.js.org/) (SQLite compiled to WebAssembly).

```
r18dotdev_dump_YYYY-MM-DD.sql.gz     (PostgreSQL dump from r18.dev)
        │
        ▼  node convert_pg_to_sqlite.js
        │
r18_data.db                           (optimised SQLite, ~2 GB)
        │
        ▼  open r18_viewer.html, drop the .db file
        │
Browser                                (everything runs locally)
```

Just two files — a converter script and an HTML viewer.

---

## Setup

### Quick setup (recommended)

1. Download the latest database dump from [r18.dev/dumps](https://r18.dev/dumps) and place the `.sql.gz` file in this folder
2. Run the setup script:
   - **Mac/Linux** — double-click `setup.sh` or run `./setup.sh` in terminal
   - **Windows** — double-click `setup.bat`

The script checks for Node.js, installs the SQLite library if needed, and converts the dump into a ready-to-use database file.

3. Open `r18_viewer.html` in your browser and drop `r18_data.db` onto it

![Drop Zone](assets/Drop%20Zone.png)

### Manual setup

If you prefer to set things up yourself:

**1. Install Node.js** — download from [nodejs.org](https://nodejs.org/) (v18 or later)

**2. Install the SQLite library**

```bash
npm install -g better-sqlite3
```

**3. Download the database dump** from [r18.dev/dumps](https://r18.dev/dumps) and place the `.sql.gz` file in this folder

**4. Run the converter**

```bash
node convert_pg_to_sqlite.js
```

The script auto-detects the newest `.sql.gz` file, imports all tables, denormalises everything into a single searchable table, and outputs `r18_data.db`. Takes about **1-2 minutes**.

**5. Open the viewer** — open `r18_viewer.html` in your browser and drop `r18_data.db` onto the drop zone

---

## Features

### Browse the full catalog

Paginated grid view of all 1.8M+ entries with thumbnail images, codes, titles, and metadata (cast, tags, studio, label, series, director, release date, runtime). Navigate with Prev/Next buttons or jump to any page. Switch between **Grey** and **Dark** themes using the pill toggle.

![Main Grid View](assets/Dark%20Mode.png)

### Multi-word search with autocomplete

Type in the search bar to find entries by code, title, cast, tags, or any metadata. Multi-word queries match all words independently — searching `ssis abc` finds entries containing both words anywhere.

Autocomplete suggests matching codes, titles, and cast names as you type.

![Search Autocomplete](assets/Search%20Autocomplete.png)

### Filtering, sorting, and layout options

- **Content type** — toggle between **All Types**, **Live Action**, **Animated** (hentai/anime), and **Mainstream** (non-adult DVDs/Blu-rays that DMM also sells). Each shows its count.
- **Series & Tags** — use the dropdown filters to narrow results. Both support multi-word search with a count footer. Counts update dynamically based on active filters — e.g. searching for a cast name then opening the tags dropdown shows only relevant tags with accurate counts.
- **Sort** — by **Original order**, **Newest first**, **Code A-Z / Z-A**, or **Title A-Z**.
- **Grid size** — switch between **Compact**, **Default**, and **Comfortable** layouts.

![Filtering, sorting, and layout options](assets/Filter%20options.png)


### Detail panel

Click any card to open a slide-in detail panel showing:
- Full-resolution jacket image
- Sample video link (opens in new tab)
- Details table (content ID, DVD ID, release date, runtime, studio, label, series, director)
- Cast names
- Category pills
- Gallery images

![Detail Panel](assets/Detail%20Panel.png)

### Clickable metadata for cross-filtering

Everything in the detail panel is interactive:
- Click a **Series** name to filter the grid to that series
- Click a **Studio**, **Label**, **Director**, or **Cast** name to search for it
- Click a **Category** pill to filter by that tag

This makes it easy to explore related content without manually typing.



### Bookmarks with persistence

Click the star on any card or the "Bookmark" button in the detail panel to save entries. Bookmarks are stored in your browser's `localStorage` and persist across sessions — no manual saving needed.

Use the **Favorites** filter to show only bookmarked entries.



### Import and export bookmarks

**Export** downloads all bookmarks as a JSON file for backup or transfer. **Import** loads a previously exported file and merges it with existing bookmarks.



### Recent entries

The **New** filter shows entries released in the last 90 days.

### Back to top

A floating button appears when you scroll down, smoothly scrolling back to the top.

---

## Updating

When a new dump is released on [r18.dev/dumps](https://r18.dev/dumps):

1. Download the new `.sql.gz` file into the same folder
2. Run `node convert_pg_to_sqlite.js`
3. Reload the viewer and drop the new `r18_data.db`

Your bookmarks persist across database updates — they're stored in localStorage, not in the database file. You can also export your bookmarks as a JSON file for extra safety using the **Export** button.

---

## Compatibility

- **macOS** / **Windows** / **Linux**
- Any modern browser (Chrome, Firefox, Edge, Brave, Safari)
- Node.js v18+

---

## Data Source

Database dumps are sourced from [r18.dev](https://r18.dev), which aggregates the metadata from DMM/FANZA. This tool is a local viewer only — it does not scrape, download, or host any content.

## Disclaimer

This project is an independent, local-only viewer/converter for user-supplied database dumps.

- This repository does **not** include, mirror, or redistribute any `r18.dev` data dumps.
- Users must obtain any dump data themselves from the original source.
- This project is **not affiliated with, endorsed by, or maintained by** `r18.dev`.
- The tool is intended for **personal, local use only**.
- If the upstream source changes its format, access, or terms, this project may stop working.

If you are the maintainer of `r18.dev` and would like this repository modified or removed, please open an issue.
