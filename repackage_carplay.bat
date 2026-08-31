@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
set "SCRIPT_DIR=%~dp0"

echo ===== LX-Y Music CarPlay 重签脚本 (Windows) =====

python -c "import azule" 2>nul
if errorlevel 1 (
  echo [信息] 未检测到 Azule，正在尝试 pip 安装（需要联网）...
  pip install azule
  if errorlevel 1 (
    echo 自动安装失败。请手动执行： pip install azule
    pause
    exit /b 1
  )
)

if "%~1"=="" (
  set /p IPA=请输入 Xcode 导出的 .ipa 路径（也可直接把 ipa 拖到本脚本上）:
) else (
  set "IPA=%~1"
)

python "%SCRIPT_DIR%repackage_carplay.py" -i "%IPA%"
echo.
echo 若上方显示 "完成 -^> LxMusicMobile-carplay.ipa"，请用 TrollStore 打开安装该 ipa。
pause
