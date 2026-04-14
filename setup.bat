@echo off
echo.
echo   r18-dumps-explorer setup
echo   ========================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo   [x] Node.js not found
    echo       Download it from https://nodejs.org/ ^(v18 or later^)
    echo.
    pause
    exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
for /f "tokens=2 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)"
if %errorlevel% neq 0 (
    echo   [x] Node.js too old — v18 or later required
    echo       Download it from https://nodejs.org/
    echo.
    pause
    exit /b 1
)
for /f %%v in ('node -v') do echo   [ok] Node.js %%v

:: Check/install better-sqlite3
node -e "require('better-sqlite3')" 2>nul
if %errorlevel% equ 0 (
    echo   [ok] better-sqlite3 already installed
) else (
    echo   [ ] Installing better-sqlite3...
    npm install -g better-sqlite3 >nul 2>nul
    if %errorlevel% equ 0 (
        echo   [ok] better-sqlite3 installed
    ) else (
        echo   [x] Failed to install better-sqlite3
        echo       Try running: npm install -g better-sqlite3
        echo.
        pause
        exit /b 1
    )
)

:: Check for .sql.gz dump
set "DUMP="
for /f "delims=" %%f in ('dir /b /o-d *.sql.gz 2^>nul') do (
    if not defined DUMP set "DUMP=%%f"
)
if not defined DUMP (
    echo.
    echo   [!] No .sql.gz dump found in this folder
    echo       Download one from https://r18.dev/dumps
    echo       Place it in this folder and run setup again
    echo.
    pause
    exit /b 0
)
echo   [ok] Found dump: %DUMP%

:: Check if .db already exists
if exist r18_data.db (
    echo.
    set /p REBUILD="  r18_data.db already exists. Rebuild? (y/n) "
    if /i not "%REBUILD%"=="y" (
        echo.
        echo   Done. Open r18_viewer.html in your browser and drop r18_data.db onto it.
        echo.
        pause
        exit /b 0
    )
)

:: Run converter
echo.
echo   Converting %DUMP% to SQLite...
echo.
node convert_pg_to_sqlite.js

if %errorlevel% equ 0 (
    echo.
    echo   Setup complete!
    echo   Open r18_viewer.html in your browser and drop r18_data.db onto it.
) else (
    echo.
    echo   [x] Conversion failed. Check the error above.
)
echo.
pause
