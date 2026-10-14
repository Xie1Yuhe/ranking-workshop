@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Cong Hang Dao La - Ranking Studio

set "NODE_EXE="
if exist "%~dp0runtime\node.exe" set "NODE_EXE=%~dp0runtime\node.exe"
if not defined NODE_EXE for %%I in (node.exe) do if not "%%~$PATH:I"=="" set "NODE_EXE=%%~$PATH:I"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"

if not defined NODE_EXE goto :nonode

echo.
echo   Starting Ranking Studio ...
echo   Node      : !NODE_EXE!
echo   Data file : %~dp0data\state.json
echo   Close the app window to quit.
echo.

"!NODE_EXE!" "%~dp0server\server.js"
set "EXITCODE=!ERRORLEVEL!"

if not "!EXITCODE!"=="0" (
    echo.
    echo   Server exited with code !EXITCODE!.
    echo   See: %~dp0data\error.log
    echo.
    pause
)
goto :eof

:nonode
echo.
echo   [ERROR] Node.js not found.
echo.
echo   This app needs Node.js. Please either:
echo     1. Install Node.js LTS from https://nodejs.org/ and run this file again, or
echo     2. Copy node.exe into the "runtime" folder next to this file.
echo.
pause
goto :eof
