@echo off
chcp 65001 > nul
cd /d "%~dp0"
where node > nul 2>&1 || (echo Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치하세요. & pause & exit /b)
node server.js
pause
