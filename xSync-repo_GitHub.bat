@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo   DSK LoFi - Sincronizar con GitHub
echo ============================================
echo.

echo [1/5] Comprobando cambios locales...
git status --porcelain > "%TEMP%\dsklofi_status.txt"
for %%A in ("%TEMP%\dsklofi_status.txt") do set size=%%~zA
del "%TEMP%\dsklofi_status.txt" 2>nul

if not "%size%"=="0" (
    echo Archivos modificados:
    git status --short
    echo.
    echo [2/5] Anadiendo y creando commit...
    git add -A

    set /p MSG="Mensaje del commit (Enter para usar fecha/hora): "
    if "!MSG!"=="" (
        for /f "tokens=1-4 delims=/ " %%a in ("%date%") do set FECHA=%%a-%%b-%%c
        set MSG=Update !FECHA! !time!
    )
    git commit -m "!MSG!"
    if errorlevel 1 (
        echo.
        echo ERROR al crear el commit.
        pause
        exit /b 1
    )
    echo.
) else (
    echo No hay cambios locales. Solo se sincronizara con el remoto.
    echo.
)

echo [3/5] Descargando cambios remotos (git pull --rebase)...
git pull --rebase
if errorlevel 1 (
    echo.
    echo ERROR / CONFLICTO al hacer pull --rebase.
    echo Resuelve los conflictos, luego ejecuta:
    echo     git add -A ^&^& git rebase --continue
    echo (o cancela con: git rebase --abort)
    pause
    exit /b 1
)
echo.

echo [4/5] Subiendo a GitHub (git push)...
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

echo [5/5] GitHub Actions...
set /p OPENACT="Abrir GitHub Actions para lanzar el build? (S/N): "
if /i "%OPENACT%"=="S" start "" "https://github.com/dskmusic/dsk-lofi/actions/workflows/check-newpipe.yml"

echo.
pause
