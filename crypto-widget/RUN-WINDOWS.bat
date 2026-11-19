@echo off
chcp 65001 >nul
setlocal
title Crypto Portfolio Widget - Khoi dong

rem ============================================================
rem  Chay app bang 1 cu nhap dup (hoac chuot phai > Run as admin
rem  neu npm install bi loi quyen).
rem
rem  File nay TU TIM dung thu muc cua no, nen ban khong can
rem  "cd" thu cong va khong bi loi "The system cannot find the
rem  path specified".
rem ============================================================

rem --- 1. Chuyen ve dung thu muc chua file .bat nay -------------
cd /d "%~dp0"

echo.
echo  ============================================
echo   Crypto Portfolio Widget
echo  ============================================
echo   Thu muc dang lam viec:
echo   %CD%
echo.

rem --- 2. Kiem tra file package.json co that khong --------------
if not exist "package.json" (
  echo  [LOI] Khong tim thay package.json trong thu muc nay.
  echo.
  echo  Ban dang chay file .bat o SAI thu muc.
  echo  Hay mo thu muc co chua:  package.json  main.js  preload.js
  echo  roi chay lai file nay.
  echo.
  pause
  exit /b 1
)

rem --- 3. Kiem tra Node.js --------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  [LOI] Chua cai Node.js, hoac Node chua co trong PATH.
  echo.
  echo  Tai va cai Node.js 20 LTS tai:  https://nodejs.org/
  echo  Sau khi cai, DONG cua so nay va mo lai roi chay lai.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODEVER=%%v
echo   Node.js: %NODEVER%
echo.

rem --- 4. Cai dependencies neu chua co --------------------------
if not exist "node_modules\electron" (
  echo   Lan dau chay: dang tai Electron, co the mat 2-5 phut...
  echo   ^(can internet, khoang 200 MB^)
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  [LOI] npm install that bai. Xem thong bao phia tren.
    echo  Thu cac cach sau:
    echo    1. Kiem tra internet
    echo    2. Chay lai file nay bang quyen Administrator
    echo    3. Xoa thu muc node_modules roi chay lai
    echo.
    pause
    exit /b 1
  )
  echo.
  echo   Cai dat xong.
  echo.
) else (
  echo   Dependencies da co san, bo qua npm install.
  echo.
)

rem --- 5. Chay app ----------------------------------------------
echo   Dang mo widget...
echo.
call npm start

if errorlevel 1 (
  echo.
  echo  [LOI] App thoat voi ma loi. Xem thong bao phia tren.
  echo.
  pause
)

endlocal
