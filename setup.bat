@echo off
:: Windows setup script
setlocal enabledelayedexpansion
cd /d "%~dp0"
echo.
echo   r18-dumps-explorer setup
echo   ========================
echo.

:: Check Node.js
where node >nul 2>nul
if !errorlevel! neq 0 (
    echo   [x] Node.js not found
    echo       Download it from https://nodejs.org/ ^(v18 or later^)
    echo.
    pause
    exit /b 1
)

node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)"
if !errorlevel! neq 0 (
    echo   [x] Node.js too old — v18 or later required
    echo       Download it from https://nodejs.org/
    echo.
    pause
    exit /b 1
)
for /f %%v in ('node -v') do echo   [ok] Node.js %%v

:: Check/install better-sqlite3 locally in this folder
if exist node_modules\better-sqlite3 (
    echo   [ok] better-sqlite3 already installed
    goto :check_dump
)
node -e "require.resolve('better-sqlite3'); process.exit(0)" >nul 2>nul
if !errorlevel! equ 0 (
    echo   [ok] better-sqlite3 already available
    goto :check_dump
)
goto :install_sqlite

:install_sqlite
echo   [ ] Installing better-sqlite3 in this folder...
call npm install better-sqlite3 --no-save
if !errorlevel! neq 0 (
    echo   [x] Failed to install better-sqlite3
    echo       Try running this in the same folder:
    echo         npm install better-sqlite3 --no-save
    echo       If that still fails, install Visual Studio Build Tools
    echo.
    pause
    exit /b 1
)
echo   [ok] better-sqlite3 installed

:check_dump
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
echo   [ok] Found dump: !DUMP!

:: Check if .db already exists
if exist r18_data.db (
    echo.
    set /p REBUILD="  r18_data.db already exists. Rebuild? (y/n) "
    if /i not "!REBUILD!"=="y" (
        echo.
        echo   Done. Open r18_viewer.html in your browser and drop r18_data.db onto it.
        echo.
        pause
        exit /b 0
    )
)

:: Run converter
echo.
echo   Converting !DUMP! to SQLite...
echo.
node convert_pg_to_sqlite.js

if !errorlevel! neq 0 (
    echo.
    echo   [x] Conversion failed. Check the error above.
    echo.
    pause
    exit /b 1
)

echo.
echo   Setup complete!
echo   Open r18_viewer.html in your browser and drop r18_data.db onto it.
echo.
pause
