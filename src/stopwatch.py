#!/usr/bin/env python3
"""须臾 — Desktop Edition"""

import os, sys, json, sqlite3, webview, threading, hashlib, uuid, secrets
from http.server import HTTPServer, SimpleHTTPRequestHandler

APP_TITLE = "须臾"
APP_WIDTH, APP_HEIGHT = 1200, 800

ASSETS_DIR = os.path.dirname(os.path.abspath(__file__))

if getattr(sys, 'frozen', False):
    DB_DIR = os.path.join(os.path.dirname(sys.executable), 'data')
else:
    DB_DIR = os.path.join(os.path.dirname(ASSETS_DIR), 'data')
os.makedirs(DB_DIR, exist_ok=True)
DB_PATH = os.path.join(DB_DIR, 'stopwatch.db')
MUSIC_DIR = os.path.join(DB_DIR, 'music')

# ── Crypto helpers ──────────────────────────
def hash_pw(pw, salt=None):
    if salt is None: salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), 100000)
    return salt + ':' + h.hex()

def verify_pw(pw, stored):
    salt, h = stored.split(':')
    return hash_pw(pw, salt) == stored

# ── Music storage helpers ───────────────────
def _ensure_music_table():
    c = sqlite3.connect(DB_PATH)
    c.execute('''CREATE TABLE IF NOT EXISTS music (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, filename TEXT,
        created_at TEXT DEFAULT (datetime('now')))''')
    c.commit(); c.close()

def _save_music_file(src_path, name):
    import shutil
    _ensure_music_table()
    os.makedirs(MUSIC_DIR, exist_ok=True)
    ext = os.path.splitext(src_path)[1].lower()
    filename = hashlib.md5(src_path.encode('utf-8')).hexdigest() + ext
    dest = os.path.join(MUSIC_DIR, filename)
    c = sqlite3.connect(DB_PATH)
    existing = c.execute('SELECT id FROM music WHERE filename=?', (filename,)).fetchone()
    if existing:
        c.execute('UPDATE music SET name=? WHERE id=?', (name, existing[0]))
        song_id = existing[0]
        c.commit(); c.close()
        return {'id': song_id, 'name': name, 'source': 'disk'}
    shutil.copy2(src_path, dest)
    c.execute('INSERT INTO music (name,filename) VALUES (?,?)', (name, filename))
    song_id = c.lastrowid
    c.commit(); c.close()
    return {'id': song_id, 'name': name, 'source': 'disk'}

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute('''CREATE TABLE IF NOT EXISTS presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, icon TEXT DEFAULT '⏰',
        minutes INTEGER NOT NULL, created_at TEXT DEFAULT (datetime('now')))''')
    conn.execute('''CREATE TABLE IF NOT EXISTS pomodoro_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, preset_name TEXT, minutes INTEGER,
        started_at TEXT DEFAULT (datetime('now')), completed INTEGER DEFAULT 0)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS countdown (
        id INTEGER PRIMARY KEY CHECK(id=1), label TEXT DEFAULT '新年', target_date TEXT,
        updated_at TEXT DEFAULT (datetime('now')))''')
    conn.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))''')
    conn.execute('''CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, user_id INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')))''')
    if conn.execute('SELECT COUNT(*) FROM presets').fetchone()[0] == 0:
        conn.executemany('INSERT INTO presets (name,icon,minutes) VALUES (?,?,?)', [
            ('🍅 专注工作','🍅',25),('☕ 放松时刻','☕',15),('💻 代码模式','💻',45),
            ('📖 阅读时间','📖',30),('🧘 冥想','🧘',10),('🏃 运动','🏃',20)])
    if conn.execute('SELECT COUNT(*) FROM countdown').fetchone()[0] == 0:
        conn.execute("INSERT INTO countdown (id,label,target_date) VALUES (1,'新年','2027-01-01')")
    _ensure_music_table()
    conn.commit(); conn.close()

# ── HTTP API + Static Server ────────────────
class APIHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=ASSETS_DIR, **kw)
    def log_message(self, *a): pass

    def _check_session(self):
        token = self.headers.get('Authorization','').replace('Bearer ','')
        if not token: return None
        c = sqlite3.connect(DB_PATH)
        r = c.execute('SELECT user_id FROM sessions WHERE token=?',(token,)).fetchone()
        c.close()
        return r[0] if r else None

    def do_POST(self):
        path = self.path.split('?')[0]
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('utf-8') if length else '{}'
        try: data = json.loads(body)
        except: data = {}

        code = 200; result = {}

        # ── AUTH ENDPOINTS ─────────────────
        if path == '/api/register':
            username = data.get('username','').strip()
            password = data.get('password','')
            # Validate username: >=9 chars, must have letters+digits, alphanumeric only
            if len(username) < 9 or not username.replace('_','').isalnum():
                code = 400; result = {'error':'账号需 ≥9 位，仅限字母和数字'}
            elif not any(c.isalpha() for c in username) or not any(c.isdigit() for c in username):
                code = 400; result = {'error':'账号必须同时包含字母和数字'}
            elif len(password) < 7:
                code = 400; result = {'error':'密码需 >6 位'}
            else:
                # Check sequential digits
                seq_found = False
                for i in range(len(password)-2):
                    c1, c2, c3 = ord(password[i]), ord(password[i+1]), ord(password[i+2])
                    if c1+1==c2==c3-1 or c1-1==c2==c3+1:
                        if all(c.isdigit() for c in password[i:i+3]):
                            seq_found = True; break
                if seq_found:
                    code = 400; result = {'error':'密码不允许包含连续数字（如123或432）'}
                else:
                    c = sqlite3.connect(DB_PATH)
                    if c.execute('SELECT id FROM users WHERE username=?',(username,)).fetchone():
                        code = 400; result = {'error':'账号已存在'}
                    else:
                        c.execute('INSERT INTO users (username,password) VALUES (?,?)',
                                  (username, hash_pw(password)))
                        c.commit(); c.close()
                        result = {'ok':True}

        elif path == '/api/login':
            username = data.get('username','').strip()
            password = data.get('password','')
            c = sqlite3.connect(DB_PATH)
            row = c.execute('SELECT id,password FROM users WHERE username=?',(username,)).fetchone()
            if row and verify_pw(password, row[1]):
                token = secrets.token_urlsafe(32)
                c.execute('INSERT OR REPLACE INTO sessions (token,user_id) VALUES (?,?)',(token,row[0]))
                # Check if first login (only one session ever for this user)
                count = c.execute('SELECT COUNT(*) FROM sessions WHERE user_id=?',(row[0],)).fetchone()[0]
                c.commit(); c.close()
                result = {'token':token, 'firstLogin':count <= 1}
            else:
                code = 401; result = {'error':'账号或密码错误'}
                c.close()

        elif path == '/api/logout':
            token = self.headers.get('Authorization','').replace('Bearer ','')
            if token:
                c = sqlite3.connect(DB_PATH)
                c.execute('DELETE FROM sessions WHERE token=?',(token,)); c.commit(); c.close()
            result = {'ok':True}

        elif path == '/api/check_session':
            user_id = self._check_session()
            result = {'loggedIn': user_id is not None}
        elif path == '/api/change_password':
            user_id = self._check_session()
            if not user_id:
                code = 401; result = {'error':'请先登录'}
            else:
                old_pw = data.get('oldPassword','')
                new_pw = data.get('newPassword','')
                if len(new_pw) < 7:
                    code = 400; result = {'error':'新密码需 >6 位'}
                else:
                    c = sqlite3.connect(DB_PATH)
                    row = c.execute('SELECT password FROM users WHERE id=?',(user_id,)).fetchone()
                    if row and verify_pw(old_pw, row[0]):
                        c.execute('UPDATE users SET password=? WHERE id=?',(hash_pw(new_pw), user_id))
                        c.commit(); c.close()
                        result = {'ok':True}
                    else:
                        code = 400; result = {'error':'当前密码错误'}
                        c.close()
        elif path == '/api/save_accounts':
            c = sqlite3.connect(DB_PATH)
            c.execute('CREATE TABLE IF NOT EXISTS account_history (username TEXT PRIMARY KEY, password TEXT)')
            accounts = data.get('accounts', [])
            for a in accounts:
                c.execute('INSERT OR REPLACE INTO account_history (username,password) VALUES (?,?)',
                         (a.get('u',''), a.get('p','')))
            c.commit(); c.close()
            result = {'ok': True}
        elif path == '/api/get_accounts':
            c = sqlite3.connect(DB_PATH)
            c.execute('CREATE TABLE IF NOT EXISTS account_history (username TEXT PRIMARY KEY, password TEXT)')
            rows = c.execute('SELECT username,password FROM account_history ORDER BY username').fetchall()
            c.close()
            result = [{'u': r[0], 'p': r[1]} for r in rows]

        # ── EXISTING ENDPOINTS (no auth needed) ──
        elif path == '/api/save_preset':
            name, icon, mins = data.get('name',''), data.get('icon','⏰'), int(data.get('minutes',25))
            c = sqlite3.connect(DB_PATH)
            if c.execute('SELECT id FROM presets WHERE name=?',(name,)).fetchone():
                c.execute('UPDATE presets SET icon=?,minutes=? WHERE name=?',(icon,mins,name))
            else: c.execute('INSERT INTO presets (name,icon,minutes) VALUES (?,?,?)',(name,icon,mins))
            c.commit(); r = c.execute('SELECT * FROM presets WHERE name=?',(name,)).fetchone(); c.close()
            result = {'id':r[0],'name':r[1],'icon':r[2],'minutes':r[3]}
        elif path == '/api/get_presets':
            c = sqlite3.connect(DB_PATH); rows = c.execute('SELECT * FROM presets ORDER BY id').fetchall(); c.close()
            result = [{'id':r[0],'name':r[1],'icon':r[2],'minutes':r[3]} for r in rows]
        elif path == '/api/delete_preset':
            c = sqlite3.connect(DB_PATH); c.execute('DELETE FROM presets WHERE id=?',(int(data.get('id',0)),)); c.commit(); c.close()
            result = {'ok':True}
        elif path == '/api/record_pomodoro':
            c = sqlite3.connect(DB_PATH)
            c.execute('INSERT INTO pomodoro_history (preset_name,minutes,completed) VALUES (?,?,?)',
                      (data.get('name',''), int(data.get('minutes',0)), 1 if data.get('completed') else 0))
            c.commit(); c.close(); result = {'ok':True}
        elif path == '/api/get_history':
            c = sqlite3.connect(DB_PATH)
            rows = c.execute('SELECT * FROM pomodoro_history ORDER BY id DESC LIMIT ?',(int(data.get('limit',50)),)).fetchall(); c.close()
            result = [{'id':r[0],'preset_name':r[1],'minutes':r[2],'started_at':r[3],'completed':bool(r[4])} for r in rows]
        elif path == '/api/get_stats':
            c = sqlite3.connect(DB_PATH)
            rows = c.execute("SELECT date(started_at) as day, SUM(minutes) as total FROM pomodoro_history WHERE completed=1 AND started_at>=date('now',?) GROUP BY day ORDER BY day",
                           (f'-{int(data.get("days",14))} days',)).fetchall(); c.close()
            result = [{'day':r[0],'minutes':r[1]} for r in rows]
        elif path == '/api/save_countdown':
            c = sqlite3.connect(DB_PATH)
            c.execute('INSERT OR REPLACE INTO countdown (id,label,target_date) VALUES (1,?,?)',
                      (data.get('label','新年'), data.get('date','')))
            c.commit(); r = c.execute('SELECT * FROM countdown WHERE id=1').fetchone(); c.close()
            result = {'label':r[1], 'date':r[2]} if r else {}
        elif path == '/api/get_countdown':
            c = sqlite3.connect(DB_PATH)
            r = c.execute('SELECT * FROM countdown WHERE id=1').fetchone(); c.close()
            result = {'label':r[1], 'date':r[2]} if r else {'label':'新年','date':'2027-01-01'}
        elif path == '/api/ping':
            result = {'pong':True}
        elif path == '/api/test_flash':
            import ctypes
            user32 = ctypes.windll.user32
            hwnd = user32.FindWindowW(None, APP_TITLE)
            if hwnd:
                class FLASHWINFO(ctypes.Structure):
                    _fields_ = [("cbSize",ctypes.c_uint),("hwnd",ctypes.c_void_p),("dwFlags",ctypes.c_uint),("uCount",ctypes.c_uint),("dwTimeout",ctypes.c_uint)]
                fi = FLASHWINFO()
                fi.cbSize=ctypes.sizeof(FLASHWINFO); fi.hwnd=hwnd; fi.dwFlags=0x3|0xC; fi.uCount=0; fi.dwTimeout=0
                r = user32.FlashWindowEx(ctypes.byref(fi))
                result = {'hwnd':hwnd,'r':r,'le':ctypes.get_last_error()}
            else:
                result = {'error':'window not found'}
        elif path == '/api/version':
            result = {
                'version': '3.0',
                'changelog': [
                    {'v':'3.0','text':'全新注册登录系统：支持多账户记忆、密码修改、首次引导与聚光式功能教学'},
                    {'v':'2.3','text':'正式更名「须臾」——取佛经"极短时间单位"之意，愿君惜取片刻光阴'},
                    {'v':'2.2','text':'关于页面支持动态更新，应用有了专属图标，弹窗不会再误触关闭'},
                    {'v':'2.1','text':'可以在设置里切换字体了，倒数日支持节日预设和自定义日历，日期过了自动跳到下一次'},
                    {'v':'2.0','text':'番茄钟可以自定义预设了，还能看每日专注统计。新增禅模式白噪音和倒计时呼吸灯提醒'},
                    {'v':'1.0','text':'首个桌面版本，支持计时、倒计时、音乐播放、自定义壁纸和深浅色主题'},
                    {'v':'0.1','text':'最初的样子，一个简单的网页秒表'},
                ]
            }
        else:
            code = 404; result = {'error':'not found'}

        self.send_response(code)
        self.send_header('Content-Type','application/json'); self.end_headers()
        self.wfile.write(json.dumps(result, ensure_ascii=False).encode('utf-8'))

    def do_GET(self):
        from urllib.parse import parse_qs, urlparse
        if self.path.startswith('/api/stream_music'):
            q = parse_qs(urlparse(self.path).query)
            try: song_id = int(q.get('id', ['0'])[0])
            except: song_id = 0
            c = sqlite3.connect(DB_PATH)
            row = c.execute('SELECT filename FROM music WHERE id=?', (song_id,)).fetchone()
            c.close()
            if not row:
                self.send_response(404); self.end_headers(); return
            filename = os.path.basename(row[0])
            filepath = os.path.join(MUSIC_DIR, filename)
            if not os.path.isfile(filepath):
                self.send_response(404); self.end_headers(); return
            import mimetypes
            mime = mimetypes.guess_type(filepath)[0] or 'application/octet-stream'
            size = os.path.getsize(filepath)
            range_header = self.headers.get('Range')
            try:
                if range_header and range_header.startswith('bytes='):
                    start_s, end_s = range_header[6:].split('-', 1)
                    start = int(start_s) if start_s else 0
                    end = int(end_s) if end_s else size - 1
                    if start < 0 or end >= size or start > end:
                        self.send_response(416); self.end_headers(); return
                    self.send_response(206)
                    self.send_header('Content-Type', mime)
                    self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
                    self.send_header('Content-Length', end - start + 1)
                    self.send_header('Accept-Ranges', 'bytes')
                    self.end_headers()
                    with open(filepath, 'rb') as f:
                        f.seek(start)
                        remaining = end - start + 1
                        while remaining > 0:
                            chunk = f.read(min(262144, remaining))
                            if not chunk: break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
                    return
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Length', size)
                self.end_headers()
                with open(filepath, 'rb') as f:
                    while True:
                        chunk = f.read(262144)
                        if not chunk: break
                        self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            return
        if self.path.startswith('/api/'):
            self.send_response(405); self.end_headers(); return
        super().do_GET()

def start_server(port=51342):
    for _ in range(5):
        try:
            s = HTTPServer(('127.0.0.1', port), APIHandler)
            threading.Thread(target=s.serve_forever, daemon=True).start()
            return port
        except OSError: port += 1
    raise RuntimeError("Cannot bind server")

# ── pywebview Bridge ──
class Api:
    def __init__(self, w):
        self.window = w
        self._is_fullscreen = False
        self._orig_rect = None
        self._orig_style = None

    def _find_window(self):
        """用 EnumWindows 模糊匹配标题包含 APP_TITLE 的窗口。
        解决不同页面 HTML <title> 不一致（登录页"须臾·登录"、时钟页"须臾·时钟"）
        导致 FindWindowW 精确匹配失败的问题。"""
        try:
            import ctypes
            from ctypes import wintypes
            user32 = ctypes.windll.user32
            user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
            user32.GetWindowTextLengthW.restype = ctypes.c_int
            user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
            user32.GetWindowTextW.restype = ctypes.c_int
            result = [None]

            @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
            def callback(hwnd, lparam):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buf = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buf, length + 1)
                    if APP_TITLE in buf.value:
                        result[0] = hwnd
                        return False  # 找到即停
                return True

            self._enum_cb = callback  # 防止回调被 GC
            user32.EnumWindows(callback, 0)
            return result[0]
        except:
            return None

    def flash_window(self):
        """闪动任务栏提醒（不抢前台）。窗口最小化时用 SW_SHOWNOACTIVATE 恢复，
        否则 FlashWindowEx(FLASHW_TIMERNOFG) 会因窗口已在前台而不闪。"""
        try:
            import ctypes
            from ctypes import wintypes
            user32 = ctypes.windll.user32
            hwnd = self._find_window()
            if not hwnd: return
            user32.IsIconic.argtypes = [wintypes.HWND]
            user32.IsIconic.restype = wintypes.BOOL
            if user32.IsIconic(hwnd):
                user32.ShowWindow(hwnd, 4)  # SW_SHOWNOACTIVATE
            class FLASHWINFO(ctypes.Structure):
                _fields_ = [
                    ("cbSize",    ctypes.c_uint),
                    ("hwnd",      wintypes.HWND),
                    ("dwFlags",   ctypes.c_uint),
                    ("uCount",    ctypes.c_uint),
                    ("dwTimeout", ctypes.c_uint),
                ]
            fi = FLASHWINFO()
            fi.cbSize = ctypes.sizeof(FLASHWINFO)
            fi.hwnd = hwnd
            fi.dwFlags = 0x3 | 0xC  # FLASHW_ALL | FLASHW_TIMERNOFG
            fi.uCount = 0
            fi.dwTimeout = 0
            user32.FlashWindowEx.argtypes = [ctypes.c_void_p]
            user32.FlashWindowEx.restype = wintypes.BOOL
            user32.FlashWindowEx(ctypes.byref(fi))
        except Exception as e: print(f"[flash] {e}")

    def restore_window(self):
        """从最小化状态恢复窗口并置前，然后闪动任务栏（倒计时结束时调用）。"""
        try:
            import ctypes
            from ctypes import wintypes
            user32 = ctypes.windll.user32
            hwnd = self._find_window()
            if not hwnd: return
            user32.IsIconic.argtypes = [wintypes.HWND]
            user32.IsIconic.restype = wintypes.BOOL
            if user32.IsIconic(hwnd):
                user32.ShowWindow(hwnd, 9)  # SW_RESTORE — 恢复窗口到正常大小
            # 模拟 Alt 键按下/释放，绕过 SetForegroundWindow 的权限限制
            user32.keybd_event(0x12, 0, 0, 0)       # VK_MENU down
            user32.keybd_event(0x12, 0, 0x0002, 0)  # VK_MENU up
            user32.SetForegroundWindow.argtypes = [wintypes.HWND]
            user32.SetForegroundWindow.restype = wintypes.BOOL
            user32.SetForegroundWindow(hwnd)
            # 闪动任务栏 5 次后停止
            class FLASHWINFO(ctypes.Structure):
                _fields_ = [
                    ("cbSize",    ctypes.c_uint),
                    ("hwnd",      wintypes.HWND),
                    ("dwFlags",   ctypes.c_uint),
                    ("uCount",    ctypes.c_uint),
                    ("dwTimeout", ctypes.c_uint),
                ]
            fi = FLASHWINFO()
            fi.cbSize = ctypes.sizeof(FLASHWINFO)
            fi.hwnd = hwnd
            fi.dwFlags = 0x3  # FLASHW_ALL
            fi.uCount = 5
            fi.dwTimeout = 0
            user32.FlashWindowEx.argtypes = [ctypes.c_void_p]
            user32.FlashWindowEx.restype = wintypes.BOOL
            user32.FlashWindowEx(ctypes.byref(fi))
        except Exception as e: print(f"[restore] {e}")

    def toggle_fullscreen(self):
        """真全屏：去掉标题栏和边框，窗口铺满整个屏幕（任务栏不可见）。"""
        try:
            import ctypes
            from ctypes import wintypes
            user32 = ctypes.windll.user32
            hwnd = self._find_window()
            if not hwnd:
                self.window.toggle_fullscreen()
                return
            GWL_STYLE = -16
            WS_CAPTION    = 0x00C00000
            WS_THICKFRAME = 0x00040000
            WS_MINIMIZEBOX = 0x00020000
            WS_MAXIMIZEBOX = 0x00010000
            WS_SYSMENU    = 0x00080000
            SWP_FRAMECHANGED = 0x0020
            SWP_NOZORDER     = 0x0004
            SWP_SHOWWINDOW   = 0x0040
            user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
            user32.GetWindowLongW.restype = wintypes.LONG
            user32.SetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int, wintypes.LONG]
            user32.SetWindowLongW.restype = wintypes.LONG
            user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
            user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_uint]
            style = user32.GetWindowLongW(hwnd, GWL_STYLE)
            if not self._is_fullscreen:
                # 保存原始窗口位置和样式
                rect = wintypes.RECT()
                user32.GetWindowRect(hwnd, ctypes.byref(rect))
                self._orig_rect = (rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top)
                self._orig_style = style
                # 去掉标题栏、边框、系统菜单
                new_style = style & ~(WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU)
                user32.SetWindowLongW(hwnd, GWL_STYLE, new_style)
                # 铺满主显示器（任务栏会被覆盖）
                sw = user32.GetSystemMetrics(0)  # SM_CXSCREEN
                sh = user32.GetSystemMetrics(1)  # SM_CYSCREEN
                user32.SetWindowPos(hwnd, 0, 0, 0, sw, sh, SWP_FRAMECHANGED | SWP_NOZORDER | SWP_SHOWWINDOW)
                self._is_fullscreen = True
            else:
                # 恢复原始样式和位置
                user32.SetWindowLongW(hwnd, GWL_STYLE, self._orig_style)
                x, y, w, h = self._orig_rect
                user32.SetWindowPos(hwnd, 0, x, y, w, h, SWP_FRAMECHANGED | SWP_NOZORDER | SWP_SHOWWINDOW)
                self._is_fullscreen = False
        except Exception as e:
            print(f"[fullscreen] {e}")
            self.window.toggle_fullscreen()

    def alert_sound(self):
        try: import winsound; winsound.MessageBeep(0x40)
        except: pass
    def minimize(self): self.window.minimize()

    # ── Music bridge (disk-based, no IDB memory blow) ──
    def import_music(self):
        """打开文件对话框，把音频文件复制到 data/music，返回歌曲元数据。"""
        try:
            paths = self.window.create_file_dialog(
                webview.OPEN_DIALOG, allow_multiple=True,
                file_types=('Audio Files (*.mp3;*.wav;*.flac;*.ogg;*.m4a;*.aac;*.wma)', 'All files (*.*)'))
        except Exception as e:
            print(f'[import_music] dialog error: {e}'); return []
        if not paths: return []
        added = []
        for p in paths:
            if not os.path.isfile(p): continue
            name = os.path.splitext(os.path.basename(p))[0]
            try: added.append(_save_music_file(p, name))
            except Exception as e: print(f'[import_music] {p}: {e}')
        return added

    def import_music_path(self, src_path, name):
        """由 JS 文件输入兜底调用：按路径复制文件到 data/music。"""
        if not src_path or not os.path.isfile(src_path): return None
        try: return _save_music_file(src_path, name)
        except Exception as e: print(f'[import_music_path] {e}'); return None

    def get_music(self):
        """返回所有已导入的磁盘歌曲列表。"""
        _ensure_music_table()
        c = sqlite3.connect(DB_PATH)
        rows = c.execute('SELECT id, name FROM music ORDER BY id').fetchall()
        c.close()
        return [{'id': r[0], 'name': r[1], 'source': 'disk'} for r in rows]

    def rescan_music(self):
        """扫描 data/music/ 目录，把未在数据库中登记的音频文件重新注册。
        用来恢复因为旧版本升级或表结构变化导致的孤儿文件。"""
        _ensure_music_table()
        if not os.path.isdir(MUSIC_DIR):
            return self.get_music()
        audio_exts = {'.mp3','.wav','.flac','.ogg','.m4a','.aac','.wma'}
        c = sqlite3.connect(DB_PATH)
        existing_files = {r[0] for r in c.execute('SELECT filename FROM music').fetchall()}
        registered = 0
        for fn in os.listdir(MUSIC_DIR):
            ext = os.path.splitext(fn)[1].lower()
            if ext not in audio_exts: continue
            if fn in existing_files: continue
            # 孤儿文件: 用文件名(去扩展名)作为默认显示名
            display_name = os.path.splitext(fn)[0]
            try:
                c.execute('INSERT INTO music (name,filename) VALUES (?,?)', (display_name, fn))
                registered += 1
            except Exception as e:
                print(f'[rescan_music] {fn}: {e}')
        c.commit(); c.close()
        if registered: print(f'[rescan_music] registered {registered} orphan file(s)')
        return self.get_music()

    def delete_music(self, song_id):
        """删除指定歌曲的磁盘文件和数据库记录。若多个记录共享同一文件，则保留文件。"""
        if not song_id: return False
        c = sqlite3.connect(DB_PATH)
        row = c.execute('SELECT filename FROM music WHERE id=?', (song_id,)).fetchone()
        if row:
            filename = os.path.basename(row[0])
            others = c.execute('SELECT COUNT(*) FROM music WHERE filename=? AND id!=?', (filename, song_id)).fetchone()[0]
            if others == 0:
                filepath = os.path.join(MUSIC_DIR, filename)
                if os.path.isfile(filepath): os.remove(filepath)
            c.execute('DELETE FROM music WHERE id=?', (song_id,))
            c.commit()
        c.close()
        return True

def main():
    init_db()
    port = start_server()
    url = f'http://127.0.0.1:{port}/login.html'
    win = webview.create_window(title=APP_TITLE, url=url, width=APP_WIDTH, height=APP_HEIGHT, min_size=(800,600), resizable=True)
    api = Api(win)
    win.expose(api.toggle_fullscreen, api.flash_window, api.restore_window, api.alert_sound, api.minimize,
               api.import_music, api.import_music_path, api.get_music, api.delete_music, api.rescan_music)
    webview.start(debug=False, http_server=False, gui='edgechromium')

if __name__ == '__main__': main()
