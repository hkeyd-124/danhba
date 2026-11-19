@echo off
chcp 65001 >nul
setlocal
title Crypto Portfolio Widget - Build .exe

cd /d "%~dp0"

echo.
echo  ============================================
echo   Build file .exe cho Windows
echo  ============================================
echo   Thu muc: %CD%
echo.

if not exist "package.json" (
  echo  [LOI] Khong tim thay package.json. Ban dang o sai thu muc.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo  [LOI] Chua cai Node.js. Tai tai https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\electron-builder" (
  echo   Dang cai dependencies...
  call npm install
  if errorlevel 1 (
    echo  [LOI] npm install that bai.
    pause
    exit /b 1
  )
)

echo.
echo   Dang build... ^(lan dau co the mat 5-10 phut^)
echo.
call npm run dist

if errorlevel 1 (
  echo.
  echo  [LOI] Build that bai. Xem thong bao phia tren.
  echo.
  echo  Neu loi la ERR_ELECTRON_BUILDER_CANNOT_EXECUTE:
  echo  may khong du RAM cho muc nen mac dinh. Mo package.json,
  echo  tim dong "compression" va doi thanh "store", roi chay lai.
  echo.
  pause
  exit /b 1
)

echo.
echo  ============================================
echo   Build xong. File .exe nam trong thu muc dist\
echo  ============================================
echo.
dir /b dist\*.exe
echo.
echo  Mo thu muc dist de lay file:
start "" "%~dp0dist"
echo.
pause
endlocal
