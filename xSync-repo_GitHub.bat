@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set /a LIMIT=104857600
set /a WARN=52428800

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

    echo [1b/5] Comprobando archivos grandes ^(limite GitHub 100 MB^)...
    set "BIGFILE="
    del "%TEMP%\dsklofi_files.txt" 2>nul
    git ls-files -o --exclude-standard      >> "%TEMP%\dsklofi_files.txt"
    git diff --name-only                    >> "%TEMP%\dsklofi_files.txt"
    git diff --name-only --cached           >> "%TEMP%\dsklofi_files.txt"

    for /f "usebackq eol=| delims=" %%F in ("%TEMP%\dsklofi_files.txt") do (
        set "p=%%F"
        set "p=!p:/=\!"
        set "fsize="
        for %%A in ("!p!") do set "fsize=%%~zA"
        if not "!fsize!"=="" (
            set /a mb=!fsize!/1048576
            if !fsize! GTR %LIMIT% (
                echo   [BLOQUEA] !mb! MB  ^>  %%F
                set "BIGFILE=1"
            ) else if !fsize! GTR %WARN% (
                echo   [aviso]   !mb! MB     %%F   ^(grande, pero permitido^)
            )
        )
    )
    del "%TEMP%\dsklofi_files.txt" 2>nul

    if defined BIGFILE (
        echo.
        echo ============================================
        echo   ABORTADO: hay archivos de mas de 100 MB.
        echo   GitHub los rechazara ^(y quedarian en el historial^).
        echo   NO se ha hecho commit ni push.
        echo.
        echo   Soluciones:
        echo     - Mueve el archivo fuera del repositorio, o
        echo     - Anhadelo a .gitignore  ^(p.ej.  *.rar^), o
        echo     - Usa Git LFS  https://git-lfs.github.com
        echo   Luego vuelve a ejecutar este script.
        echo ============================================
        goto :fin
    )
    echo   OK: ningun archivo supera el limite.
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
        goto :fin
    )
    echo.
) else (
    echo No hay cambios locales. Solo se sincronizara con el remoto.
    echo.
)

echo [3/5] Descargando cambios remotos (git pull --rebase)...
git pull --rebase
set PULLERR=!errorlevel!
if !PULLERR! NEQ 0 (
    echo.
    echo AVISO: git pull --rebase devolvio codigo !PULLERR!.
    echo Continuando directamente con el push...
    echo.
)
echo.

echo [4/5] Subiendo a GitHub (git push)...
git push
if errorlevel 1 (
    echo.
    echo ERROR al hacer push.
    goto :fin
)

echo.
echo ============================================
echo   HECHO. Resumen del ultimo commit:
echo ============================================
git show --stat HEAD
echo.

:fin
echo [5/5] GitHub Actions...
set "OPENACT=N"
set /p "OPENACT=Abrir GitHub Actions para lanzar nueva APK? (s/N): "
if /i "!OPENACT!"=="S" start "" "https://github.com/dskmusic/dsk-lofi/actions/workflows/check-newpipe.yml"

echo.
pause
