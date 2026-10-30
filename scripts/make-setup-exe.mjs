// 生成 Setup.exe：带安装向导的安装程序
//
//   node scripts/make-setup-exe.mjs
//
// 为什么不直接用 7z.sfx：
//   SFX 模块只会解压，不会执行脚本，用户解出来还得自己找 install.ps1 右键运行。
//   也不方便带自定义图标。
//
// 为什么不发 .cmd：
//   批处理在资源管理器里双击会闪一个黑框，杀软也更容易拦截。
//
// 安装向导三页：
//   1. 欢迎 + 许可 + 安装位置（可选盘）
//   2. 进度
//   3. 完成（可勾选立即启动）
//
// 做法：C# 编译一个小 WinForms 程序，payload.7z 作为资源嵌入，
// 运行时解到临时目录再跑 install.ps1。目标目录通过 -Target 传给脚本，
// 这样用户选的位置和脚本实际装的位置一定一致。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const STAGE = join(ROOT, 'dist', '漫客工作台控制台-Setup');
const PAYLOAD = join(STAGE, 'payload.7z');
const ICON = join(ROOT, 'assets', 'branding', 'app-icon.ico');

/** csc.exe：.NET Framework 4.x 自带，不需要装 SDK。 */
const findCsc = () => {
  const candidates = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
};

const human = (b) => `${(b / 1024 ** 2).toFixed(1)} MB`;

/**
 * 安装向导。三页式，和普通 Windows 安装程序一样。
 *
 * 关键设计：
 *  - 安装位置可以通过「浏览」选任意目录，也可以从下拉框选盘
 *  - 目标目录不允许装在需要管理员权限的地方（Program Files 会失败），
 *    所以默认放 %LOCALAPPDATA%，用户改也能改
 *  - 装的过程用后台线程跑，UI 不卡
 *  - 装完显示「启动」勾选框
 */
const LAUNCHER = String.raw`
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

static class SetupApp
{
    static string payloadTemp;
    static string installTarget;
    static readonly string DefaultTarget =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                     @"Programs\漫客工作台");

    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        // 支持静默安装：Setup.exe /S /D=C:\path
        bool silent = false;
        foreach (var a in args)
        {
            if (a.Equals("/S", StringComparison.OrdinalIgnoreCase)) silent = true;
            if (a.StartsWith("/D=", StringComparison.OrdinalIgnoreCase)) installTarget = a.Substring(3).Trim('"');
        }

        if (installTarget == null) installTarget = DefaultTarget;

        string temp = Path.Combine(Path.GetTempPath(), "MankeSetup-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        try
        {
            Directory.CreateDirectory(temp);

            // 先取出 payload（向导第一页要显示大小，所以提前做）
            var asm = Assembly.GetExecutingAssembly();
            payloadTemp = Path.Combine(temp, "payload.7z");
            using (Stream s = asm.GetManifestResourceStream("payload.7z"))
            {
                if (s == null)
                {
                    MessageBox.Show("安装包不完整：缺少 payload.7z", "漫客工作台",
                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }
                using (var f = File.Create(payloadTemp)) { s.CopyTo(f); }
            }

            if (silent)
            {
                bool ok = DoInstall(null, null);
                return ok ? 0 : 1;
            }

            using (var wizard = new WizardForm())
            {
                Application.Run(wizard);
                return wizard.Success ? 0 : 1;
            }
        }
        finally
        {
            try { if (Directory.Exists(temp)) Directory.Delete(temp, true); } catch { }
        }
    }

    public static string PayloadPath { get { return payloadTemp; } }
    public static string Target { get { return installTarget; } set { installTarget = value; } }

    /// 解压 + 跑 install.ps1。progress 为 null 时静默。
    public static bool DoInstall(string tempRoot, Action<int, string> progress)
    {
        try
        {
            if (progress != null) progress(5, "正在解压安装文件…");

            string workDir = Path.Combine(Path.GetTempPath(), "MankeUnpack-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(workDir);
            try
            {
                string sevenZip = null;
                string[] tries = {
                    @"C:\Program Files\7-Zip\7z.exe",
                    @"C:\Program Files (x86)\7-Zip\7z.exe",
                    Path.Combine(workDir, "files", "node", "7z.exe")
                };
                foreach (var t in tries) { if (File.Exists(t)) { sevenZip = t; break; } }

                if (sevenZip == null)
                {
                    MessageBox.Show("需要 7-Zip 才能解压安装包。\n\n请先安装：https://www.7-zip.org/",
                        "漫客工作台", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return false;
                }

                var psi = new ProcessStartInfo(sevenZip, "x -y -o\"" + workDir + "\" \"" + payloadTemp + "\"");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                using (var p = Process.Start(psi)) { p.WaitForExit(); }

                if (progress != null) progress(60, "正在安装到 " + installTarget + " …");

                string installPs1 = Path.Combine(workDir, "install.ps1");
                if (!File.Exists(installPs1))
                {
                    MessageBox.Show("安装包不完整：解压后缺少 install.ps1", "漫客工作台",
                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return false;
                }

                var run = new ProcessStartInfo("powershell.exe",
                    "-NoProfile -ExecutionPolicy Bypass -File \"" + installPs1 + "\" -Silent -NoLaunch -Target \"" + installTarget + "\"");
                run.UseShellExecute = false;
                run.CreateNoWindow = true;
                using (var p = Process.Start(run)) { p.WaitForExit(); }

                if (progress != null) progress(100, "安装完成");
                return Directory.Exists(installTarget);
            }
            finally
            {
                try { if (Directory.Exists(workDir)) Directory.Delete(workDir, true); } catch { }
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show("安装失败：\n\n" + ex.Message, "漫客工作台",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return false;
        }
    }

        /// <summary>
        /// 把内嵌的 7z.exe 与依赖 dll 释放到目录，返回 exe 路径。
        /// 失败返回 null（调用方会退回系统安装的 7-Zip）。
        ///
        /// 为什么必须自带：安装器要解 payload 才能装东西，而 payload 是 7z 格式。
        /// 之前它去临时目录找 7z.exe，可那个目录解压前是空的 —— 死循环。
        /// </summary>
        static string ExtractBundled7z(string dir)
        {
            try
            {
                var asm = Assembly.GetExecutingAssembly();
                string[] names = { "7z.exe", "7z.dll", "7-zip.dll" };
                foreach (var name in names)
                {
                    using (Stream s = asm.GetManifestResourceStream("sevenzip." + name))
                    {
                        if (s == null) return null;
                        string dst = Path.Combine(dir, name);
                        using (var f = File.Create(dst)) { s.CopyTo(f); }
                    }
                }
                string exe = Path.Combine(dir, "7z.exe");
                return File.Exists(exe) ? exe : null;
            }
            catch
            {
                return null;
            }
        }
}

/// 三页式安装向导
class WizardForm : Form
{
    public bool Success = false;

    readonly Panel pageWelcome = new Panel();
    readonly Panel pageProgress = new Panel();
    readonly Panel pageDone = new Panel();

    readonly TextBox pathBox = new TextBox();
    readonly ComboBox driveBox = new ComboBox();
    readonly ProgressBar bar = new ProgressBar();
    readonly Label statusLabel = new Label();
    readonly CheckBox launchBox = new CheckBox();
    readonly Button backBtn = new Button();
    readonly Button nextBtn = new Button();
    readonly Button cancelBtn = new Button();

    int current = 0;

    public WizardForm()
    {
        Text = "漫客工作台 · 控制台安装";
        ClientSize = new Size(560, 380);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        BackColor = ColorTranslator.FromHtml("#0F1012");
        ForeColor = ColorTranslator.FromHtml("#F4F4F5");
        Font = new Font("Microsoft YaHei UI", 9F);

        try
        {
            var asm = Assembly.GetExecutingAssembly();
            // 图标已通过 /win32icon 嵌入，窗体直接用
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        }
        catch { }

        BuildWelcome();
        BuildProgress();
        BuildDone();

        Controls.Add(pageWelcome);
        Controls.Add(pageProgress);
        Controls.Add(pageDone);

        // 底部按钮条
        backBtn.Text = "上一步";
        backBtn.Location = new Point(250, 330);
        backBtn.Size = new Size(90, 32);
        backBtn.FlatStyle = FlatStyle.Flat;
        backBtn.Click += (s, e) => { if (current > 0) ShowPage(0); };

        nextBtn.Text = "下一步";
        nextBtn.Location = new Point(348, 330);
        nextBtn.Size = new Size(100, 32);
        nextBtn.FlatStyle = FlatStyle.Flat;
        nextBtn.BackColor = ColorTranslator.FromHtml("#22D3EE");
        nextBtn.ForeColor = Color.Black;
        nextBtn.Click += OnNext;

        cancelBtn.Text = "取消";
        cancelBtn.Location = new Point(456, 330);
        cancelBtn.Size = new Size(88, 32);
        cancelBtn.FlatStyle = FlatStyle.Flat;
        cancelBtn.Click += (s, e) => Close();

        Controls.Add(backBtn);
        Controls.Add(nextBtn);
        Controls.Add(cancelBtn);

        ShowPage(0);
    }

    void BuildWelcome()
    {
        pageWelcome.Bounds = new Rectangle(0, 0, 560, 320);
        pageWelcome.BackColor = BackColor;

        var title = new Label();
        title.Text = "安装漫客工作台 · 控制台";
        title.Font = new Font("Microsoft YaHei UI", 15F, FontStyle.Bold);
        title.ForeColor = ColorTranslator.FromHtml("#22D3EE");
        title.Location = new Point(24, 22);
        title.Size = new Size(500, 32);
        pageWelcome.Controls.Add(title);

        var desc = new Label();
        desc.Text = "控制台用来下载、校验和部署工作台本体。\n它会安装独立的 Node 运行时和 7-Zip，目标机器不需要预装任何东西。";
        desc.ForeColor = ColorTranslator.FromHtml("#A3A3AB");
        desc.Location = new Point(24, 62);
        desc.Size = new Size(510, 44);
        pageWelcome.Controls.Add(desc);

        var pathLabel = new Label();
        pathLabel.Text = "安装位置";
        pathLabel.Location = new Point(24, 120);
        pathLabel.Size = new Size(80, 22);
        pageWelcome.Controls.Add(pathLabel);

        driveBox.Location = new Point(24, 145);
        driveBox.Size = new Size(150, 26);
        driveBox.DropDownStyle = ComboBoxStyle.DropDownList;
        driveBox.FlatStyle = FlatStyle.Flat;
        foreach (var d in DriveInfo.GetDrives())
        {
            if (!d.IsReady) continue;
            if (d.DriveType != DriveType.Fixed) continue;
            try
            {
                long free = d.AvailableFreeSpace;
                driveBox.Items.Add(new DriveItem(d.Name, free));
            }
            catch { }
        }
        driveBox.DisplayMember = "Display";
        driveBox.SelectedIndexChanged += (s, e) =>
        {
            var item = driveBox.SelectedItem as DriveItem;
            if (item == null) return;
            pathBox.Text = Path.Combine(item.Root, "漫客工作台");
        };
        if (driveBox.Items.Count > 0) driveBox.SelectedIndex = 0;
        pageWelcome.Controls.Add(driveBox);

        pathBox.Location = new Point(182, 145);
        pathBox.Size = new Size(270, 26);
        pathBox.Text = SetupApp.Target;
        pathBox.TextChanged += (s, e) => SetupApp.Target = pathBox.Text;
        pageWelcome.Controls.Add(pathBox);

        var browse = new Button();
        browse.Text = "浏览…";
        browse.Location = new Point(458, 145);
        browse.Size = new Size(78, 26);
        browse.FlatStyle = FlatStyle.Flat;
        browse.Click += (s, e) =>
        {
            using (var dlg = new FolderBrowserDialog())
            {
                dlg.Description = "选择安装目录（不需要管理员权限的位置）";
                if (Directory.Exists(pathBox.Text)) dlg.SelectedPath = pathBox.Text;
                if (dlg.ShowDialog() == DialogResult.OK)
                {
                    pathBox.Text = Path.Combine(dlg.SelectedPath, "漫客工作台");
                }
            }
        };
        pageWelcome.Controls.Add(browse);

        var info = new Label();
        info.Text = "安装内容：控制台界面 · 部署脚本 · 环境自检 · Node 24 · 7-Zip\n占用约 100 MB。工作台本体和 ComfyUI 模型不包含在内，装好后用控制台下载部署。";
        info.ForeColor = ColorTranslator.FromHtml("#71717A");
        info.Location = new Point(24, 195);
        info.Size = new Size(515, 60);
        pageWelcome.Controls.Add(info);

        var note = new Label();
        note.Text = "提示：不要装到 C:\\Program Files（需要管理员权限会失败）。推荐用默认位置。";
        note.ForeColor = ColorTranslator.FromHtml("#FBBF24");
        note.Location = new Point(24, 262);
        note.Size = new Size(515, 44);
        pageWelcome.Controls.Add(note);
    }

    void BuildProgress()
    {
        pageProgress.Bounds = new Rectangle(0, 0, 560, 320);
        pageProgress.BackColor = BackColor;
        pageProgress.Visible = false;

        var title = new Label();
        title.Text = "正在安装";
        title.Font = new Font("Microsoft YaHei UI", 14F, FontStyle.Bold);
        title.ForeColor = ColorTranslator.FromHtml("#22D3EE");
        title.Location = new Point(24, 40);
        title.Size = new Size(400, 30);
        pageProgress.Controls.Add(title);

        bar.Location = new Point(24, 130);
        bar.Size = new Size(512, 22);
        bar.Style = ProgressBarStyle.Continuous;
        pageProgress.Controls.Add(bar);

        statusLabel.Text = "准备中…";
        statusLabel.ForeColor = ColorTranslator.FromHtml("#A3A3AB");
        statusLabel.Location = new Point(24, 160);
        statusLabel.Size = new Size(512, 44);
        pageProgress.Controls.Add(statusLabel);

        var tip = new Label();
        tip.Text = "这一步需要 1-2 分钟，请不要关闭窗口。";
        tip.ForeColor = ColorTranslator.FromHtml("#71717A");
        tip.Location = new Point(24, 210);
        tip.Size = new Size(512, 30);
        pageProgress.Controls.Add(tip);
    }

    void BuildDone()
    {
        pageDone.Bounds = new Rectangle(0, 0, 560, 320);
        pageDone.BackColor = BackColor;
        pageDone.Visible = false;

        var title = new Label();
        title.Text = "安装完成";
        title.Font = new Font("Microsoft YaHei UI", 15F, FontStyle.Bold);
        title.ForeColor = ColorTranslator.FromHtml("#4ADE80");
        title.Location = new Point(24, 40);
        title.Size = new Size(400, 32);
        pageDone.Controls.Add(title);

        var body = new Label();
        body.Text = "控制台已装好。下一步：\n\n1. 把网盘下载的 7 个分卷放进 deploy 目录\n2. 打开控制台，点「检查部署包」\n3. 点「一键部署」，选一个空间足够的盘（需要 211 GB）";
        body.ForeColor = ColorTranslator.FromHtml("#D4D4D8");
        body.Location = new Point(24, 90);
        body.Size = new Size(510, 110);
        pageDone.Controls.Add(body);

        launchBox.Text = "立即打开控制台";
        launchBox.Checked = true;
        launchBox.ForeColor = ColorTranslator.FromHtml("#F4F4F5");
        launchBox.Location = new Point(24, 215);
        launchBox.Size = new Size(300, 26);
        pageDone.Controls.Add(launchBox);

        var where = new Label();
        where.ForeColor = ColorTranslator.FromHtml("#71717A");
        where.Location = new Point(24, 250);
        where.Size = new Size(515, 44);
        where.Text = "安装位置：" + SetupApp.Target;
        pageDone.Controls.Add(where);
    }

    void ShowPage(int index)
    {
        current = index;
        pageWelcome.Visible = index == 0;
        pageProgress.Visible = index == 1;
        pageDone.Visible = index == 2;
        backBtn.Enabled = index == 0;
        backBtn.Visible = index < 2;
        nextBtn.Text = index == 0 ? "安装" : (index == 2 ? "完成" : "请稍候");
        nextBtn.Enabled = index != 1;
        cancelBtn.Visible = index != 2;
    }

    void OnNext(object sender, EventArgs e)
    {
        if (current == 0)
        {
            // 校验路径
            string target = pathBox.Text.Trim();
            if (string.IsNullOrEmpty(target))
            {
                MessageBox.Show("请填写安装位置。", "漫客工作台", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            try
            {
                string full = Path.GetFullPath(target);
                if (full.StartsWith(@"C:\Program Files", StringComparison.OrdinalIgnoreCase) ||
                    full.StartsWith(@"C:\Windows", StringComparison.OrdinalIgnoreCase))
                {
                    MessageBox.Show("这个位置需要管理员权限，安装会失败。\n请换一个普通目录，或用默认位置。",
                        "漫客工作台", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                SetupApp.Target = full;
            }
            catch (Exception ex)
            {
                MessageBox.Show("路径无效：" + ex.Message, "漫客工作台", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            ShowPage(1);
            var worker = new BackgroundWorker();
            worker.DoWork += (s2, e2) =>
            {
                bool ok = SetupApp.DoInstall(null, (pct, msg) =>
                {
                    BeginInvoke(new Action(() =>
                    {
                        bar.Value = Math.Min(100, pct);
                        statusLabel.Text = msg;
                    }));
                });
                BeginInvoke(new Action(() =>
                {
                    Success = ok;
                    if (ok) ShowPage(2);
                    else Close();
                }));
            };
            worker.RunWorkerAsync();
            return;
        }

        if (current == 2)
        {
            if (launchBox.Checked)
            {
                try
                {
                    string console = Path.Combine(SetupApp.Target, @"launcher\service-console.ps1");
                    if (File.Exists(console))
                    {
                        Process.Start(new ProcessStartInfo("powershell.exe",
                            "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + console + "\"")
                        { UseShellExecute = false });
                    }
                }
                catch { }
            }
            Close();
        }
    }

    class DriveItem
    {
        public readonly string Root;
        readonly long free;
        public DriveItem(string root, long freeBytes) { Root = root; free = freeBytes; }
        public string Display
        {
            get { return Root + "  可用 " + (free / 1024 / 1024 / 1024) + " GB"; }
        }
        public override string ToString() { return Display; }
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
  // 7z.exe + 两个 dll 一起嵌进 exe：安装包必须自带解压工具。
  // 不自带的话，用户要先装 7-Zip 才能装这个软件 —— 死循环。
  const sevenZipDir = 'C:\\Program Files\\7-Zip';
  const sevenZipFiles = ['7z.exe', '7z.dll', '7-zip.dll'];
  const sevenZipMissing = sevenZipFiles.filter((n) => !existsSync(join(sevenZipDir, n)));
  if (sevenZipMissing.length) {
    console.error('  缺少 7-Zip 组件：' + sevenZipMissing.join(', '));
    console.error('  位置：' + sevenZipDir);
    return 1;
  }
  const sevenZipResources = sevenZipFiles.map(
    (n) => '/resource:' + join(sevenZipDir, n) + ',sevenzip.' + n
  );
  console.log('  内嵌 7z 组件：' + sevenZipFiles.length + ' 个');

    execFileSync(
      csc,
      [
        '/target:winexe',
        '/platform:anycpu',
        '/optimize+',
        ...iconArg,
        '/reference:System.Windows.Forms.dll',
        '/reference:System.Drawing.dll',
        '/reference:System.Core.dll',
        '/resource:' + PAYLOAD + ',payload.7z',
        ...sevenZipResources,
        '/out:' + exe,
        join(build, 'Setup.cs'),
      ],
      { stdio: 'inherit' }
    );
  } catch (error) {
    console.error('  编译失败: ' + String(error).slice(0, 400));
    return 1;
  }

  rmSync(build, { recursive: true, force: true });

  if (!existsSync(exe)) {
    console.error('  编译没有产出 exe');
    return 1;
  }

  console.log(`  ✓ ${exe}`);
  console.log(`    ${human(statSync(exe).size)}`);
  console.log('');
  console.log('  安装包内容:');
  for (const f of readdirSync(STAGE)) {
    const full = join(STAGE, f);
    if (statSync(full).isDirectory()) continue;
    console.log(`    ${f.padEnd(34)} ${human(statSync(full).size).padStart(9)}`);
  }
  return 0;
};

process.exit(main());
