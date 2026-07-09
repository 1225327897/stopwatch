# 须臾

> 取佛经"极短时间单位"之意，愿君惜取片刻光阴。

一款 Windows 桌面效率工具，集番茄钟、倒计时、时钟、专注统计于一体。基于 Python + pywebview (Edge WebView2) 构建，单文件 exe 开箱即用。

## ✨ 功能特性

### 🍅 番茄钟
- 自定义预设（名称 / 图标 / 时长），支持增删改
- 计时结束任务栏橙色闪动提醒 + 系统提示音
- 禅模式白噪音专注辅助
- 呼吸灯倒计时视觉提醒

### 📊 专注统计
- 每日专注时长统计图表
- 历史记录回溯
- 按日 / 周期汇总

### ⏰ 倒数日
- 节日预设 + 自定义日历
- 日期过期自动跳转下一次

### 🕐 时钟
- 翻牌动画数字时钟
- 日期 + 农历显示
- 深 / 浅色主题适配

### 🔐 账户系统
- 注册 / 登录（PBKDF2-SHA256 加密）
- 多账户记忆、密码修改
- 首次登录引导教学（聚光式功能介绍）

### 🎨 个性化
- 深 / 浅色主题切换
- 自定义壁纸
- 字体设置

## 🛠️ 技术栈

| 组件 | 技术 |
|------|------|
| 后端 | Python 3.11 + 内置 HTTPServer |
| 前端渲染 | pywebview + Edge WebView2 |
| 数据库 | SQLite |
| 加密 | PBKDF2-HMAC-SHA256 |
| 打包 | PyInstaller 6.x (UPX 压缩, 单文件 exe) |
| 前端 | 原生 HTML / CSS / JS (无框架) |

## 📁 项目结构

```
stopwatch/
├── assets/              # 应用图标 & 图片资源
│   ├── icon.ico
│   └── 投喂作者.jpg
├── data/                # 运行时数据 (不入库)
│   └── stopwatch.db
├── docs/                # 文档
│   └── flash_fix.patch  # 任务栏闪动修复补丁存档
├── src/                 # 源代码
│   ├── stopwatch.py      # 主程序 (Python 后端 + API)
│   ├── stopwatch.html    # 主界面
│   ├── stopwatch.css     # 主界面样式
│   ├── stopwatch.js      # 主界面逻辑
│   ├── clock.html        # 翻牌时钟页面
│   ├── login.html        # 登录/注册页面
│   ├── login.css         # 登录页样式
│   ├── login.js          # 登录页逻辑
│   ├── stopwatch.spec    # PyInstaller 打包配置
│   └── 投喂作者.jpg
├── deploy.bat            # 一键部署脚本 (Git Pull + 编译)
├── .gitignore
└── 须臾.exe              # 编译产物 (不入库)
```

## 🚀 快速开始

### 直接使用

下载 `须臾.exe`，双击运行即可。无需安装 Python 或任何依赖。

### 从源码编译

#### 环境要求
- Python 3.11+
- 依赖: `pywebview` (需 Edge WebView2 Runtime, Windows 10/11 自带)

#### 步骤

```bash
# 1. 克隆仓库
git clone https://github.com/1225327897/stopwatch.git
cd stopwatch

# 2. 安装依赖
pip install pywebview

# 3. 运行 (开发模式)
cd src
python stopwatch.py

# 4. 打包 exe
pyinstaller stopwatch.spec --noconfirm
# 产物: src/dist/须臾.exe
```

### 一键部署

双击 `deploy.bat`，自动完成 Git 同步 → 环境检查 → PyInstaller 编译 → 移动 exe 到根目录。

> 首次使用需修改脚本中的 `PYTHON` 变量为本机 Python 路径。

## 📜 版本历史

| 版本 | 更新内容 |
|------|----------|
| **3.0** | 全新注册登录系统：多账户记忆、密码修改、首次引导与聚光式功能教学 |
| 2.3 | 正式更名「须臾」——取佛经"极短时间单位"之意 |
| 2.2 | 关于页面动态更新，专属图标，弹窗防误触 |
| 2.1 | 字体切换、倒数日节日预设、过期自动跳转 |
| 2.0 | 番茄钟自定义预设、每日专注统计、禅模式白噪音、呼吸灯提醒 |
| 1.0 | 首个桌面版本：计时、倒计时、音乐播放、自定义壁纸、深浅色主题 |
| 0.1 | 最初的样子，一个简单的网页秒表 |

## 📄 License

个人项目，保留所有权利。
