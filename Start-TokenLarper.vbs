Set fso = CreateObject("Scripting.FileSystemObject")
rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = rootDir
WshShell.Run "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & rootDir & "\scripts\run-server.ps1""", 0, False
