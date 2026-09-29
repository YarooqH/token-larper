Set fso = CreateObject("Scripting.FileSystemObject")
rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = rootDir
result = WshShell.Run("powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & rootDir & "\scripts\run-server.ps1""", 0, True)
If result <> 0 Then
  message = "Token Larper could not start."
  logPath = rootDir & "\.cache\startup-error.log"
  If fso.FileExists(logPath) Then
    Set logFile = fso.OpenTextFile(logPath, 1)
    message = message & vbCrLf & vbCrLf & logFile.ReadAll
    logFile.Close
  End If
  MsgBox message, vbExclamation, "Token Larper"
End If
