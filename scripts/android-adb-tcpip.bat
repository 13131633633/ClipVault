@echo off
setlocal enabledelayedexpansion

echo.
echo ClipVault Android USB ADB TCP/IP Helper
echo =======================================
echo.
echo This script helps devices that do not expose the Wireless Debugging UI.
echo Keep the phone connected by USB, enable Developer Options and USB debugging first.
echo.

where adb >nul 2>nul
if errorlevel 1 (
  echo [ERROR] adb was not found in PATH.
  echo Install Android Platform Tools or Android Studio, then reopen this terminal.
  exit /b 1
)

for /f "skip=1 tokens=1,2" %%a in ('adb devices') do (
  if "%%b"=="device" (
    set DEVICE_ID=%%a
    goto :device_found
  )
)

echo [ERROR] No authorized USB device detected.
echo Check the phone screen and accept the USB debugging authorization prompt.
exit /b 1

:device_found
echo [OK] USB device detected: %DEVICE_ID%

echo.
echo [1/6] Restarting adb as TCP/IP on port 5555...
adb -s %DEVICE_ID% tcpip 5555
if errorlevel 1 (
  echo [ERROR] Failed to switch adb to TCP/IP mode.
  exit /b 1
)

echo.
echo [2/6] Reading phone Wi-Fi address...
set DEVICE_IP=
for /f "delims=" %%i in ('adb -s %DEVICE_ID% shell ip route ^| findstr /r /c:"src [0-9]"') do (
  for %%p in (%%i) do (
    if "%%p"=="src" (
      set NEXT_IS_IP=1
    ) else if defined NEXT_IS_IP (
      set DEVICE_IP=%%p
      set NEXT_IS_IP=
    )
  )
)

if not defined DEVICE_IP (
  for /f "delims=" %%i in ('adb -s %DEVICE_ID% shell getprop dhcp.wlan0.ipaddress') do set DEVICE_IP=%%i
)

if not defined DEVICE_IP (
  echo [ERROR] Failed to detect the device Wi-Fi IP address.
  echo Make sure the phone is connected to Wi-Fi, then rerun this script.
  exit /b 1
)

echo [OK] Device Wi-Fi IP: %DEVICE_IP%

echo.
echo [3/6] Connecting adb over LAN...
adb connect %DEVICE_IP%:5555
if errorlevel 1 (
  echo [ERROR] adb connect failed.
  exit /b 1
)

echo.
echo [4/6] Applying keep-alive and background allowances...
adb -s %DEVICE_IP%:5555 shell cmd deviceidle whitelist +io.clipvault.app
adb -s %DEVICE_IP%:5555 shell cmd activity set-standby-bucket io.clipvault.app active
adb -s %DEVICE_IP%:5555 shell cmd appops set io.clipvault.app RUN_IN_BACKGROUND allow
adb -s %DEVICE_IP%:5555 shell cmd appops set io.clipvault.app RUN_ANY_IN_BACKGROUND allow

echo.
echo [5/6] Launching ClipVault...
adb -s %DEVICE_IP%:5555 shell monkey -p io.clipvault.app -c android.intent.category.LAUNCHER 1 >nul 2>nul

echo.
echo [6/6] Done.
echo.
echo Next steps:
echo   1. Open ClipVault on the phone.
echo   2. Go to Settings ^> Permission Guide and keep battery optimization disabled.
echo   3. If the phone supports Wireless Debugging later, you can switch to the in-app advanced pairing flow.
echo.
echo Connected target: %DEVICE_IP%:5555
echo.
pause
