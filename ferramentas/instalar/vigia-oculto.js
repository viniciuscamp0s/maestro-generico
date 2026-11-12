// Lançador oculto do vigia para o Agendador de Tarefas do Windows (wscript, janela 0, espera o fim).
// A saída de erro do node vai para estado/lancador.log (o que falha antes do log do vigia).
var sh = new ActiveXObject('WScript.Shell');
var fso = new ActiveXObject('Scripting.FileSystemObject');
var instalar = fso.GetParentFolderName(WScript.ScriptFullName);
var ferramentas = fso.GetParentFolderName(instalar);
var raiz = fso.GetParentFolderName(ferramentas);
var script = fso.BuildPath(ferramentas, 'vigia.mjs');
var estado = fso.BuildPath(raiz, 'estado');
if (!fso.FolderExists(estado)) fso.CreateFolder(estado);
var saida = fso.BuildPath(estado, 'lancador.log');
// %ProgramW6432% é sempre a pasta de 64 bits; %ProgramFiles% vira "(x86)" quando o wscript roda em 32 bits
var node = fso.BuildPath(fso.BuildPath(sh.ExpandEnvironmentStrings('%ProgramW6432%'), 'nodejs'), 'node.exe');
if (!fso.FileExists(node)) node = 'node.exe';
var cmd = sh.ExpandEnvironmentStrings('%ComSpec%');
WScript.Quit(sh.Run('"' + cmd + '" /d /c ""' + node + '" "' + script + '" 2>> "' + saida + '""', 0, true));
