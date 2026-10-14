' 从夯到拉 · 排名工坊 —— 静默启动（不显示命令行窗口）
Option Explicit

Dim shell, fso, base, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = """" & base & "\启动程序.cmd"""

' 0 = 隐藏窗口，False = 不等待
shell.Run cmd, 0, False
