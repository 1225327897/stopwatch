# -*- mode: python ; coding: utf-8 -*-
a = Analysis(
    ['stopwatch.py'],
    pathex=[],
    binaries=[],
    datas=[('stopwatch.html','.'),('stopwatch.css','.'),('stopwatch.js','.'),
           ('login.html','.'),('login.css','.'),('login.js','.'),('clock.html','.'),
           ('投喂作者.jpg','.')],
    hiddenimports=['webview.platforms.edgechromium'],
    hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=[], noarchive=False, optimize=0,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, a.binaries + a.datas,  # bundle data into EXE
    exclude_binaries=False,
    name='须臾', debug=False, bootloader_ignore_signals=False,
    strip=False, upx=True, upx_exclude=[], runtime_tmpdir=None,
    console=False, disable_windowed_traceback=False, argv_emulation=False,
    target_arch=None, codesign_identity=None, entitlements_file=None,
    icon='../assets/icon.ico',
)
