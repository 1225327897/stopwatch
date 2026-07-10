@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ============================================================
REM   须臾 - 一键部署脚本
REM   功能: Git Pull -> PyInstaller 编译 -> 移动 exe -> 清理
REM   用法: 直接双击运行，不需要管理员权限
REM ============================================================

REM 先切换到脚本所在目录（防双击/管理员运行导致 CWD 错误）
cd /d "%~dp0"
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

REM ===== 配置区（按实际环境修改）=====
REM 默认 Python 解释器路径（留空则自动查找）
set "PYTHON="
REM GitHub 代理（格式: http://127.0.0.1:7892）。若网络直连 GitHub 则留空。
set "HTTP_PROXY=http://127.0.0.1:7892"
set "HTTPS_PROXY=http://127.0.0.1:7892"
REM GitHub 仓库地址
set "REPO=https://github.com/1225327897/stopwatch.git"
REM ===================================

echo.
echo   ============================================
echo     须臾 stopwatch - 一键部署
echo   ============================================
echo.

REM ---- 自动查找 Python ----
echo   [0/4] 查找 Python 环境...
if defined PYTHON goto :found_py

set "PYTHON=C:\Users\%USERNAME%\.workbuddy\binaries\python\versions\3.13.12\python.exe"
if exist "%PYTHON%" goto :found_py

set "PYTHON=D:\Python\Python3.11\python.exe"
if exist "%PYTHON%" goto :found_py

set "PYTHON=D:\hermes\hermes-agent\venv\Scripts\python.exe"
if exist "%PYTHON%" goto :found_py

for /f "delims=" %%i in ('where python 2^>nul') do (
    set "PYTHON=%%i"
    goto :found_py
)

echo   [错误] 未找到 Python，请安装 Python 或在脚本顶部设置 PYTHON 变量
goto :fail

:found_py
echo   使用 Python: %PYTHON%

REM ---- Step 1: Git 同步 ----
echo   [1/4] 同步 GitHub 最新代码...
cd /d "%ROOT%"

if not exist "%ROOT%\.git" (
    echo   未检测到 Git 仓库，初始化并拉取远程代码...
    git init
    git remote add origin "%REPO%"
) else (
    echo   已检测到 Git 仓库，直接 pull...
)

REM 测试 GitHub 连通性；若失败且配置了代理，则启用代理重试
git ls-remote origin main >nul 2>&1
if errorlevel 1 (
    if defined HTTP_PROXY (
        echo   GitHub 直连失败，启用代理: %HTTP_PROXY%
        git config --local http.proxy "%HTTP_PROXY%"
        git config --local https.proxy "%HTTPS_PROXY%"
        set "NO_PROXY="
        set "no_proxy="
    ) else (
        echo   [错误] 无法连接 GitHub，请检查网络或在脚本顶部设置代理
        goto :fail
    )
)

if not exist "%ROOT%\.git\refs\heads\main" (
    git fetch origin
    if errorlevel 1 (
        echo   [错误] 拉取远程代码失败，请检查网络或仓库地址
        goto :fail
    )
    git reset --hard origin/main
    if errorlevel 1 (
        echo   [错误] 重置到远程 main 失败
        goto :fail
    )
) else (
    git pull origin main
    if errorlevel 1 (
        echo   [警告] Pull 有冲突，尝试 reset 到远程版本...
        git fetch origin
        git reset --hard origin/main
    )
)
echo   [OK] 代码同步完成
echo.

REM ---- Step 2: 检查 Python 环境 ----
echo   [2/4] 检查 Python 依赖...

if not exist "%PYTHON%" (
    echo   [错误] 未找到 Python: %PYTHON%
    goto :fail
)

"%PYTHON%" -c "import PyInstaller" >nul 2>&1
if errorlevel 1 (
    echo   未安装 PyInstaller，正在安装...
    "%PYTHON%" -m pip install pyinstaller
    if errorlevel 1 (
        echo   [错误] PyInstaller 安装失败
        goto :fail
    )
)

"%PYTHON%" -c "import webview" >nul 2>&1
if errorlevel 1 (
    echo   未安装 pywebview，正在安装...
    "%PYTHON%" -m pip install pywebview
    if errorlevel 1 (
        echo   [错误] pywebview 安装失败
        goto :fail
    )
)

echo   [OK] Python 环境就绪
echo.

REM ---- Step 3: 编译打包 ----
echo   [3/4] 编译打包 exe...
cd /d "%ROOT%\src"

if exist "build" rd /s /q "build"
if exist "dist" rd /s /q "dist"

"%PYTHON%" -m PyInstaller stopwatch.spec --noconfirm
if errorlevel 1 (
    echo   [错误] 编译失败
    goto :fail
)

if not exist "dist\须臾.exe" (
    echo   [错误] 未找到输出文件 dist\须臾.exe
    goto :fail
)
echo   [OK] 编译完成
echo.

REM ---- Step 4: 移动 exe 并清理 ----
echo   [4/4] 移动 exe 并清理构建缓存...
cd /d "%ROOT%"

if exist "须臾.exe" del /f /q "须臾.exe"
move /y "src\dist\须臾.exe" "%ROOT%\须臾.exe" >nul
if errorlevel 1 (
    echo   [错误] 移动 exe 失败
    goto :fail
)

rd /s /q "src\build" 2>nul
rd /s /q "src\dist" 2>nul
rd /s /q "src\__pycache__" 2>nul

echo   [OK] 部署完成
echo.

REM ---- 完成 ----
echo   ============================================
echo     须臾.exe 已生成在项目根目录
echo     路径: %ROOT%\须臾.exe
echo   ============================================
echo.
pause
exit /b 0

:fail
echo.
echo   ============================================
echo     部署失败，请检查上方错误信息
echo   ============================================
echo.
pause
exit /b 1
