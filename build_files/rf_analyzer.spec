# rf_analyzer.spec
# PyInstaller spec file for RF Analyzer
# Run with: pyinstaller rf_analyzer.spec

import os
from PyInstaller.utils.hooks import collect_all, collect_submodules

# Collect hidden imports for tricky packages
fastapi_imports   = collect_submodules('fastapi')
uvicorn_imports   = collect_submodules('uvicorn')
pydantic_imports  = collect_submodules('pydantic')
scipy_imports     = collect_submodules('scipy')
numpy_imports     = collect_submodules('numpy')
anyio_imports     = collect_submodules('anyio')
starlette_imports = collect_submodules('starlette')

all_hidden = (
    fastapi_imports +
    uvicorn_imports +
    pydantic_imports +
    scipy_imports +
    numpy_imports +
    anyio_imports +
    starlette_imports +
    [
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        'email.mime.text',
        'email.mime.multipart',
        'multipart',
        'python_multipart',
        'h11',
        'httptools',
        'watchfiles',
    ]
)

# Data files to bundle:
# 1. The built React frontend (frontend/dist)
# 2. The Python backend source files (IQ_Viewer/)
datas = [
    ('frontend/dist',  'frontend/dist'),   # built React app
    ('IQ_Viewer',      'IQ_Viewer'),        # backend Python modules
]

a = Analysis(
    ['launcher.py'],
    pathex=['.', 'IQ_Viewer'],
    binaries=[],
    datas=datas,
    hiddenimports=all_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter', 'matplotlib', 'PIL', 'PyQt5', 'PyQt6',
        'wx', 'gtk', 'IPython', 'jupyter',
    ],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='RF_Analyzer',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,        # shows a console window (useful so users can see errors/close it)
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,           # set to 'icon.ico' if you add one later
)
