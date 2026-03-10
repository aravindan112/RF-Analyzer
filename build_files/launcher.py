"""
RF Analyzer - Launcher
Entry point for the packaged .exe
"""
import os
import sys
import time
import threading
import webbrowser

# ── Fix paths for PyInstaller bundle ─────────────────────────────────────
if getattr(sys, 'frozen', False):
    # Running as PyInstaller .exe — all files are in _MEIPASS
    BASE_DIR = sys._MEIPASS
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Add IQ_Viewer to path
IQ_VIEWER_DIR = os.path.join(BASE_DIR, 'IQ_Viewer')
sys.path.insert(0, IQ_VIEWER_DIR)
sys.path.insert(0, BASE_DIR)

print(f"BASE_DIR: {BASE_DIR}")
print(f"IQ_VIEWER_DIR: {IQ_VIEWER_DIR}")
print(f"IQ_Viewer exists: {os.path.exists(IQ_VIEWER_DIR)}")
print(f"Contents: {os.listdir(BASE_DIR) if os.path.exists(BASE_DIR) else 'N/A'}")

PORT = 8000
HOST = "127.0.0.1"
URL  = f"http://{HOST}:{PORT}"


def open_browser():
    time.sleep(3.0)
    webbrowser.open(URL)


def main():
    try:
        import uvicorn
        print(f"uvicorn imported OK")
    except Exception as e:
        print(f"ERROR importing uvicorn: {e}")
        input("Press Enter to exit...")
        return

    try:
        # Import the app to verify it loads correctly
        import main_api
        print(f"main_api imported OK")
    except Exception as e:
        print(f"ERROR importing main_api: {e}")
        import traceback
        traceback.print_exc()
        input("Press Enter to exit...")
        return

    t = threading.Thread(target=open_browser, daemon=True)
    t.start()

    print(f"\nRF Analyzer running at {URL}")
    print("Close this window to stop.\n")

    uvicorn.run(
        "main_api:app",
        host=HOST,
        port=PORT,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
