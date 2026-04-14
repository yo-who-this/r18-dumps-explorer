#!/usr/bin/env python3
"""
PG Dump → SQLite converter for r18.dev database (Python version)
Usage:  python convert_pg_to_sqlite.py
Input:  r18dotdev_dump_YYYY-MM-DD.sql.gz (same directory)
Output: r18_data.db (optimised SQLite for the viewer)

No dependencies required — uses only Python standard library.
Slower than the Node.js version but zero setup needed.
"""

import os
import sys
import gzip
import glob
import time
import sqlite3

DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(DIR, "r18_data.db")

# ── Auto-detect dump file ───────────────────────────────────────

def find_sql_dump():
    # Check for .sql files first
    sql_files = sorted(glob.glob(os.path.join(DIR, "r18dotdev_dump*.sql")), reverse=True)
    if sql_files:
        return sql_files[0], False

    # Check for .sql.gz
    gz_files = sorted(glob.glob(os.path.join(DIR, "r18dotdev_dump*.sql.gz")), reverse=True)
    if gz_files:
        return gz_files[0], True

    return None, False


dump_path, is_gzipped = find_sql_dump()
if not dump_path:
    print("No r18dotdev_dump*.sql or .sql.gz found in:", DIR)
    sys.exit(1)

# ── Schema ──────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE video (
    content_id TEXT NOT NULL,
    dvd_id TEXT,
    title_en TEXT,
    title_ja TEXT,
    runtime_mins INTEGER,
    release_date TEXT,
    sample_url TEXT,
    maker_id INTEGER,
    label_id INTEGER,
    series_id INTEGER,
    jacket_full_url TEXT,
    jacket_thumb_url TEXT,
    gallery_full_first TEXT,
    gallery_full_last TEXT,
    site_id INTEGER,
    service_code TEXT NOT NULL
);

CREATE TABLE actress (
    id INTEGER PRIMARY KEY,
    name_romaji TEXT,
    name_kanji TEXT,
    name_kana TEXT
);

CREATE TABLE video_actress (
    content_id TEXT NOT NULL,
    actress_id INTEGER NOT NULL,
    ordinality INTEGER
);

CREATE TABLE category (
    id INTEGER PRIMARY KEY,
    name_en TEXT,
    name_ja TEXT
);

CREATE TABLE video_category (
    content_id TEXT NOT NULL,
    category_id INTEGER NOT NULL
);

CREATE TABLE maker (
    id INTEGER PRIMARY KEY,
    name_en TEXT,
    name_ja TEXT
);

CREATE TABLE label (
    id INTEGER PRIMARY KEY,
    name_en TEXT,
    name_ja TEXT
);

CREATE TABLE series (
    id INTEGER PRIMARY KEY,
    name_en TEXT,
    name_ja TEXT
);

CREATE TABLE director (
    id INTEGER PRIMARY KEY,
    name_kanji TEXT,
    name_kana TEXT,
    name_romaji TEXT
);

CREATE TABLE video_director (
    content_id TEXT NOT NULL,
    director_id INTEGER NOT NULL
);

CREATE TABLE trailer (
    content_id TEXT PRIMARY KEY,
    url TEXT
);
"""

# ── PG COPY table mapping ──────────────────────────────────────

TABLE_MAP = {
    "derived_video": {
        "table": "video",
        "cols": ["content_id","dvd_id","title_en","title_ja","comment_en","comment_ja",
                 "runtime_mins","release_date","sample_url","maker_id","label_id",
                 "series_id","jacket_full_url","jacket_thumb_url","gallery_full_first",
                 "gallery_full_last","gallery_thumb_first","gallery_thumb_last",
                 "site_id","service_code"],
        "pick": [0,1,2,3,6,7,8,9,10,11,12,13,14,15,18,19],
        "sqlite_cols": ["content_id","dvd_id","title_en","title_ja","runtime_mins",
                        "release_date","sample_url","maker_id","label_id","series_id",
                        "jacket_full_url","jacket_thumb_url","gallery_full_first",
                        "gallery_full_last","site_id","service_code"],
    },
    "derived_actress": {
        "table": "actress",
        "cols": ["id","name_romaji","image_url","name_kanji","name_kana"],
        "pick": [0,1,3,4],
        "sqlite_cols": ["id","name_romaji","name_kanji","name_kana"],
    },
    "derived_video_actress": {
        "table": "video_actress",
        "cols": ["content_id","actress_id","ordinality","release_date"],
        "pick": [0,1,2],
        "sqlite_cols": ["content_id","actress_id","ordinality"],
    },
    "derived_category": {
        "table": "category",
        "cols": ["id","name_en","name_ja"],
        "pick": [0,1,2],
        "sqlite_cols": ["id","name_en","name_ja"],
    },
    "derived_video_category": {
        "table": "video_category",
        "cols": ["content_id","category_id","release_date"],
        "pick": [0,1],
        "sqlite_cols": ["content_id","category_id"],
    },
    "derived_maker": {
        "table": "maker",
        "cols": ["id","name_en","name_ja"],
        "pick": [0,1,2],
        "sqlite_cols": ["id","name_en","name_ja"],
    },
    "derived_label": {
        "table": "label",
        "cols": ["id","name_en","name_ja"],
        "pick": [0,1,2],
        "sqlite_cols": ["id","name_en","name_ja"],
    },
    "derived_series": {
        "table": "series",
        "cols": ["id","name_en","name_ja"],
        "pick": [0,1,2],
        "sqlite_cols": ["id","name_en","name_ja"],
    },
    "derived_director": {
        "table": "director",
        "cols": ["id","name_kanji","name_kana","name_romaji"],
        "pick": [0,1,2,3],
        "sqlite_cols": ["id","name_kanji","name_kana","name_romaji"],
    },
    "derived_video_director": {
        "table": "video_director",
        "cols": ["content_id","director_id"],
        "pick": [0,1],
        "sqlite_cols": ["content_id","director_id"],
    },
    "source_dmm_trailer": {
        "table": "trailer",
        "cols": ["content_id","url","timestamp"],
        "pick": [0,1],
        "sqlite_cols": ["content_id","url"],
    },
}

# ── PG COPY field unescaping ────────────────────────────────────

def unescape_pg(field):
    if field == "\\N":
        return None
    result = []
    i = 0
    while i < len(field):
        if field[i] == "\\" and i + 1 < len(field):
            nxt = field[i + 1]
            if nxt == "\\": result.append("\\")
            elif nxt == "n": result.append("\n")
            elif nxt == "t": result.append("\t")
            elif nxt == "r": result.append("\r")
            else: result.append(field[i]); i += 1; continue
            i += 2
        else:
            result.append(field[i])
            i += 1
    return "".join(result)


# ── Phase 1: Import PG dump ────────────────────────────────────

def import_dump(db):
    print("=== Phase 1: Importing PG dump into SQLite ===\n")

    if is_gzipped:
        print(f"  Decompressing {os.path.basename(dump_path)}...")
        opener = lambda: gzip.open(dump_path, "rt", encoding="utf-8", errors="replace")
    else:
        opener = lambda: open(dump_path, "r", encoding="utf-8", errors="replace")

    # Prepare insert statements
    insert_sql = {}
    for pg_name, spec in TABLE_MAP.items():
        placeholders = ",".join(["?"] * len(spec["sqlite_cols"]))
        insert_sql[pg_name] = (
            f"INSERT OR IGNORE INTO {spec['table']} ({','.join(spec['sqlite_cols'])}) VALUES ({placeholders})"
        )

    current_table = None
    current_spec = None
    row_count = 0
    total_rows = 0
    batch = []
    BATCH_SIZE = 10000

    with opener() as f:
        for line in f:
            line = line.rstrip("\n").rstrip("\r")

            if current_table:
                if line == "\\.":
                    # Flush remaining batch
                    if batch:
                        db.executemany(insert_sql[current_table], batch)
                        batch = []
                    db.commit()
                    print(f"  \u2713 {current_spec['table']}: {row_count:,} rows")
                    total_rows += row_count
                    current_table = None
                    current_spec = None
                    row_count = 0
                    continue

                fields = line.split("\t")
                values = tuple(unescape_pg(fields[i]) for i in current_spec["pick"])
                batch.append(values)
                row_count += 1

                if len(batch) >= BATCH_SIZE:
                    db.executemany(insert_sql[current_table], batch)
                    batch = []
                continue

            # Look for COPY statements
            if line.startswith("COPY public."):
                table_name = line.split("(")[0].replace("COPY public.", "").strip()
                if table_name in TABLE_MAP:
                    current_table = table_name
                    current_spec = TABLE_MAP[table_name]
                    row_count = 0
                    batch = []
                    print(f"  Importing {current_spec['table']}...")
                    db.execute("BEGIN")

    print(f"\nTotal imported: {total_rows:,} rows\n")


# ── Phase 2: Indexes ───────────────────────────────────────────

def create_indexes(db):
    print("=== Phase 2: Creating indexes ===\n")

    indexes = [
        "CREATE INDEX idx_video_content ON video(content_id)",
        "CREATE INDEX idx_video_service ON video(content_id, service_code)",
        "CREATE INDEX idx_va_content ON video_actress(content_id)",
        "CREATE INDEX idx_va_actress ON video_actress(actress_id)",
        "CREATE INDEX idx_vc_content ON video_category(content_id)",
        "CREATE INDEX idx_vc_category ON video_category(category_id)",
        "CREATE INDEX idx_vd_content ON video_director(content_id)",
        "CREATE INDEX idx_vd_director ON video_director(director_id)",
    ]

    for sql in indexes:
        name = sql.split("idx_")[1].split(" ")[0]
        print(f"  idx_{name}...", end="", flush=True)
        db.execute(sql)
        print(" \u2713")
    print()


# ── Phase 3: Denormalize ───────────────────────────────────────

def denormalize(db):
    print("=== Phase 3: Building denormalized video_search table ===\n")

    print("  Deduplicating videos...")
    db.executescript("""
        CREATE TABLE video_dedup AS
        SELECT * FROM (
            SELECT *,
                ROW_NUMBER() OVER (
                    PARTITION BY content_id
                    ORDER BY CASE service_code
                        WHEN 'digital' THEN 1
                        WHEN 'mono' THEN 2
                        WHEN 'rental' THEN 3
                        WHEN 'nikkatsu' THEN 4
                        WHEN 'ebook' THEN 5
                        ELSE 6
                    END
                ) AS rn
            FROM video
        ) WHERE rn = 1;
    """)
    count = db.execute("SELECT COUNT(*) FROM video_dedup").fetchone()[0]
    print(f"  \u2713 {count:,} unique videos after dedup\n")

    print("  Aggregating cast...")
    db.executescript("""
        CREATE TABLE _cast_agg AS
        SELECT va.content_id,
            GROUP_CONCAT(COALESCE(a.name_romaji, a.name_kanji, a.name_kana), ', ') AS cast_text
        FROM video_actress va
        JOIN actress a ON va.actress_id = a.id
        WHERE COALESCE(a.name_romaji, a.name_kanji, a.name_kana) IS NOT NULL
        GROUP BY va.content_id;
    """)
    print("  \u2713 Cast aggregated")

    print("  Aggregating tags...")
    db.executescript("""
        CREATE TABLE _tags_agg AS
        SELECT vc.content_id,
            GROUP_CONCAT(COALESCE(c.name_en, c.name_ja), ', ') AS tags_text
        FROM video_category vc
        JOIN category c ON vc.category_id = c.id
        WHERE COALESCE(c.name_en, c.name_ja) IS NOT NULL
        GROUP BY vc.content_id;
    """)
    print("  \u2713 Tags aggregated")

    print("  Aggregating directors...")
    db.executescript("""
        CREATE TABLE _dir_agg AS
        SELECT vd.content_id,
            GROUP_CONCAT(COALESCE(d.name_romaji, d.name_kanji, d.name_kana), ', ') AS director_text
        FROM video_director vd
        JOIN director d ON vd.director_id = d.id
        WHERE COALESCE(d.name_romaji, d.name_kanji, d.name_kana) IS NOT NULL
        GROUP BY vd.content_id;
    """)
    print("  \u2713 Directors aggregated")

    print("  Building video_search...")
    db.executescript("""
        CREATE TABLE video_search (
            content_id TEXT PRIMARY KEY,
            dvd_id TEXT,
            title TEXT,
            title_ja TEXT,
            runtime_mins INTEGER,
            release_date TEXT,
            sample_url TEXT,
            jacket_thumb TEXT,
            jacket_full TEXT,
            gallery_first TEXT,
            gallery_last TEXT,
            maker TEXT,
            label_text TEXT,
            series_text TEXT,
            cast_text TEXT,
            tags_text TEXT,
            director_text TEXT,
            search_blob TEXT
        );

        INSERT INTO video_search
        SELECT
            v.content_id,
            v.dvd_id,
            COALESCE(NULLIF(v.title_en,''), v.title_ja) AS title,
            v.title_ja,
            v.runtime_mins,
            v.release_date,
            COALESCE(v.sample_url, t.url) AS sample_url,
            v.jacket_thumb_url AS jacket_thumb,
            v.jacket_full_url AS jacket_full,
            v.gallery_full_first AS gallery_first,
            v.gallery_full_last AS gallery_last,
            COALESCE(NULLIF(m.name_en,''), m.name_ja) AS maker,
            COALESCE(NULLIF(l.name_en,''), l.name_ja) AS label_text,
            COALESCE(NULLIF(s.name_en,''), s.name_ja) AS series_text,
            ca.cast_text,
            ta.tags_text,
            da.director_text,
            LOWER(
                COALESCE(v.dvd_id,'') || ' ' ||
                COALESCE(NULLIF(v.title_en,''), v.title_ja, '') || ' ' ||
                COALESCE(ca.cast_text,'') || ' ' ||
                COALESCE(ta.tags_text,'') || ' ' ||
                COALESCE(NULLIF(m.name_en,''), m.name_ja, '') || ' ' ||
                COALESCE(NULLIF(l.name_en,''), l.name_ja, '') || ' ' ||
                COALESCE(NULLIF(s.name_en,''), s.name_ja, '') || ' ' ||
                COALESCE(da.director_text,'')
            ) AS search_blob
        FROM video_dedup v
        LEFT JOIN maker m ON v.maker_id = m.id
        LEFT JOIN label l ON v.label_id = l.id
        LEFT JOIN series s ON v.series_id = s.id
        LEFT JOIN trailer t ON v.content_id = t.content_id
        LEFT JOIN _cast_agg ca ON v.content_id = ca.content_id
        LEFT JOIN _tags_agg ta ON v.content_id = ta.content_id
        LEFT JOIN _dir_agg da ON v.content_id = da.content_id;
    """)

    count = db.execute("SELECT COUNT(*) FROM video_search").fetchone()[0]
    print(f"  \u2713 video_search: {count:,} rows\n")


# ── Phase 4: Auxiliary tables ──────────────────────────────────

def build_aux_tables(db):
    print("=== Phase 4: Building auxiliary tables ===\n")

    print("  Building tag_count...")
    db.executescript("""
        CREATE TABLE tag_count (name TEXT PRIMARY KEY, cnt INTEGER);
        INSERT INTO tag_count
        SELECT COALESCE(NULLIF(c.name_en,''), c.name_ja) AS name, COUNT(DISTINCT vc.content_id) AS cnt
        FROM video_category vc
        JOIN category c ON vc.category_id = c.id
        WHERE COALESCE(NULLIF(c.name_en,''), c.name_ja) IS NOT NULL
        GROUP BY name
        ORDER BY cnt DESC;
    """)
    count = db.execute("SELECT COUNT(*) FROM tag_count").fetchone()[0]
    print(f"  \u2713 tag_count: {count} tags")

    print("  Building series_count...")
    db.executescript("""
        CREATE TABLE series_count (name TEXT PRIMARY KEY, cnt INTEGER);
        INSERT INTO series_count
        SELECT series_text AS name, COUNT(*) AS cnt
        FROM video_search
        WHERE series_text IS NOT NULL AND series_text != ''
        GROUP BY series_text
        ORDER BY cnt DESC;
    """)
    count = db.execute("SELECT COUNT(*) FROM series_count").fetchone()[0]
    print(f"  \u2713 series_count: {count} series")

    print("  Building cast_count...")
    db.executescript("""
        CREATE TABLE cast_count (name TEXT PRIMARY KEY, cnt INTEGER);
        INSERT INTO cast_count
        SELECT COALESCE(a.name_romaji, a.name_kanji, a.name_kana) AS name, COUNT(DISTINCT va.content_id) AS cnt
        FROM video_actress va
        JOIN actress a ON va.actress_id = a.id
        WHERE COALESCE(a.name_romaji, a.name_kanji, a.name_kana) IS NOT NULL
        GROUP BY name
        ORDER BY cnt DESC;
    """)
    count = db.execute("SELECT COUNT(*) FROM cast_count").fetchone()[0]
    print(f"  \u2713 cast_count: {count} names")

    print("  Building maker_count...")
    db.executescript("""
        CREATE TABLE maker_count (name TEXT PRIMARY KEY, cnt INTEGER);
        INSERT INTO maker_count
        SELECT maker AS name, COUNT(*) AS cnt
        FROM video_search
        WHERE maker IS NOT NULL AND maker != ''
        GROUP BY maker
        ORDER BY cnt DESC;
    """)
    count = db.execute("SELECT COUNT(*) FROM maker_count").fetchone()[0]
    print(f"  \u2713 maker_count: {count} makers")

    print("  Building stats...")
    db.executescript("""
        CREATE TABLE stats (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO stats VALUES ('total_videos', (SELECT COUNT(*) FROM video_search));
        INSERT INTO stats VALUES ('total_with_sample', (SELECT COUNT(*) FROM video_search WHERE sample_url IS NOT NULL));
        INSERT INTO stats VALUES ('newest_date', (SELECT MAX(release_date) FROM video_search));
        INSERT INTO stats VALUES ('oldest_date', (SELECT MIN(release_date) FROM video_search WHERE release_date IS NOT NULL));
        INSERT INTO stats VALUES ('recent_count', (SELECT COUNT(*) FROM video_search WHERE release_date >= date('now', '-90 days')));
    """)
    print("  \u2713 stats table built\n")


# ── Phase 5: Cleanup ──────────────────────────────────────────

def finalize_db(db):
    print("=== Phase 5: Cleanup & optimize ===\n")

    print("  Creating video_search indexes...")
    db.execute("CREATE INDEX idx_vs_release ON video_search(release_date DESC)")
    db.execute("CREATE INDEX idx_vs_dvd ON video_search(dvd_id)")
    db.execute("CREATE INDEX idx_vs_series ON video_search(series_text)")
    db.execute("CREATE INDEX idx_vs_maker ON video_search(maker)")
    db.commit()
    print("  \u2713 Indexes created")

    print("  Dropping intermediate tables...")
    for t in ["video", "video_dedup", "video_actress", "video_category",
              "video_director", "trailer", "_cast_agg", "_tags_agg", "_dir_agg"]:
        db.execute(f"DROP TABLE IF EXISTS {t}")
    db.commit()
    print("  \u2713 Dropped raw/intermediate tables")

    print("  Running VACUUM...")
    db.execute("VACUUM")
    print("  \u2713 VACUUM complete")

    size_mb = os.path.getsize(DB_FILE) / 1024 / 1024
    print(f"\n  Output: {DB_FILE}")
    print(f"  Size: {size_mb:.1f} MB\n")


# ── Main ───────────────────────────────────────────────────────

def main():
    t0 = time.time()
    print("R18.dev PG \u2192 SQLite Converter (Python)\n")
    print(f"Input:  {dump_path}")
    print(f"Output: {DB_FILE}\n")

    # Remove existing DB
    if os.path.exists(DB_FILE):
        os.remove(DB_FILE)

    db = sqlite3.connect(DB_FILE)
    db.execute("PRAGMA journal_mode = OFF")
    db.execute("PRAGMA synchronous = OFF")
    db.execute("PRAGMA cache_size = -2000000")
    db.execute("PRAGMA temp_store = MEMORY")
    db.executescript(SCHEMA)

    import_dump(db)
    create_indexes(db)
    denormalize(db)
    build_aux_tables(db)
    finalize_db(db)

    elapsed = time.time() - t0
    print(f"=== Done in {elapsed:.1f}s ===")
    db.close()


if __name__ == "__main__":
    main()
