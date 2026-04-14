#!/usr/bin/env node
// ============================================================
//  PG Dump → SQLite converter for r18.dev database
//  Usage: node convert_pg_to_sqlite.js
//  Input:  r18dotdev_dump_2026-03-31.sql (same directory)
//  Output: r18_data.db (optimized SQLite for the viewer)
// ============================================================

const fs = require('fs');
const path = require('path');
const readline = require('readline');

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  try {
    // Fallback: resolve from global install path
    const globalRoot = require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
    Database = require(require('path').join(globalRoot, 'better-sqlite3'));
  } catch {
    console.error('better-sqlite3 not found. Install it:\n  npm install better-sqlite3');
    process.exit(1);
  }
}

const DIR = __dirname;
const DB_FILE = path.join(DIR, 'r18_data.db');

// Auto-detect the newest r18 SQL dump (or .sql.gz to decompress)
function findSqlDump() {
  const files = fs.readdirSync(DIR);
  // Check for .sql files first
  const sqlFiles = files.filter(f => /^r18dotdev_dump.*\.sql$/.test(f)).sort().reverse();
  if (sqlFiles.length) return path.join(DIR, sqlFiles[0]);
  // Check for .sql.gz and auto-decompress
  const gzFiles = files.filter(f => /^r18dotdev_dump.*\.sql\.gz$/.test(f)).sort().reverse();
  if (gzFiles.length) {
    const gz = path.join(DIR, gzFiles[0]);
    const sql = gz.replace(/\.gz$/, '');
    console.log('Decompressing ' + gzFiles[0] + '...');
    const zlib = require('zlib');
    const gzData = fs.readFileSync(gz);
    fs.writeFileSync(sql, zlib.gunzipSync(gzData));
    console.log('  Decompressed to ' + path.basename(sql));
    return sql;
  }
  return null;
}

const SQL_FILE = findSqlDump();
if (!SQL_FILE) {
  console.error('No r18dotdev_dump*.sql or .sql.gz found in:', DIR);
  process.exit(1);
}

// Remove existing DB
if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);

const db = new Database(DB_FILE);
db.pragma('journal_mode = OFF');
db.pragma('synchronous = OFF');
db.pragma('cache_size = -2000000'); // 2GB cache
db.pragma('temp_store = MEMORY');

// ── Schema ──────────────────────────────────────────────────

db.exec(`
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
`);

// ── PG COPY parser ──────────────────────────────────────────

// Map PG table names → { sqlite table, columns, insert statement }
const TABLE_MAP = {
  'derived_video': {
    table: 'video',
    cols: ['content_id','dvd_id','title_en','title_ja','comment_en','comment_ja','runtime_mins','release_date','sample_url','maker_id','label_id','series_id','jacket_full_url','jacket_thumb_url','gallery_full_first','gallery_full_last','gallery_thumb_first','gallery_thumb_last','site_id','service_code'],
    pick: [0,1,2,3,6,7,8,9,10,11,12,13,14,15,18,19], // indices into cols we keep
    sqliteCols: ['content_id','dvd_id','title_en','title_ja','runtime_mins','release_date','sample_url','maker_id','label_id','series_id','jacket_full_url','jacket_thumb_url','gallery_full_first','gallery_full_last','site_id','service_code'],
  },
  'derived_actress': {
    table: 'actress',
    cols: ['id','name_romaji','image_url','name_kanji','name_kana'],
    pick: [0,1,3,4],
    sqliteCols: ['id','name_romaji','name_kanji','name_kana'],
  },
  'derived_video_actress': {
    table: 'video_actress',
    cols: ['content_id','actress_id','ordinality','release_date'],
    pick: [0,1,2],
    sqliteCols: ['content_id','actress_id','ordinality'],
  },
  'derived_category': {
    table: 'category',
    cols: ['id','name_en','name_ja'],
    pick: [0,1,2],
    sqliteCols: ['id','name_en','name_ja'],
  },
  'derived_video_category': {
    table: 'video_category',
    cols: ['content_id','category_id','release_date'],
    pick: [0,1],
    sqliteCols: ['content_id','category_id'],
  },
  'derived_maker': {
    table: 'maker',
    cols: ['id','name_en','name_ja'],
    pick: [0,1,2],
    sqliteCols: ['id','name_en','name_ja'],
  },
  'derived_label': {
    table: 'label',
    cols: ['id','name_en','name_ja'],
    pick: [0,1,2],
    sqliteCols: ['id','name_en','name_ja'],
  },
  'derived_series': {
    table: 'series',
    cols: ['id','name_en','name_ja'],
    pick: [0,1,2],
    sqliteCols: ['id','name_en','name_ja'],
  },
  'derived_director': {
    table: 'director',
    cols: ['id','name_kanji','name_kana','name_romaji'],
    pick: [0,1,2,3],
    sqliteCols: ['id','name_kanji','name_kana','name_romaji'],
  },
  'derived_video_director': {
    table: 'video_director',
    cols: ['content_id','director_id'],
    pick: [0,1],
    sqliteCols: ['content_id','director_id'],
  },
  'source_dmm_trailer': {
    table: 'trailer',
    cols: ['content_id','url','timestamp'],
    pick: [0,1],
    sqliteCols: ['content_id','url'],
  },
};

// Prepare INSERT statements
const stmts = {};
for (const [pgName, spec] of Object.entries(TABLE_MAP)) {
  const placeholders = spec.sqliteCols.map(() => '?').join(',');
  stmts[pgName] = db.prepare(
    `INSERT OR IGNORE INTO ${spec.table} (${spec.sqliteCols.join(',')}) VALUES (${placeholders})`
  );
}

function unescapePgField(field) {
  if (field === '\\N') return null;
  // PG COPY escapes: \\ → \, \n → newline, \t → tab, \r → CR
  let result = '';
  for (let i = 0; i < field.length; i++) {
    if (field[i] === '\\' && i + 1 < field.length) {
      const next = field[i + 1];
      if (next === '\\') { result += '\\'; i++; }
      else if (next === 'n') { result += '\n'; i++; }
      else if (next === 't') { result += '\t'; i++; }
      else if (next === 'r') { result += '\r'; i++; }
      else { result += field[i]; }
    } else {
      result += field[i];
    }
  }
  return result;
}

async function importDump() {
  console.log('=== Phase 1: Importing PG dump into SQLite ===\n');

  const fileStream = fs.createReadStream(SQL_FILE, { encoding: 'utf8', highWaterMark: 64 * 1024 });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let currentTable = null;
  let currentSpec = null;
  let rowCount = 0;
  let totalRows = 0;
  let batchCount = 0;
  const BATCH_SIZE = 10000;
  const tableCounts = {};
  let inTransaction = false;

  function beginTx() {
    if (!inTransaction) { db.exec('BEGIN'); inTransaction = true; }
  }
  function commitTx() {
    if (inTransaction) { db.exec('COMMIT'); inTransaction = false; }
  }

  for await (const line of rl) {
    if (currentTable) {
      // In COPY mode
      if (line === '\\.') {
        // End of COPY block
        commitTx();
        tableCounts[currentTable] = rowCount;
        console.log(`  ✓ ${currentSpec.table}: ${rowCount.toLocaleString()} rows`);
        totalRows += rowCount;
        currentTable = null;
        currentSpec = null;
        rowCount = 0;
        batchCount = 0;
        continue;
      }

      // Parse tab-delimited row
      const fields = line.split('\t');
      const values = currentSpec.pick.map(i => unescapePgField(fields[i]));
      try {
        stmts[currentTable].run(...values);
      } catch (e) {
        // Skip duplicate rows silently
        if (!e.message.includes('UNIQUE')) {
          console.warn(`  Warning: ${currentSpec.table} row error: ${e.message}`);
        }
      }
      rowCount++;
      batchCount++;

      if (batchCount >= BATCH_SIZE) {
        commitTx();
        beginTx();
        batchCount = 0;
      }
      continue;
    }

    // Look for COPY statements
    const match = line.match(/^COPY public\.(\w+)\s/);
    if (match && TABLE_MAP[match[1]]) {
      currentTable = match[1];
      currentSpec = TABLE_MAP[match[1]];
      rowCount = 0;
      batchCount = 0;
      console.log(`  Importing ${currentSpec.table}...`);
      beginTx();
    }
  }

  // Commit any remaining transaction
  commitTx();

  console.log(`\nTotal imported: ${totalRows.toLocaleString()} rows\n`);
}

function createIndexes() {
  console.log('=== Phase 2: Creating indexes ===\n');

  const indexes = [
    'CREATE INDEX idx_video_content ON video(content_id)',
    'CREATE INDEX idx_video_service ON video(content_id, service_code)',
    'CREATE INDEX idx_va_content ON video_actress(content_id)',
    'CREATE INDEX idx_va_actress ON video_actress(actress_id)',
    'CREATE INDEX idx_vc_content ON video_category(content_id)',
    'CREATE INDEX idx_vc_category ON video_category(category_id)',
    'CREATE INDEX idx_vd_content ON video_director(content_id)',
    'CREATE INDEX idx_vd_director ON video_director(director_id)',
  ];

  for (const sql of indexes) {
    const name = sql.match(/idx_\w+/)[0];
    process.stdout.write(`  ${name}...`);
    db.exec(sql);
    console.log(' ✓');
  }
  console.log();
}

function denormalize() {
  console.log('=== Phase 3: Building denormalized video_search table ===\n');

  // Step 1: Deduplicate videos — prefer digital > mono > rental > nikkatsu > ebook
  console.log('  Deduplicating videos...');
  db.exec(`
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
    ) WHERE rn = 1
  `);
  const dedupCount = db.prepare('SELECT COUNT(*) as c FROM video_dedup').get().c;
  console.log(`  ✓ ${dedupCount.toLocaleString()} unique videos after dedup\n`);

  // Step 2: Pre-aggregate cast per video
  console.log('  Aggregating cast...');
  db.exec(`
    CREATE TABLE _cast_agg AS
    SELECT va.content_id,
      GROUP_CONCAT(COALESCE(a.name_romaji, a.name_kanji, a.name_kana), ', ') AS cast_text
    FROM video_actress va
    JOIN actress a ON va.actress_id = a.id
    WHERE COALESCE(a.name_romaji, a.name_kanji, a.name_kana) IS NOT NULL
    GROUP BY va.content_id
  `);
  console.log('  ✓ Cast aggregated');

  // Step 3: Pre-aggregate tags per video
  console.log('  Aggregating tags...');
  db.exec(`
    CREATE TABLE _tags_agg AS
    SELECT vc.content_id,
      GROUP_CONCAT(COALESCE(c.name_en, c.name_ja), ', ') AS tags_text
    FROM video_category vc
    JOIN category c ON vc.category_id = c.id
    WHERE COALESCE(c.name_en, c.name_ja) IS NOT NULL
    GROUP BY vc.content_id
  `);
  console.log('  ✓ Tags aggregated');

  // Step 4: Pre-aggregate directors per video
  console.log('  Aggregating directors...');
  db.exec(`
    CREATE TABLE _dir_agg AS
    SELECT vd.content_id,
      GROUP_CONCAT(COALESCE(d.name_romaji, d.name_kanji, d.name_kana), ', ') AS director_text
    FROM video_director vd
    JOIN director d ON vd.director_id = d.id
    WHERE COALESCE(d.name_romaji, d.name_kanji, d.name_kana) IS NOT NULL
    GROUP BY vd.content_id
  `);
  console.log('  ✓ Directors aggregated');

  // Step 5: Create the denormalized table
  console.log('  Building video_search...');
  db.exec(`
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
    )
  `);

  db.exec(`
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
    LEFT JOIN _dir_agg da ON v.content_id = da.content_id
  `);

  const searchCount = db.prepare('SELECT COUNT(*) as c FROM video_search').get().c;
  console.log(`  ✓ video_search: ${searchCount.toLocaleString()} rows\n`);
}

function buildAuxTables() {
  console.log('=== Phase 4: Building auxiliary tables ===\n');

  // Tag counts
  console.log('  Building tag_count...');
  db.exec(`
    CREATE TABLE tag_count (name TEXT PRIMARY KEY, cnt INTEGER);
    INSERT INTO tag_count
    SELECT COALESCE(NULLIF(c.name_en,''), c.name_ja) AS name, COUNT(DISTINCT vc.content_id) AS cnt
    FROM video_category vc
    JOIN category c ON vc.category_id = c.id
    WHERE COALESCE(NULLIF(c.name_en,''), c.name_ja) IS NOT NULL
    GROUP BY name
    ORDER BY cnt DESC
  `);
  const tagCount = db.prepare('SELECT COUNT(*) as c FROM tag_count').get().c;
  console.log(`  ✓ tag_count: ${tagCount} tags`);

  // Series counts
  console.log('  Building series_count...');
  db.exec(`
    CREATE TABLE series_count (name TEXT PRIMARY KEY, cnt INTEGER);
    INSERT INTO series_count
    SELECT series_text AS name, COUNT(*) AS cnt
    FROM video_search
    WHERE series_text IS NOT NULL AND series_text != ''
    GROUP BY series_text
    ORDER BY cnt DESC
  `);
  const seriesCount = db.prepare('SELECT COUNT(*) as c FROM series_count').get().c;
  console.log(`  ✓ series_count: ${seriesCount} series`);

  // Cast counts for autocomplete (uses video_actress + actress before they're dropped)
  console.log('  Building cast_count...');
  db.exec(`
    CREATE TABLE cast_count (name TEXT PRIMARY KEY, cnt INTEGER);
    INSERT INTO cast_count
    SELECT COALESCE(a.name_romaji, a.name_kanji, a.name_kana) AS name, COUNT(DISTINCT va.content_id) AS cnt
    FROM video_actress va
    JOIN actress a ON va.actress_id = a.id
    WHERE COALESCE(a.name_romaji, a.name_kanji, a.name_kana) IS NOT NULL
    GROUP BY name
    ORDER BY cnt DESC
  `);
  const castCount = db.prepare('SELECT COUNT(*) as c FROM cast_count').get().c;
  console.log(`  ✓ cast_count: ${castCount} names`);

  // Maker counts for potential filtering
  console.log('  Building maker_count...');
  db.exec(`
    CREATE TABLE maker_count (name TEXT PRIMARY KEY, cnt INTEGER);
    INSERT INTO maker_count
    SELECT maker AS name, COUNT(*) AS cnt
    FROM video_search
    WHERE maker IS NOT NULL AND maker != ''
    GROUP BY maker
    ORDER BY cnt DESC
  `);
  const makerCount = db.prepare('SELECT COUNT(*) as c FROM maker_count').get().c;
  console.log(`  ✓ maker_count: ${makerCount} makers`);

  // Stats table for the viewer header
  console.log('  Building stats...');
  db.exec(`
    CREATE TABLE stats (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO stats VALUES ('total_videos', (SELECT COUNT(*) FROM video_search));
    INSERT INTO stats VALUES ('total_with_sample', (SELECT COUNT(*) FROM video_search WHERE sample_url IS NOT NULL));
    INSERT INTO stats VALUES ('newest_date', (SELECT MAX(release_date) FROM video_search));
    INSERT INTO stats VALUES ('oldest_date', (SELECT MIN(release_date) FROM video_search WHERE release_date IS NOT NULL));
    INSERT INTO stats VALUES ('recent_count', (SELECT COUNT(*) FROM video_search WHERE release_date >= date('now', '-90 days')));
  `);
  console.log('  ✓ stats table built\n');
}

function finalizeDb() {
  console.log('=== Phase 5: Cleanup & optimize ===\n');

  // Create indexes on video_search
  console.log('  Creating video_search indexes...');
  db.exec(`
    CREATE INDEX idx_vs_release ON video_search(release_date DESC);
    CREATE INDEX idx_vs_dvd ON video_search(dvd_id);
    CREATE INDEX idx_vs_series ON video_search(series_text);
    CREATE INDEX idx_vs_maker ON video_search(maker);
  `);
  console.log('  ✓ Indexes created');

  // Drop intermediate and raw tables
  console.log('  Dropping intermediate tables...');
  const dropTables = [
    'video', 'video_dedup', 'video_actress', 'video_category', 'video_director',
    'trailer', '_cast_agg', '_tags_agg', '_dir_agg'
  ];
  for (const t of dropTables) {
    db.exec(`DROP TABLE IF EXISTS ${t}`);
  }
  console.log('  ✓ Dropped raw/intermediate tables');

  // Keep: video_search, actress, category, maker, label, series, director,
  //        tag_count, series_count, cast_index, maker_count, stats

  console.log('  Running VACUUM...');
  db.exec('VACUUM');
  console.log('  ✓ VACUUM complete');

  const dbSize = fs.statSync(DB_FILE).size;
  console.log(`\n  Output: ${DB_FILE}`);
  console.log(`  Size: ${(dbSize / 1024 / 1024).toFixed(1)} MB\n`);
}

async function main() {
  const t0 = Date.now();
  console.log('R18.dev PG → SQLite Converter\n');
  console.log(`Input:  ${SQL_FILE}`);
  console.log(`Output: ${DB_FILE}\n`);

  await importDump();
  createIndexes();
  denormalize();
  buildAuxTables();
  finalizeDb();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`=== Done in ${elapsed}s ===`);
  db.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  db.close();
  process.exit(1);
});
