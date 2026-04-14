#!/bin/bash
# Mac/Linux setup script

echo ""
echo "  r18-dumps-explorer setup"
echo "  ========================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "  [x] Node.js not found"
    echo "      Download it from https://nodejs.org/ (v18 or later)"
    echo ""
    exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
    echo "  [x] Node.js v$NODE_VER found — v18 or later required"
    echo "      Download it from https://nodejs.org/"
    echo ""
    exit 1
fi
echo "  [ok] Node.js $(node -v)"

# Check/install better-sqlite3
if npm list -g better-sqlite3 &>/dev/null; then
    echo "  [ok] better-sqlite3 already installed"
else
    echo "  [ ] Installing better-sqlite3..."
    npm install -g better-sqlite3 --silent 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "  [ok] better-sqlite3 installed"
    else
        echo "  [x] Failed to install better-sqlite3"
        echo "      Try running: sudo npm install -g better-sqlite3"
        echo ""
        exit 1
    fi
fi

# Check for .sql.gz dump
DUMP=$(ls -t *.sql.gz 2>/dev/null | head -1)
if [ -z "$DUMP" ]; then
    echo ""
    echo "  [!] No .sql.gz dump found in this folder"
    echo "      Download one from https://r18.dev/dumps"
    echo "      Place it in this folder and run setup again"
    echo ""
    exit 0
fi
echo "  [ok] Found dump: $DUMP"

# Check if .db already exists
DB_FILE="r18_data.db"
if [ -f "$DB_FILE" ]; then
    echo ""
    read -p "  r18_data.db already exists. Rebuild? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo ""
        echo "  Done. Open r18_viewer.html in your browser and drop r18_data.db onto it."
        echo ""
        exit 0
    fi
fi

# Run converter
echo ""
echo "  Converting $DUMP to SQLite..."
echo ""
node convert_pg_to_sqlite.js

if [ $? -eq 0 ]; then
    echo ""
    echo "  Setup complete!"
    echo "  Open r18_viewer.html in your browser and drop r18_data.db onto it."
    echo ""
else
    echo ""
    echo "  [x] Conversion failed. Check the error above."
    echo ""
    exit 1
fi
