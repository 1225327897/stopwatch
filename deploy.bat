@echo off
chcp 936 >nul 2>&1

REM ============================================================
REM   须臾 stopwatch - 一键部署脚本
REM   功能: (可选)Git同步 -> PyInstaller编译 -> 移动exe -> 清理
REM   用法: 直接双击运行
REM   说明: 从GitHub下载ZIP后直接双击即可编译，不依赖.git
REM ============================================================

cd /d "%~dp0"
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

REM ===== 配置区 =====
set "PYTHON="
set "HTTP_PROXY=http://127.0.0.1:7893"
set "HTTPS_PROXY=http://127.0.0.1:7893"
set "REPO=https://github.com/1225327897/stopwatch.git"
REM ==================

echo.
echo   ============================================
echo     须臾 stopwatch - 一键部署
echo   ============================================
echo.

REM ---- [1/4] 查找 Python ----
echo   [1/4] 查找 Python 环境...

if defined PYTHON goto :found_py

set "PYTHON=C:\Users\%USERNAME%\.workbuddy\binaries\python\versions\3.13.12\python.exe"
if exist "%PYTHON%" goto :found_py

set "PYTHON=D:\Python\Python3.11\python.exe"
if exist "%PYTHON%" goto :found_py

set "PYTHON=D:\hermes\hermes-agent\venv\Scripts\python.exe"
if exist "%PYTHON%" goto :found_py

for /f "delims=" %%i in ('where python 2^>nul') do set "PYTHON=%%i" & goto :found_py

echo   [错误] 未找到 Python，请在脚本顶部设置 PYTHON 变量
goto :fail

:found_py
echo   Python: %PYTHON%
echo.

REM ---- [2/4] Git 同步（可选，失败不中断）----
echo   [2/4] 同步 GitHub 最新代码...
cd /d "%ROOT%"

if exist "%ROOT%\.git" goto :git_pull

REM 没有 .git — 可能是 ZIP 下载，尝试初始化并拉取
echo   未检测到 .git，尝试从 GitHub 拉取...
git init >nul 2>&1
git remote remove origin >nul 2>&1
git remote add origin "%REPO%"
goto :git_test_conn

:git_pull
echo   已有 .git 仓库，尝试 pull 更新...

:git_test_conn
REM 测试连通性，失败则启用代理
git ls-remote origin main >nul 2>&1
if not errorlevel 1 goto :git_do_sync

if not defined HTTP_PROXY goto :git_skip
echo   GitHub 直连失败，启用代理: %HTTP_PROXY%
git config --local http.proxy "%HTTP_PROXY%"
git config --local https.proxy "%HTTPS_PROXY%"
set "NO_PROXY="
set "no_proxy="

:git_do_sync
if exist "%ROOT%\.git\refs\heads\main" goto :git_pull_main

REM 首次拉取
git fetch origin >nul 2>&1
if errorlevel 1 goto :git_skip
git reset --hard origin/main >nul 2>&1
if errorlevel 1 goto :git_skip
echo   [OK] 代码已同步到最新版本
goto :git_done

:git_pull_main
git pull origin main >nul 2>&1
if not errorlevel 1 echo   [OK] 代码已更新
if errorlevel 1 (
  echo   [警告] Pull 有冲突，reset 到远程版本...
  git fetch origin >nul 2>&1
  git reset --hard origin/main >nul 2>&1
)
goto :git_done

:git_skip
echo   [警告] Git 同步失败，使用本地已有代码继续编译

:git_done
echo.

REM ---- [3/4] 检查依赖 + 编译 ----
echo   [3/4] 检查 Python 依赖...

if not exist "%PYTHON%" goto :fail_no_python

"%PYTHON%" -c "import PyInstaller" >nul 2>&1
if not errorlevel 1 goto :check_webview
echo   安装 PyInstaller...
"%PYTHON%" -m pip install pyinstaller >nul 2>&1
if errorlevel 1 goto :fail_pyinstaller

:check_webview
"%PYTHON%" -c "import webview" >nul 2>&1
if not errorlevel 1 goto :build
echo   安装 pywebview...
"%PYTHON%" -m pip install pywebview >nul 2>&1
if errorlevel 1 goto :fail_webview

:build
echo   [OK] 依赖就绪
echo.
echo   开始编译 exe...
cd /d "%ROOT%\src"

if exist "build" rd /s /q "build" 2>nul
if exist "dist" rd /s /q "dist" 2>nul

"%PYTHON%" -m PyInstaller stopwatch.spec --noconfirm
if errorlevel 1 goto :fail_build

if not exist "dist\须臾.exe" goto :fail_no_exe
echo   [OK] 编译完成
echo.

REM ---- [4/4] 移动 exe 并清理 ----
echo   [4/4] 移动 exe 并清理...
cd /d "%ROOT%"

if exist "须臾.exe" del /f /q "须臾.exe" >nul 2>&1
move /y "src\dist\须臾.exe" "%ROOT%\须臾.exe" >nul
if errorlevel 1 goto :fail_move

rd /s /q "src\build" 2>nul
rd /s /q "src\dist" 2>nul
rd /s /q "src\__pycache__" 2>nul

echo   [OK] 部署完成
echo.
echo   ============================================
echo     须臾.exe 已生成
echo     路径: %ROOT%\须臾.exe
echo   ============================================
echo.
pause
exit /b 0

REM ===== 错误处理 =====

:fail_no_python
echo   [错误] 未找到 Python: %PYTHON%
goto :fail

:fail_pyinstaller
echo   [错误] PyInstaller 安装失败
goto :fail

:fail_webview
echo   [错误] pywebview 安装失败
goto :fail

:fail_build
echo   [错误] 编译失败
goto :fail

:fail_no_exe
echo   [错误] 未找到输出文件 dist\须臾.exe
goto :fail

:fail_move
echo   [错误] 移动 exe 失败
goto :fail

:fail
echo.
echo   ============================================
echo     部署失败，请检查上方错误信息
echo   ============================================
echo.
pause
exit /b 1
