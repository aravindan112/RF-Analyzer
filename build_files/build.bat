@echo off
REM ============================================================
REM  RF Analyzer - One-click build script
REM  Run this once from inside your iq_visual_analyzer folder
REM  Output: dist\RF_Analyzer.exe
REM ============================================================

echo.
echo ========================================
echo  RF Analyzer - Build Script
echo ========================================
echo.

REM ── Step 1: Install Python dependencies ──────────────────────
echo [1/4] Installing Python dependencies...
pip install pyinstaller fastapi uvicorn[standard] numpy scipy pydantic python-multipart h11 anyio starlette
if errorlevel 1 (
    echo ERROR: pip install failed. Make sure Python is in your PATH.
    pause
    exit /b 1
)
echo Done.
echo.

REM ── Step 2: Build React frontend ─────────────────────────────
echo [2/4] Building React frontend...
cd frontend
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed. Make sure Node.js is installed.
    pause
    exit /b 1
)
call npm run build
if errorlevel 1 (
    echo ERROR: npm build failed.
    pause
    exit /b 1
)
cd ..
echo Done.
echo.

REM ── Step 3: Copy build files to project root ─────────────────
echo [3/4] Preparing files for PyInstaller...
copy /Y build_files\launcher.py launcher.py
copy /Y build_files\rf_analyzer.spec rf_analyzer.spec
echo Done.
echo.

REM ── Step 4: Run PyInstaller ───────────────────────────────────
echo [4/4] Building .exe with PyInstaller (this takes 1-3 minutes)...
pyinstaller rf_analyzer.spec --clean
if errorlevel 1 (
    echo ERROR: PyInstaller failed. See output above for details.
    pause
    exit /b 1
)

echo.
echo ========================================
echo  BUILD COMPLETE!
echo  Your .exe is at: dist\RF_Analyzer.exe
echo  Share just that single file with colleagues.
echo  They do NOT need Python or Node installed.
echo ========================================
echo.
pause
