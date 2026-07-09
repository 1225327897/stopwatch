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

# ── Crypto helpers ──────────────────────────
def hash_pw(pw, salt=None):
    if salt is None: salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), 100000)
    return salt + ':' + h.hex()

def verify_pw(pw, stored):
    salt, h = stored.split(':')
    return hash_pw(pw, salt) == stored

# ── Database ───────────────────────────────
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
    def __init__(self, w): self.window = w
    def toggle_fullscreen(self): self.window.toggle_fullscreen()
    def flash_window(self):
        try:
            import ctypes
            from ctypes import wintypes
            user32 = ctypes.windll.user32
            # 64 位安全：显式声明返回类型，否则 HWND 默认按 c_int(32位) 返回会被截断
            user32.FindWindowW.restype = wintypes.HWND
            user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
            hwnd = user32.FindWindowW(None, APP_TITLE)
            if not hwnd: return
            # 关键修复：窗口最小化时用 SW_SHOWNOACTIVATE(4) 恢复，不抢前台。
            # 原代码用 SW_RESTORE(9) 会把窗口激活到前台，导致随后的
            # FlashWindowEx(FLASHW_TIMERNOFG) 因“窗口已在前台”而不产生任务栏橙色闪动。
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
            fi.cbSize    = ctypes.sizeof(FLASHWINFO)
            fi.hwnd      = hwnd
            fi.dwFlags   = 0x3 | 0xC  # FLASHW_ALL(3) | FLASHW_TIMERNOFG(C) = 闪到窗口来到前台
            fi.uCount    = 0
            fi.dwTimeout = 0
            user32.FlashWindowEx.argtypes = [ctypes.c_void_p]
            user32.FlashWindowEx.restype  = wintypes.BOOL
            user32.FlashWindowEx(ctypes.byref(fi))
        except Exception as e: print(f"[flash] {e}")
    def alert_sound(self):
        try: import winsound; winsound.MessageBeep(0x40)
        except: pass
    def minimize(self): self.window.minimize()

def main():
    init_db()
    port = start_server()
    url = f'http://127.0.0.1:{port}/login.html'
    win = webview.create_window(title=APP_TITLE, url=url, width=APP_WIDTH, height=APP_HEIGHT, min_size=(800,600), resizable=True)
    api = Api(win)
    win.expose(api.toggle_fullscreen, api.flash_window, api.alert_sound, api.minimize)
    webview.start(debug=False, http_server=False, gui='edgechromium')

if __name__ == '__main__': main()
