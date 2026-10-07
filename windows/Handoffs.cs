// Reads the handoff files for the panel. Windows port of Sources/Handoffs.swift.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

class Handoff
{
    // More than a day of busy work. Search still finds older handoffs.
    public const int MaxRows = 100;
    // Claude Code appends a rename to the end of the chat file. If many replies follow it,
    // the chat's cache refreshes and a new handoff carries the new name anyway.
    const int RenameTailBytes = 64 * 1024;

    public string Id, FilePath, Title, Project, LastRequest;
    public DateTime Date;
    /// True when the tab was renamed after the handoff was written.
    public bool Renamed;
    public bool FromTempFolder;

    public Handoff(string path)
    {
        FilePath = path;
        Date = File.GetLastWriteTime(path);
        Id = Path.GetFileNameWithoutExtension(path);
        string text;
        try { text = File.ReadAllText(path, Encoding.UTF8); } catch { text = ""; }
        var lines = text.Split('\n');
        // Line 1 is "# Handoff: <title>". A chat with no title gets its id there.
        var raw = lines[0].Replace("# Handoff: ", "").TrimEnd('\r');
        var chatLine = lines.FirstOrDefault(l => l.StartsWith("- Old chat file: "));
        var latest = chatLine == null ? null : LatestCustomTitle(chatLine.Substring(17).TrimEnd('\r'));
        if (latest != null && latest != raw) { Title = latest; Renamed = true; }
        else Title = raw.Length == 0 || raw == Id ? "Untitled chat" : raw;

        var folderLine = lines.FirstOrDefault(l => l.StartsWith("- Folder: "));
        var folder = folderLine == null ? "" : folderLine.Substring(10).TrimEnd('\r');
        // Chats started in a temp folder are scripts running Claude Code, not the user's chats.
        FromTempFolder = folder.Length == 0
            || folder.StartsWith(Path.GetTempPath().TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)
            || folder.IndexOf(@"\AppData\Local\Temp", StringComparison.OrdinalIgnoreCase) >= 0
            || folder.StartsWith("/private/var/folders/") || folder.StartsWith("/tmp");
        Project = FromTempFolder ? "" : Path.GetFileName(folder.TrimEnd('\\', '/'));
        // The last numbered line under "Recent requests" is the newest ask. Shown on hover.
        LastRequest = lines.SkipWhile(l => !l.StartsWith("## Recent requests")).Skip(1)
            .TakeWhile(l => !l.StartsWith("## ")).LastOrDefault(l => l.Length > 0 && char.IsDigit(l[0])) ?? "";
    }

    /// The newest tab name in the end of a chat file, if the user renamed the tab.
    static string LatestCustomTitle(string chat)
    {
        try
        {
            using (var fs = new FileStream(chat, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                var start = Math.Max(0, fs.Length - RenameTailBytes);
                fs.Seek(start, SeekOrigin.Begin);
                var buf = new byte[fs.Length - start];
                var read = 0;
                while (read < buf.Length) { var n = fs.Read(buf, read, buf.Length - read); if (n == 0) break; read += n; }
                foreach (var line in Encoding.UTF8.GetString(buf, 0, read).Split('\n').Reverse())
                {
                    if (!line.Contains("\"custom-title\"")) continue;
                    var o = Json.Parse(line);
                    var t = Json.Str(o, "customTitle");
                    if (Json.Str(o, "type") == "custom-title" && !string.IsNullOrEmpty(t)) return t;
                }
            }
        }
        catch { }
        return null;
    }

    /// Newest first. Handoffs from temp-folder helper chats are left out.
    public static List<Handoff> Load(string dir)
    {
        if (!Directory.Exists(dir)) return new List<Handoff>();
        return Directory.GetFiles(dir, "*.md").Select(p => new Handoff(p))
            .Where(h => !h.FromTempFolder).OrderByDescending(h => h.Date).ToList();
    }

    /// The handoff text to copy, with the tab's current name if it was renamed after writing.
    public string CopyText()
    {
        var text = File.ReadAllText(FilePath, Encoding.UTF8);
        if (!Renamed) return text;
        var nl = text.IndexOf('\n');
        return nl < 0 ? text : "# Handoff: " + Title + text.Substring(nl);
    }
}
