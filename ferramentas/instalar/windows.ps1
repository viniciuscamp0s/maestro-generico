# Instala o vigia do Maestro no Windows: registra (ou atualiza) a tarefa "Vigia do Maestro" no Agendador de
# Tarefas, que roda ferramentas/vigia.mjs no logon e a cada 10 minutos, oculta (wscript + vigia-oculto.js),
# so com o usuario logado. Cria maestro.config.json a partir do exemplo se ainda nao existir. Idempotente.
# Uso:      powershell -NoProfile -ExecutionPolicy Bypass -File ferramentas\instalar\windows.ps1
# Desligar: schtasks /Change /TN "Vigia do Maestro" /DISABLE   (religar: /ENABLE)
# Remover:  powershell -NoProfile -ExecutionPolicy Bypass -File ferramentas\instalar\windows.ps1 -Remover
param([switch]$Remover)
$ErrorActionPreference = 'Stop'
$nomeTarefa = 'Vigia do Maestro'
if ($Remover) {
  Unregister-ScheduledTask -TaskName $nomeTarefa -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Tarefa '$nomeTarefa' removida."
  exit 0
}
$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$config = Join-Path $raiz 'maestro.config.json'
if (-not (Test-Path $config)) {
  Copy-Item (Join-Path $raiz 'maestro.config.exemplo.json') $config
  Write-Output "Criado $config (preencha os projetos)."
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js nao encontrado. Instale em https://nodejs.org e rode de novo.' }
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Write-Warning 'Claude Code nao encontrado no PATH: o vigia nao vai conseguir abrir sessoes.' }
$lancador = (Resolve-Path (Join-Path $PSScriptRoot 'vigia-oculto.js')).Path
$usuario = "$env:USERDOMAIN\$env:USERNAME"
$acao = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" -Argument "//B //Nologo `"$lancador`"" -WorkingDirectory $raiz
$logon = New-ScheduledTaskTrigger -AtLogOn -User $usuario
$logon.Delay = 'PT2M'  # da tempo do Orca subir depois do logon
$repete = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 10)
$ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -Hidden -Priority 4
# Prioridade 4 (normal): o padrao do Agendador e 7, abaixo do normal, e com a maquina no limite a tarefa
# fica sem CPU e todo comando filho estoura o tempo.
$quem = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $nomeTarefa -Action $acao -Trigger @($logon, $repete) -Settings $ajustes `
  -Principal $quem -Description 'Vigia do Maestro: retoma sessoes do Claude Code abertas pelo Maestro ate o fim.' -Force | Out-Null
$t = Get-ScheduledTask -TaskName $nomeTarefa
Write-Output "Tarefa '$nomeTarefa' instalada: estado $($t.State), a cada 10 minutos e no logon."
Write-Output "Teste agora: node `"$raiz\ferramentas\vigia.mjs`" --check"
