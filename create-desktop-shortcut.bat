@echo off
rem Puts a "Farhan AI" shortcut with the app's icon on your desktop.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Farhan AI.lnk');" ^
  "$s.TargetPath = '%~dp0start-chatbot.bat';" ^
  "$s.WorkingDirectory = '%~dp0';" ^
  "$s.IconLocation = '%~dp0public\favicon.ico';" ^
  "$s.Description = 'Farhan AI';" ^
  "$s.Save()"
if errorlevel 1 (
  echo Could not create the shortcut.
) else (
  echo Done! Look for "Farhan AI" on your desktop.
)
pause
