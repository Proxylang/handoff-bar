// HandoffBar for Windows: a tray icon that lists Claude Code chat handoffs.
// Writes a handoff when a chat's prompt cache is about to expire; click a row to copy it.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("HandoffBar")]
[assembly: AssemblyProduct("HandoffBar")]
[assembly: AssemblyCompany("Proxylang")]
[assembly: AssemblyDescription("Saves a handoff prompt before a Claude Code chat's cache expires.")]
[assembly: AssemblyVersion(App.Version + ".0")]
[assembly: AssemblyFileVersion(App.Version + ".0")]

static class App
{
    // Shares version numbers with VERSION in build.sh; one GitHub release carries both builds.
    public const string Version = "1.4.1";

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern int GetCurrentPackageFullName(ref int length, StringBuilder name);

    /// True when installed from the Microsoft Store (MSIX). The Store handles updates and start-at-login then.
    public static bool Packaged()
    {
        try { var len = 0; return GetCurrentPackageFullName(ref len, null) != 15700; /* APPMODEL_ERROR_NO_PACKAGE */ }
        catch (EntryPointNotFoundException) { return false; }
    }

    [STAThread]
    static int Main(string[] args)
    {
        // Test modes, used by build.ps1: write one handoff, or draw the panel to a PNG.
        if (args.Length == 3 && args[0] == "--write") return Writer.WriteHandoff(args[1], args[2]) ? 0 : 1;
        if (args.Length >= 3 && args[0] == "--render")
        {
            Application.EnableVisualStyles();
            Popup.RenderSample(args[1], args[2], args.Contains("--dark"), args.Length > 3 && !args[3].StartsWith("--") ? args[3] : null,
                args.Contains("--update") ? "9.9.9" : null);
            return 0;
        }

        bool first;
        using (new Mutex(true, @"Local\HandoffBar", out first))
        {
            if (!first) return 0;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Tray());
        }
        return 0;
    }
}

class Tray : ApplicationContext
{
    readonly NotifyIcon icon = new NotifyIcon();
    readonly Popup popup = new Popup(Paths.Handoffs);
    readonly ToolStripMenuItem atLogin = new ToolStripMenuItem("Start with Windows");
    readonly bool packaged = App.Packaged();

    public Tray()
    {
        popup.Packaged = packaged;
        var handle = popup.Handle;  // create the window now so other threads can post to it

        // A plain orange hand: the app icon's tile shrinks to nothing at tray size.
        using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Tray.ico"))
            // The in-memory test build (test-run.ps1) has no embedded icon; it reads the file instead.
            icon.Icon = s != null ? new Icon(s, SystemInformation.SmallIconSize)
                : new Icon(Path.Combine(Environment.CurrentDirectory, "Tray.ico"), SystemInformation.SmallIconSize);
        icon.Text = "HandoffBar: chat handoffs";
        icon.MouseClick += Clicked;
        var menu = new ContextMenuStrip();
        menu.Items.Add("Show handoffs", null, ShowClicked);
        menu.Items.Add("Open handoffs folder", null, FolderClicked);
        atLogin.Click += AtLoginClicked;
        menu.Items.Add(atLogin);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit HandoffBar", null, QuitClicked);
        // Read each time: the user can also change it in Task Manager or the popup.
        menu.Opening += MenuOpening;
        icon.ContextMenuStrip = menu;
        icon.Visible = true;

        Writer.Start(Written);
        // The Store updates packaged copies itself.
        if (!packaged) Updates.Start(Found);
    }

    void Written() { popup.BeginInvoke(new Action(popup.Reload)); }
    void Found(string version) { popup.BeginInvoke(new Action(delegate { popup.UpdateVersion = version; if (popup.Visible) popup.Reload(); })); }
    void Clicked(object sender, MouseEventArgs e) { if (e.Button == MouseButtons.Left) popup.Toggle(); }
    void ShowClicked(object sender, EventArgs e) { if (!popup.Visible) popup.Toggle(); }

    void FolderClicked(object sender, EventArgs e)
    {
        Directory.CreateDirectory(Paths.Handoffs);
        Process.Start("explorer.exe", "\"" + Paths.Handoffs + "\"");
    }

    bool StartsAtLogin { get { return packaged ? StoreStartup.Enabled : Startup.Enabled; } }

    void MenuOpening(object sender, System.ComponentModel.CancelEventArgs e) { atLogin.Checked = StartsAtLogin; }

    void AtLoginClicked(object sender, EventArgs e)
    {
        var on = !StartsAtLogin;
        if (packaged) StoreStartup.Enabled = on; else Startup.Enabled = on;
        // Windows does not let a Store app turn its startup back on after the user turned it off in Task Manager.
        if (on && !StartsAtLogin)
            icon.ShowBalloonTip(8000, "HandoffBar", "Startup was turned off in Task Manager. Turn it on there: Task Manager > Startup apps > HandoffBar.", ToolTipIcon.Info);
    }

    void QuitClicked(object sender, EventArgs e) { icon.Visible = false; Application.Exit(); }

    protected override void Dispose(bool disposing)
    {
        if (disposing) icon.Dispose();
        base.Dispose(disposing);
    }
}

/// Start at login for the downloaded (unpackaged) app: a value under the user's Run key.
/// The Store version declares a startup task in its package instead.
static class Startup
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string Name = "HandoffBar";

    public static bool Enabled
    {
        get
        {
            try { using (var k = Registry.CurrentUser.OpenSubKey(RunKey)) return k != null && k.GetValue(Name) != null; }
            catch { return false; }
        }
        set
        {
            try
            {
                using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
                {
                    if (value) k.SetValue(Name, "\"" + Application.ExecutablePath + "\"");
                    else k.DeleteValue(Name, false);
                }
            }
            catch { }
        }
    }
}

/// Start at login for the Store app: the startup task declared in package/AppxManifest.xml.
/// Names are written in full: a using line for Windows.Foundation would clash with System.Drawing's Point and Size.
static class StoreStartup
{
    const string TaskId = "HandoffBarStartup";

    // Waits by polling: the AsTask helper needs the Windows SDK's Windows.winmd, which build.ps1 does not have.
    static T Wait<T>(Windows.Foundation.IAsyncOperation<T> op)
    {
        while (op.Status == Windows.Foundation.AsyncStatus.Started) Thread.Sleep(10);
        return op.GetResults();
    }

    public static bool Enabled
    {
        get
        {
            try
            {
                var state = Wait(Windows.ApplicationModel.StartupTask.GetAsync(TaskId)).State;
                return state == Windows.ApplicationModel.StartupTaskState.Enabled || state == Windows.ApplicationModel.StartupTaskState.EnabledByPolicy;
            }
            catch { return false; }
        }
        set
        {
            try
            {
                var task = Wait(Windows.ApplicationModel.StartupTask.GetAsync(TaskId));
                if (value) Wait(task.RequestEnableAsync()); else task.Disable();
            }
            catch { }
        }
    }
}

/// The line that installs the HandoffBar mod (mod/ in this repo), typed at the Claude Code prompt.
/// A slash command is not sent to Claude, so pasting it costs nothing.
static class ModLine
{
    public const string InstallLine = "/plugin install handoffbar --marketplace Proxylang/handoff-bar";
    const string Key = @"Software\HandoffBar";
    const string Name = "ModLineCopied";

    /// The line was copied once. The popup's mod bar then stays hidden from the next opening on.
    public static bool Copied
    {
        get
        {
            try { using (var k = Registry.CurrentUser.OpenSubKey(Key)) return k != null && k.GetValue(Name) != null; }
            catch { return false; }
        }
        set
        {
            try { using (var k = Registry.CurrentUser.CreateSubKey(Key)) { if (value) k.SetValue(Name, 1); else k.DeleteValue(Name, false); } }
            catch { }
        }
    }
}

/// Checks GitHub once a day for a newer release that has a Windows download.
/// This is the app's only network request. It sends nothing about the user or their chats.
static class Updates
{
    const string LatestReleaseApi = "https://api.github.com/repos/Proxylang/handoff-bar/releases/latest";
    public const string ReleasePage = "https://github.com/Proxylang/handoff-bar/releases/latest";
    const string WindowsAsset = "HandoffBar-Windows.zip";
    // Once a day is enough for an app that ships a few times a month.
    const int CheckIntervalMs = 24 * 3600 * 1000;
    const int RequestTimeoutMs = 15000;

    static System.Threading.Timer timer;

    public static void Start(Action<string> onNewVersion)
    {
        timer = new System.Threading.Timer(delegate { Check(onNewVersion); }, null, 0, CheckIntervalMs);
    }

    /// True when candidate ("v1.4.0" or "1.4.0") is a higher version than current.
    public static bool IsNewer(string candidate, string current)
    {
        Func<string, int[]> parts = v => v.Trim('v', 'V').Split('.').Select(p => { int n; return int.TryParse(p, out n) ? n : 0; }).ToArray();
        var a = parts(candidate); var b = parts(current);
        for (var i = 0; i < Math.Max(a.Length, b.Length); i++)
        {
            var x = i < a.Length ? a[i] : 0; var y = i < b.Length ? b[i] : 0;
            if (x != y) return x > y;
        }
        return false;
    }

    static void Check(Action<string> onNewVersion)
    {
        try
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            var req = (HttpWebRequest)WebRequest.Create(LatestReleaseApi);
            // GitHub rejects API requests without a User-Agent.
            req.UserAgent = "HandoffBar/" + App.Version;
            req.Accept = "application/vnd.github+json";
            req.Timeout = RequestTimeoutMs;
            string body;
            using (var res = req.GetResponse())
            using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8)) body = r.ReadToEnd();
            var json = Json.Parse(body);
            var tag = Json.Str(json, "tag_name") ?? "";
            var hasWindows = Json.List(Json.Get(json, "assets")).Any(a => Json.Str(a, "name") == WindowsAsset);
            if (hasWindows && IsNewer(tag, App.Version)) onNewVersion(tag.Trim('v', 'V'));
        }
        // Offline or rate-limited: say nothing and try again tomorrow.
        catch (Exception) { }
    }
}
