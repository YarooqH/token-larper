Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(scriptDir)
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = rootDir
WshShell.Run "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & fso.BuildPath(scriptDir, "run-server.ps1") & """", 0, False
