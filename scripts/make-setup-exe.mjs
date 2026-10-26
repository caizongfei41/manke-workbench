// 生成 Setup.exe：把 payload.7z 嵌进去，双击 → 解压 → 跑 install.ps1
//
//   node scripts/make-setup-exe.mjs
//
// 为什么不直接用 7z.sfx：
//   SFX 模块只会解压，不会执行脚本，用户解出来还得自己找 install.ps1 右键运行。
//   也不方便带自定义图标（sfx 模块自带图标，替换要改二进制）。
//
// 为什么不发 .cmd：
//   批处理在资源管理器里双击会闪一个黑框，杀软也更容易拦截；
//   而 exe 能带图标、能显示进度、能自定义错误提示。
//
// 做法：用 C# 编译一个小启动器（csc 在 .NET Framework 里，Windows 自带），
// 把 7z 数据和图标作为资源嵌入，运行时解到临时目录再调 install.ps1。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const STAGE = join(ROOT, 'dist', '漫客工作台控制台-Setup');
const PAYLOAD = join(STAGE, 'payload.7z');
const ICON = join(ROOT, 'assets', 'branding', 'app-icon.ico');
const SEVEN_ZIP = 'C:\\Program Files\\7-Zip\\7z.exe';

/** csc.exe：64 位 .NET Framework 自带，不需要装 SDK。 */
const findCsc = () => {
  const candidates = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
};

const human = (b) => `${(b / 1024 ** 2).toFixed(1)} MB`;

/**
 * 启动器源码。
 * 关键点：
 *  - 资源里带 payload.7z，自己解压（找系统 7z，找不到就用嵌入的）
 *  - 解压目标用 %TEMP%\MankeSetup-<随机>
 *  - 结束后清理临时目录
 *  - 出错弹 MessageBox，不静默失败
 */
const LAUNCHER = String.raw`
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

static class Setup
{
    [STAThread]
    static int Main()
    {
        string temp = Path.Combine(Path.GetTempPath(), "MankeSetup-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        try
        {
            Directory.CreateDirectory(temp);

            // 1. 取出嵌入的 payload.7z
            var asm = Assembly.GetExecutingAssembly();
            string payloadPath = Path.Combine(temp, "payload.7z");
            using (Stream s = asm.GetManifestResourceStream("payload.7z"))
            {
                if (s == null)
                {
                    MessageBox.Show("安装包不完整：缺少 payload.7z", "漫客工作台", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }
                using (var f = File.Create(payloadPath)) { s.CopyTo(f); }
            }

            // 2. 找 7z.exe：系统安装的优先
            string sevenZip = null;
            string[] tries = {
                @"C:\Program Files\7-Zip\7z.exe",
                @"C:\Program Files (x86)\7-Zip\7z.exe",
                Path.Combine(temp, "files", "node", "7z.exe")
            };
            foreach (var t in tries) { if (File.Exists(t)) { sevenZip = t; break; } }

            if (sevenZip == null)
            {
                MessageBox.Show(
                    "需要 7-Zip 才能解压安装包。\n\n请先安装：https://www.7-zip.org/",
                    "漫客工作台", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }

            // 3. 解压
            var psi = new ProcessStartInfo(sevenZip, "x -y -o\"" + temp + "\" \"" + payloadPath + "\"");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            using (var p = Process.Start(psi)) { p.WaitForExit(); }

            string installPs1 = Path.Combine(temp, "install.ps1");
            if (!File.Exists(installPs1))
            {
                MessageBox.Show("安装包不完整：解压后缺少 install.ps1", "漫客工作台", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }

            // 4. 跑安装脚本（-ExecutionPolicy Bypass 绕过默认限制）
            var run = new ProcessStartInfo("powershell.exe",
                "-NoProfile -ExecutionPolicy Bypass -File \"" + installPs1 + "\" -Silent");
            run.UseShellExecute = false;
            using (var p = Process.Start(run)) { p.WaitForExit(); }

            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show("安装失败：\n\n" + ex.Message, "漫客工作台", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            try { if (Directory.Exists(temp)) Directory.Delete(temp, true); } catch { }
        }
    }
}
`;

const main = () => {
  const csc = findCsc();
  if (!csc) {
    console.error('  找不到 csc.exe（.NET Framework 4.x）');
    return 1;
  }
  if (!existsSync(PAYLOAD)) {
    console.error(`  找不到 ${PAYLOAD}，先跑 make-console-installer.mjs --make`);
    return 1;
  }

  const build = join(STAGE, '_build');
  rmSync(build, { recursive: true, force: true });
  mkdirSync(build, { recursive: true });

  writeFileSync(join(build, 'Setup.cs'), LAUNCHER, 'utf8');

  const exe = join(STAGE, '漫客工作台控制台-Setup.exe');
  const iconArg = existsSync(ICON) ? ['/win32icon:' + ICON] : [];

  try {
    execFileSync(
      csc,
      [
        '/target:winexe',
        '/platform:anycpu',
        '/optimize+',
        ...iconArg,
        '/reference:System.Windows.Forms.dll',
        '/reference:System.Core.dll',
        '/resource:' + PAYLOAD + ',payload.7z',
        '/out:' + exe,
        join(build, 'Setup.cs'),
      ],
      { stdio: 'inherit' }
    );
  } catch (error) {
    console.error('  编译失败: ' + String(error).slice(0, 300));
    return 1;
  }

  rmSync(build, { recursive: true, force: true });

  if (!existsSync(exe)) {
    console.error('  编译没有产出 exe');
    return 1;
  }

  console.log(`  ✓ ${exe}`);
  console.log(`    ${human(statSync(exe).size)}`);

  // 把 payload.7z 和安装.cmd 留着做备用路径，但主入口是 exe
  const extras = readdirSync(STAGE).filter((f) => f !== '漫客工作台控制台-Setup.exe');
  console.log('');
  console.log('  目录内容:');
  for (const f of readdirSync(STAGE)) {
    const full = join(STAGE, f);
    if (statSync(full).isDirectory()) continue;
    console.log(`    ${f.padEnd(34)} ${human(statSync(full).size).padStart(9)}`);
  }
  return 0;
};

process.exit(main());
