# Compila o Prosa.exe (a janela com o botão de ligar) usando o compilador C# que já vem no Windows.
#   powershell -ExecutionPolicy Bypass -File launcher\build.ps1            -> desenha o ícone e compila
#   powershell -ExecutionPolicy Bypass -File launcher\build.ps1 -Shortcut  -> idem, e põe um atalho na Área de Trabalho
param([switch]$Shortcut)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$framework = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319"
$csc = "$framework\csc.exe"
$exe = "$root\Prosa.exe"
$old = "$root\Prosa.old.exe"

if (-not (Test-Path $csc)) { throw "Não achei o compilador C# em $csc (ele vem com o .NET Framework 4, presente no Windows 10 e 11)." }

# O ícone é desenhado por icon.ps1 (precisa de STA, por isso um PowerShell à parte).
& powershell -NoProfile -STA -ExecutionPolicy Bypass -File "$PSScriptRoot\icon.ps1"
if ($LASTEXITCODE -ne 0) { throw "Não deu pra desenhar o ícone." }

# Com o Prosa aberto, o .exe não pode ser sobrescrito — mas pode ser renomeado. O que está rodando
# segue rodando do arquivo antigo, e o novo vale a partir da próxima vez que abrir.
Remove-Item $old -Force -ErrorAction SilentlyContinue
if (Test-Path $exe) {
    try { [System.IO.File]::Open($exe, 'Open', 'ReadWrite', 'None').Close() }
    catch {
        Rename-Item $exe $old
        "O Prosa está aberto: a versão nova entra em uso quando você fechar e abrir de novo."
    }
}

& $csc /nologo /target:winexe /optimize+ /platform:anycpu /codepage:65001 "/out:$exe" "/win32icon:$PSScriptRoot\prosa.ico" `
    "/resource:$PSScriptRoot\prosa.ico,Prosa.icon.ico" "/resource:$PSScriptRoot\prosa.png,Prosa.icon.png" `
    "/r:$framework\WPF\PresentationFramework.dll" "/r:$framework\WPF\PresentationCore.dll" "/r:$framework\WPF\WindowsBase.dll" `
    "/r:$framework\System.Xaml.dll" "$PSScriptRoot\Launcher.cs"
if ($LASTEXITCODE -ne 0) { throw "A compilação falhou." }
"compilado: $exe"

if ($Shortcut) {
    $link = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Prosa.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($link)
    $lnk.TargetPath = $exe
    $lnk.WorkingDirectory = $root
    $lnk.IconLocation = "$exe,0"
    $lnk.Description = 'Liga o Prosa e mostra o link pra mandar pros amigos'
    $lnk.Save()
    "atalho criado: $link"
}

# O Windows guarda os ícones em cache: sem este aviso, o Explorer segue mostrando o desenho antigo.
Add-Type -Namespace Prosa -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);'
[Prosa.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
