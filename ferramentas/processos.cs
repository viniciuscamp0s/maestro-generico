// Lista os processos do Windows (pid, pid do pai, executável), uma linha por processo separada por
// tabulação, pela API Toolhelp, sem WMI (o WMI chega a levar minutos com a máquina carregada).
// O vigia compila este arquivo uma vez com o csc do .NET Framework que vem no Windows
// (<pastaEstado>/bin/processos.exe) e chama o executável direto.
using System;
using System.Runtime.InteropServices;
using System.Text;

static class Processos {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct PE {
    public uint dwSize, cntUsage, th32ProcessID; public IntPtr th32DefaultHeapID;
    public uint th32ModuleID, cntThreads, th32ParentProcessID; public int pcPriClassBase; public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
  }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint f, uint p);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr h, ref PE e);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr h, ref PE e);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

  static void Main() {
    var sb = new StringBuilder();
    IntPtr h = CreateToolhelp32Snapshot(2, 0);
    var e = new PE(); e.dwSize = (uint)Marshal.SizeOf(typeof(PE));
    if (Process32FirstW(h, ref e)) {
      do { sb.Append(e.th32ProcessID).Append('\t').Append(e.th32ParentProcessID).Append('\t').Append(e.szExeFile).Append('\n'); }
      while (Process32NextW(h, ref e));
    }
    CloseHandle(h);
    Console.Out.Write(sb.ToString());
  }
}
