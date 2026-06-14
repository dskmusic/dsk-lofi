@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   DSK LoFi - Sincronizar con GitHub
echo ============================================
echo.

echo [1/4] Descargando cambios remotos (git pull)...
git pull
if errorlevel 1 (
    echo.
    echo ERROR al hacer pull. Revisa conflictos antes de continuar.
    pause
    exit /b 1
)
echo.

echo [2/4] Comprobando cambios locales...
git status --porcelain > "%TEMP%\dsklofi_status.txt"
for %%A in ("%TEMP%\dsklofi_status.txt") do set size=%%~zA
if "%size%"=="0" (
    echo No hay cambios locales que subir.
    del "%TEMP%\dsklofi_status.txt"
    pause
    exit /b 0
)

echo Archivos modificados:
git status --short
echo.

echo [3/4] Anadiendo y creando commit...
git add -A

set /p MSG="Mensaje del commit (Enter para usar fecha/hora): "
if "%MSG%"=="" (
    for /f "tokens=1-4 delims=/ " %%a in ("%date%") do set FECHA=%%a-%%b-%%c
    set MSG=Update %FECHA% %time%
)

git commit -m "%MSG%"
echo.

echo [4/4] Subiendo a GitHub (git push)...
git push
if errorlevel 1 (
    echo.
    echo ERROR al hacer push.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   HECHO. Resumen del ultimo commit:
echo ============================================
git show --stat HEAD
echo.
echo ============================================
echo   Recuerda: para generar una nueva version
echo   de la app (APK + auto-update), ve a:
echo   https://github.com/dskmusic/dsk-lofi/actions
echo   y lanza "Check NewPipeExtractor and Release"
echo   marcando "force_build" si quieres forzarlo.
echo ============================================
echo.
pause
del "%TEMP%\dsklofi_status.txt" 2>nul
