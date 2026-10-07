// The panel shown when the tray icon is clicked. Windows version of Sources/ListView.swift.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

class Theme
{
    public Color Bg, Text, Muted, Faint, Hover, Line, Field, Accent, AccentSoft, Copied;
    public bool Dark;
    /// Set only by the --render test mode.
    public static bool? ForceDark;

    public static Theme Current()
    {
        var dark = false;
        try
        {
            using (var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                dark = k != null && (k.GetValue("AppsUseLightTheme") as int?) == 0;
        }
        catch { }
        if (ForceDark != null) dark = ForceDark.Value;
        // Windows 11 flyout colors, and its default accent blue.
        return dark
            ? new Theme { Dark = true, Bg = C(0x2B2B2B), Text = C(0xFFFFFF), Muted = C(0xC8C8C8), Faint = C(0x8E8E8E), Hover = C(0x383838), Line = C(0x3D3D3D), Field = C(0x1F1F1F), Accent = C(0x4CC2FF), AccentSoft = C(0x253543), Copied = C(0x6CCB5F) }
            : new Theme { Bg = C(0xF9F9F9), Text = C(0x1B1B1B), Muted = C(0x5C5C5C), Faint = C(0x8A8A8A), Hover = C(0xEAEAEA), Line = C(0xE3E3E3), Field = C(0xFFFFFF), Accent = C(0x0067C0), AccentSoft = C(0xDDEAF6), Copied = C(0x0F7B0F) };
    }
    static Color C(int rgb) { return Color.FromArgb(255, (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255); }
}

/// A list box that does not flicker while owner-drawing.
class SmoothList : ListBox
{
    public SmoothList() { SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint, true); }
}

class Popup : Form
{
    const int PanelWidth = 380;
    // Past this height the list scrolls instead of growing.
    const int MaxListHeight = 520;
    // Row and day-header heights, used to size the list before it scrolls.
    const int RowHeight = 60;
    const int DayHeaderHeight = 26;
    // Clicking the tray icon while the panel is open first closes it (focus leaves), then the click
    // arrives. A click this soon after closing means "close", not "open again".
    const int ReopenGuardMs = 300;

    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)] static extern int SetWindowTheme(IntPtr hwnd, string app, string idList);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr hwnd, int msg, IntPtr w, string l);

    readonly string handoffDir;
    Theme theme;
    List<Handoff> all = new List<Handoff>();
    readonly List<object> items = new List<object>();  // string = day header, Handoff = row
    string copiedId;
    int hover = -1;
    int lastHide;
    public string UpdateVersion;
    public bool Packaged;

    readonly Label title = new Label(), subtitle = new Label(), empty = new Label(), updateText = new Label();
    readonly Panel updateBar = new Panel(), searchBox = new Panel(), footer = new Panel();
    readonly TextBox search = new TextBox();
    readonly SmoothList list = new SmoothList();
    readonly CheckBox atLogin = new CheckBox();
    readonly Label loginNote = new Label(), openFolder = new Label(), quit = new Label(), download = new Label();
    readonly ToolTip tip = new ToolTip();
    Font titleFont, rowTitleFont, metaFont, idFont, headerFont, iconFont;

    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);

    // Screen scale (1.25 at 125%). Form.DeviceDpi stays at 96 in .NET Framework apps without an
    // app.config switch, while fonts do scale, so the layout read the window's DPI directly.
    float scale = 1f;
    int Px(float v) { return (int)Math.Round(v * scale); }

    float CurrentScale()
    {
        try { var dpi = GetDpiForWindow(Handle); if (dpi > 0) return dpi / 96f; }
        catch (EntryPointNotFoundException) { }  // Windows 10 before 1607
        using (var g = CreateGraphics()) return g.DpiX / 96f;
    }

    public Popup(string handoffDir)
    {
        this.handoffDir = handoffDir;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        KeyPreview = true;
        Font = new Font("Segoe UI", 9f);
        titleFont = new Font("Segoe UI Semibold", 11f);
        rowTitleFont = new Font("Segoe UI Semibold", 10f);
        metaFont = new Font("Segoe UI", 8.5f);
        idFont = new Font("Consolas", 8f);
        headerFont = new Font("Segoe UI Semibold", 7.5f);
        iconFont = new Font("Segoe MDL2 Assets", 12f);

        title.Text = "Handoffs";
        subtitle.Text = "Click a chat to copy its handoff prompt.";
        empty.Text = "No handoffs yet. A chat shows up here a few minutes before its cache runs out.";
        loginNote.Text = "Starts with Windows. Change it in Task Manager > Startup apps.";
        atLogin.Text = "Open at login";
        openFolder.Text = "Open folder";
        quit.Text = "Quit";
        download.Text = "Download";
        foreach (var l in new[] { title, subtitle, empty, updateText, loginNote, openFolder, quit, download }) { l.AutoSize = false; l.UseMnemonic = false; }
        empty.TextAlign = ContentAlignment.TopLeft;
        openFolder.Cursor = quit.Cursor = download.Cursor = Cursors.Hand;
        download.TextAlign = ContentAlignment.MiddleCenter;
        tip.SetToolTip(openFolder, "Open the handoffs folder");

        search.BorderStyle = BorderStyle.None;
        searchBox.Controls.Add(search);
        searchBox.Paint += PaintSearchBox;
        updateBar.Controls.Add(updateText);
        updateBar.Controls.Add(download);
        footer.Controls.AddRange(new Control[] { atLogin, loginNote, openFolder, quit });
        footer.Paint += PaintFooterLine;

        list.BorderStyle = BorderStyle.None;
        list.DrawMode = DrawMode.OwnerDrawVariable;
        list.IntegralHeight = false;
        list.MeasureItem += MeasureRow;
        list.DrawItem += DrawRow;
        list.MouseMove += HoverRow;
        list.MouseLeave += LeaveList;
        list.MouseClick += ClickRow;

        Controls.AddRange(new Control[] { updateBar, title, subtitle, searchBox, list, empty, footer });

        search.TextChanged += SearchChanged;
        atLogin.CheckedChanged += LoginChanged;
        openFolder.Click += OpenFolderClicked;
        quit.Click += QuitClicked;
        download.Click += DownloadClicked;
        Deactivate += HideOnDeactivate;
        KeyDown += EscapeCloses;
    }

    protected override CreateParams CreateParams
    {
        get { var cp = base.CreateParams; cp.ClassStyle |= 0x20000; /* CS_DROPSHADOW */ return cp; }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // Windows 11 rounded corners (DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND).
        var round = 2;
        try { DwmSetWindowAttribute(Handle, 33, ref round, 4); } catch { }
    }

    public void Toggle()
    {
        if (Visible) { Hide(); return; }
        if (Environment.TickCount - lastHide < ReopenGuardMs) return;
        copiedId = null;
        search.Text = "";
        Reload();
        PlaceNearTray();
        Show();
        // Once shown, the window takes the scale of the screen it is on. Lay out and place it
        // again in case that screen differs from the one it was hidden on.
        Rebuild();
        PlaceNearTray();
        // The grey hint text needs the box's window to exist, so it is set after Show.
        SendMessage(search.Handle, 0x1501 /* EM_SETCUEBANNER */, (IntPtr)1, "Search chats");
        Activate();
        search.Focus();
    }

    public void Reload()
    {
        all = Handoff.Load(handoffDir);
        Rebuild();
    }

    void Rebuild()
    {
        theme = Theme.Current();
        // Row heights are measured when items are added, so the scale must be current first.
        scale = CurrentScale();
        var q = search.Text.Trim();
        var matches = q.Length == 0 ? all : all.Where(h =>
            h.Title.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0 ||
            h.Project.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0 ||
            h.Id.IndexOf(q, StringComparison.OrdinalIgnoreCase) >= 0).ToList();
        items.Clear();
        string lastDay = null;
        foreach (var h in matches.Take(Handoff.MaxRows))
        {
            var day = DayLabel(h.Date);
            if (day != lastDay) { items.Add(day); lastDay = day; }
            items.Add(h);
        }
        list.BeginUpdate();
        list.Items.Clear();
        foreach (var i in items) list.Items.Add(i);
        list.EndUpdate();
        empty.Text = all.Count == 0
            ? "No handoffs yet. A chat shows up here a few minutes before its cache runs out."
            : "No chats match “" + q + "”.";
        LayoutAll();
    }

    void LayoutAll()
    {
        var w = Px(PanelWidth);
        var pad = Px(16);
        BackColor = list.BackColor = theme.Bg;
        foreach (Control c in new Control[] { title, subtitle, empty, loginNote, openFolder, quit, atLogin }) c.BackColor = theme.Bg;
        title.ForeColor = theme.Text; title.Font = titleFont;
        subtitle.ForeColor = empty.ForeColor = loginNote.ForeColor = openFolder.ForeColor = quit.ForeColor = theme.Muted;
        atLogin.ForeColor = theme.Text;
        subtitle.Font = metaFont; loginNote.Font = metaFont;
        search.BackColor = theme.Field; search.ForeColor = theme.Text; searchBox.BackColor = theme.Bg;
        footer.BackColor = theme.Bg;
        if (IsHandleCreated) SetWindowTheme(list.Handle, theme.Dark ? "DarkMode_Explorer" : "Explorer", null);

        var y = 0;
        // Read back from these locals: a child reports Visible = false until the panel itself is shown.
        var showUpdate = !string.IsNullOrEmpty(UpdateVersion);
        updateBar.Visible = showUpdate;
        if (showUpdate)
        {
            updateBar.SetBounds(0, 0, w, Px(36));
            updateBar.BackColor = theme.AccentSoft;
            updateText.Text = "Version " + UpdateVersion + " is available";
            updateText.ForeColor = theme.Text; updateText.Font = rowTitleFont;
            updateText.SetBounds(pad, 0, w - pad * 2 - Px(96), Px(36)); updateText.TextAlign = ContentAlignment.MiddleLeft;
            download.SetBounds(w - pad - Px(90), Px(6), Px(90), Px(24));
            download.BackColor = theme.Accent; download.ForeColor = theme.Dark ? Color.Black : Color.White; download.Font = rowTitleFont;
            y = Px(36);
        }
        title.SetBounds(pad, y + Px(12), w - pad * 2, Px(24));
        subtitle.SetBounds(pad, y + Px(36), w - pad * 2, Px(18));
        y += Px(60);

        var showSearch = all.Count > 0;
        searchBox.Visible = showSearch;
        if (showSearch)
        {
            searchBox.SetBounds(Px(12), y, w - Px(24), Px(32));
            search.Font = new Font("Segoe UI", 10f);
            search.SetBounds(Px(32), (Px(32) - search.PreferredHeight) / 2, searchBox.Width - Px(44), search.PreferredHeight);
            y += Px(42);
        }

        var rows = items.Count(i => i is Handoff);
        var headers = items.Count - rows;
        var listH = Math.Min(Px(RowHeight) * rows + Px(DayHeaderHeight) * headers + Px(6), Px(MaxListHeight));
        var showList = rows > 0;
        list.Visible = showList;
        empty.Visible = !showList;
        if (showList) { list.SetBounds(Px(6), y + Px(1), w - Px(12), listH); y += listH + Px(2); }
        else { empty.SetBounds(pad, y + Px(12), w - pad * 2, Px(40)); y += Px(60); }

        var footH = Px(44);
        footer.SetBounds(0, y, w, footH);
        atLogin.Visible = !Packaged; loginNote.Visible = Packaged;
        atLogin.Checked = Startup.Enabled;
        atLogin.SetBounds(pad, Px(10), Px(140), Px(24));
        loginNote.SetBounds(pad, Px(6), w - pad - Px(130), Px(34));
        quit.SetBounds(w - pad - Px(34), Px(12), Px(34), Px(20));
        openFolder.SetBounds(w - pad - Px(34) - Px(84), Px(12), Px(80), Px(20));
        openFolder.TextAlign = quit.TextAlign = ContentAlignment.MiddleRight;
        ClientSize = new Size(w, y + footH);
        Invalidate(true);
    }

    void PlaceNearTray()
    {
        var c = Cursor.Position;
        var wa = Screen.FromPoint(c).WorkingArea;
        var gap = Px(10);
        var x = Math.Max(wa.Left + gap, Math.Min(c.X - Width / 2, wa.Right - Width - gap));
        int yy;
        if (c.Y >= wa.Bottom) yy = wa.Bottom - Height - gap;          // taskbar at the bottom
        else if (c.Y <= wa.Top) yy = wa.Top + gap;                     // taskbar at the top
        else yy = Math.Max(wa.Top + gap, Math.Min(c.Y - Height / 2, wa.Bottom - Height - gap));
        Location = new Point(x, yy);
    }

    void MeasureRow(object sender, MeasureItemEventArgs e)
    {
        e.ItemHeight = items[e.Index] is Handoff ? Px(RowHeight) : Px(DayHeaderHeight);
    }

    void DrawRow(object sender, DrawItemEventArgs e)
    {
        if (e.Index < 0 || e.Index >= items.Count) return;
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        using (var bg = new SolidBrush(theme.Bg)) g.FillRectangle(bg, e.Bounds);
        var r = e.Bounds;
        var header = items[e.Index] as string;
        if (header != null)
        {
            TextRenderer.DrawText(g, header.ToUpperInvariant(), headerFont, new Rectangle(r.X + Px(10), r.Y, r.Width, r.Height - Px(4)), theme.Faint, TextFormatFlags.Bottom | TextFormatFlags.Left);
            return;
        }
        var h = (Handoff)items[e.Index];
        if (e.Index == hover)
            using (var path = Rounded(new Rectangle(r.X + Px(2), r.Y + Px(2), r.Width - Px(4), r.Height - Px(4)), Px(8)))
            using (var hb = new SolidBrush(theme.Hover)) g.FillPath(hb, path);
        var copied = h.Id == copiedId;
        // Segoe MDL2 Assets: E8BD is a chat bubble, E73E a check mark.
        TextRenderer.DrawText(g, copied ? "" : "", iconFont, new Point(r.X + Px(10), r.Y + Px(9)), copied ? theme.Copied : theme.Accent);
        var left = r.X + Px(40);
        var width = r.Width - Px(48);
        var flags = TextFormatFlags.Left | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine;
        TextRenderer.DrawText(g, h.Title, rowTitleFont, new Rectangle(left, r.Y + Px(7), width, Px(20)), theme.Text, flags);
        var meta = copied ? "Copied to clipboard" : string.Join("  ·  ", new[] { h.Project, Ago(h.Date) }.Where(s => s.Length > 0).ToArray());
        TextRenderer.DrawText(g, meta, metaFont, new Rectangle(left, r.Y + Px(27), width, Px(16)), copied ? theme.Copied : theme.Muted, flags);
        TextRenderer.DrawText(g, h.Id, idFont, new Rectangle(left, r.Y + Px(42), width, Px(15)), theme.Faint, flags);
    }

    static GraphicsPath Rounded(Rectangle r, int radius)
    {
        var p = new GraphicsPath();
        var d = radius * 2;
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    void PaintSearchBox(object sender, PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using (var path = Rounded(new Rectangle(0, 0, searchBox.Width - 1, searchBox.Height - 1), Px(8)))
        using (var fill = new SolidBrush(theme.Field))
        using (var edge = new Pen(theme.Line))
        { g.FillPath(fill, path); g.DrawPath(edge, path); }
        // Segoe MDL2 Assets E721 is a magnifying glass.
        TextRenderer.DrawText(g, "", new Font("Segoe MDL2 Assets", 9f), new Point(Px(10), (searchBox.Height - Px(14)) / 2), theme.Faint);
    }

    void PaintFooterLine(object sender, PaintEventArgs e)
    {
        using (var pen = new Pen(theme.Line)) e.Graphics.DrawLine(pen, 0, 0, footer.Width, 0);
    }

    void HoverRow(object sender, MouseEventArgs e)
    {
        var i = list.IndexFromPoint(e.Location);
        if (i == hover) return;
        hover = i;
        list.Invalidate();
        var h = i >= 0 && i < items.Count ? items[i] as Handoff : null;
        list.Cursor = h != null ? Cursors.Hand : Cursors.Default;
        tip.SetToolTip(list, h == null ? "" : (h.LastRequest.Length == 0 ? "Click to copy" : "Last ask: " + h.LastRequest));
    }

    void LeaveList(object sender, EventArgs e) { hover = -1; list.Invalidate(); }

    void ClickRow(object sender, MouseEventArgs e)
    {
        var i = list.IndexFromPoint(e.Location);
        var h = i >= 0 && i < items.Count ? items[i] as Handoff : null;
        if (h == null) return;
        try { Clipboard.SetText(h.CopyText()); } catch (Exception) { return; }
        copiedId = h.Id;
        list.Invalidate();
    }

    void SearchChanged(object sender, EventArgs e) { Rebuild(); }
    void LoginChanged(object sender, EventArgs e) { if (atLogin.Checked != Startup.Enabled) Startup.Enabled = atLogin.Checked; }

    void OpenFolderClicked(object sender, EventArgs e)
    {
        Directory.CreateDirectory(handoffDir);
        Process.Start("explorer.exe", "\"" + handoffDir + "\"");
    }

    void QuitClicked(object sender, EventArgs e) { Application.Exit(); }
    // Opens the release page; the download replaces this copy of the app.
    void DownloadClicked(object sender, EventArgs e) { Process.Start(Updates.ReleasePage); }
    void HideOnDeactivate(object sender, EventArgs e) { Hide(); lastHide = Environment.TickCount; }
    void EscapeCloses(object sender, KeyEventArgs e) { if (e.KeyCode == Keys.Escape) Hide(); }

    static string DayLabel(DateTime d)
    {
        if (d.Date == DateTime.Today) return "Today";
        if (d.Date == DateTime.Today.AddDays(-1)) return "Yesterday";
        return d.ToString("dddd, MMM d", CultureInfo.InvariantCulture);
    }

    static string Ago(DateTime d)
    {
        var s = (DateTime.Now - d).TotalSeconds;
        if (s < 60) return Math.Max(0, (int)s) + " sec. ago";
        if (s < 3600) return (int)(s / 60) + " min. ago";
        if (s < 86400) return (int)(s / 3600) + " hr. ago";
        var days = (int)(s / 86400);
        return days + (days == 1 ? " day ago" : " days ago");
    }

    /// Draws the panel for a folder of handoffs into a PNG. Used to check the layout without a desktop.
    public static void RenderSample(string dir, string png, bool dark, string copied, string update)
    {
        Theme.ForceDark = dark;
        var p = new Popup(dir) { UpdateVersion = update };
        var h = p.Handle;
        p.Reload();
        p.copiedId = copied;
        p.Location = new Point(-5000, -5000);
        p.Show();
        Application.DoEvents();
        using (var bmp = new Bitmap(p.Width, p.Height))
        {
            p.DrawToBitmap(bmp, new Rectangle(0, 0, p.Width, p.Height));
            bmp.Save(png);
        }
        p.Close();
    }
}
