// Writes a handoff file for each Claude Code chat whose prompt cache is about to expire.
// Windows port of Sources/Writer.swift. Same rules, same Markdown, so both apps write identical handoffs.
// No model call, no network, no commands run: everything comes from the chat files in .claude\projects.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

static class Paths
{
    public static readonly string Home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    public static readonly string Claude = Path.Combine(Home, ".claude");
    public static readonly string Projects = Path.Combine(Claude, "projects");
    public static readonly string Handoffs = Path.Combine(Claude, "handoffs");
}

static class Json
{
    static readonly JavaScriptSerializer Ser = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 512 };

    public static Dictionary<string, object> Parse(string line)
    {
        try { return Ser.DeserializeObject(line) as Dictionary<string, object>; } catch { return null; }
    }
    public static object Get(Dictionary<string, object> d, string key)
    {
        object v; return d != null && d.TryGetValue(key, out v) ? v : null;
    }
    public static string Str(Dictionary<string, object> d, string key) { return Get(d, key) as string; }
    public static Dictionary<string, object> Dict(Dictionary<string, object> d, string key) { return Get(d, key) as Dictionary<string, object>; }
    public static bool True(Dictionary<string, object> d, string key) { return Get(d, key) is bool && (bool)Get(d, key); }
    public static long Num(Dictionary<string, object> d, string key)
    {
        var v = Get(d, key);
        try { return v == null ? 0 : Convert.ToInt64(v); } catch { return 0; }
    }
    public static IEnumerable<Dictionary<string, object>> List(object v)
    {
        var a = v as object[];
        if (a == null) yield break;
        foreach (var o in a) { var d = o as Dictionary<string, object>; if (d != null) yield return d; }
    }
}

static class Writer
{
    // How often to check the chat files. One minute is fine-grained enough for a 2-5 minute warning.
    const int ScanIntervalMs = 60 * 1000;
    // The longest cache Anthropic offers. A chat file untouched for longer has no live cache.
    const double LongestCacheSeconds = 3600;
    // Chats with a 5-minute cache (Pro, API) get a shorter warning than 1-hour chats (Max),
    // or the handoff would be written the moment each reply lands.
    static double WarnSeconds(double cache) { return cache >= LongestCacheSeconds ? 300 : 120; }
    // Enough of the file end to hold the last few replies and their cache usage.
    const int TailBytes = 512 * 1024;
    // Claude Code names a chat's project folder after its working folder. These are temp folders,
    // used by scripts that run helper chats. Those are not the user's chats.
    public static bool IsTempProject(string folderName)
    {
        return folderName.Contains("-AppData-Local-Temp") || folderName.StartsWith("-private-var-folders-")
            || folderName.StartsWith("-private-tmp") || folderName.StartsWith("-tmp");
    }

    // Recent prompts show where the chat is heading. Ten is enough without bloat.
    const int RecentPrompts = 10;
    // Cut each prompt so one pasted log cannot fill the file.
    const int PromptChars = 500;
    const int LastReplyChars = 1500;
    const int MaxFiles = 40;
    // Claude's own summary of a chat that ran out of room. Long chats produce ~20,000 characters;
    // the first part holds the goal and decisions, the rest is detail the new chat can read itself.
    const int SummaryChars = 8000;
    // A reply this short is an answer to a choice ("A", "2"). Longer answers must start like one.
    const int DecisionAnswerChars = 3;
    const int MaxDecisions = 8;
    const int QuestionChars = 200;
    // "Pick one:" is followed by the options; keep that many so the answer makes sense.
    const int MaxOptions = 4;
    const int OptionChars = 140;
    const int MaxBackgroundCommands = 6;
    const int CommandChars = 160;
    const int MaxNextSteps = 10;
    // An error followed by more tool results than this was most likely fixed already.
    const int RecentErrorWindow = 3;
    const int ErrorChars = 600;

    static System.Threading.Timer timer;
    // Chat file path -> the last request a handoff was written for. A new reply re-arms the chat.
    static readonly Dictionary<string, DateTime> written = new Dictionary<string, DateTime>();

    public static void Start(Action onWrite)
    {
        timer = new System.Threading.Timer(delegate { if (Scan()) onWrite(); }, null, 0, ScanIntervalMs);
    }

    static bool Scan()
    {
        var now = DateTime.UtcNow;
        var wrote = false;
        if (!Directory.Exists(Paths.Projects)) return false;
        foreach (var dir in Directory.GetDirectories(Paths.Projects))
        {
            var name = Path.GetFileName(dir);
            if (IsTempProject(name)) continue;
            // Top-level chat files only. Subagent files sit in subfolders.
            foreach (var chat in Directory.GetFiles(dir, "*.jsonl"))
            {
                try
                {
                    if ((now - File.GetLastWriteTimeUtc(chat)).TotalSeconds >= LongestCacheSeconds) continue;
                    DateTime last; double cache;
                    if (!CacheState(chat, out last, out cache)) continue;
                    var left = (last.AddSeconds(cache) - now).TotalSeconds;
                    DateTime done;
                    if (left <= 0 || left > WarnSeconds(cache) || (written.TryGetValue(chat, out done) && done == last)) continue;
                    written[chat] = last;
                    if (WriteHandoff(chat, Paths.Handoffs)) wrote = true;
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
        }
        return wrote;
    }

    static string[] ReadTailLines(string path, int bytes)
    {
        using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        {
            var start = Math.Max(0, fs.Length - bytes);
            fs.Seek(start, SeekOrigin.Begin);
            var buf = new byte[fs.Length - start];
            var read = 0;
            while (read < buf.Length) { var n = fs.Read(buf, read, buf.Length - read); if (n == 0) break; read += n; }
            var lines = Encoding.UTF8.GetString(buf, 0, read).Split('\n');
            // The first line is cut in half when reading from the middle of the file.
            return start > 0 ? lines.Skip(1).ToArray() : lines;
        }
    }

    /// Time of the last reply and the chat's cache length, read from the end of the chat file.
    /// The API reports which cache a request wrote: ephemeral_1h_input_tokens or ephemeral_5m_input_tokens.
    public static bool CacheState(string chat, out DateTime lastRequest, out double cache)
    {
        lastRequest = DateTime.MinValue; cache = 0;
        var found = false;
        double? seen = null;
        foreach (var line in ReadTailLines(chat, TailBytes).Reverse())
        {
            if (!line.Contains("\"assistant\"")) continue;
            var o = Json.Parse(line);
            if (Json.Str(o, "type") != "assistant" || Json.True(o, "isSidechain")) continue;
            DateTime ts;
            if (!found && DateTime.TryParse(Json.Str(o, "timestamp"), null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out ts))
            { lastRequest = ts; found = true; }
            var created = Json.Dict(Json.Dict(Json.Dict(o, "message"), "usage"), "cache_creation");
            if (seen == null && Json.Num(created, "ephemeral_1h_input_tokens") > 0) seen = 3600;
            else if (seen == null && Json.Num(created, "ephemeral_5m_input_tokens") > 0) seen = 300;
            if (found && seen != null) break;
        }
        // No cache write in the file end means only cache reads. The default API cache is 5 minutes.
        cache = seen ?? 300;
        return found;
    }

    // Blocks the harness adds to user messages. They are not the user's words.
    static readonly Regex HarnessBlocks = new Regex(@"<(system-reminder|browser_instruction|local-command-caveat)>.*?</\1>", RegexOptions.Singleline);
    // Skill bodies and background-task events arrive as user messages but are not the user's words.
    static readonly string[] NotUserPrefixes = { "[Request interrupted", "Base directory for this skill", "<task-notification>" };

    static string BlockText(object content)
    {
        var s = content as string;
        if (s != null) return s;
        return string.Join("\n", Json.List(content).Select(b => Json.Str(b, "text")).Where(t => t != null).ToArray());
    }

    static string UserText(Dictionary<string, object> o)
    {
        var content = Json.Get(Json.Dict(o, "message"), "content");
        string joined;
        if (content is string) joined = (string)content;
        else joined = string.Join("\n", Json.List(content).Where(b => Json.Str(b, "type") == "text").Select(b => Json.Str(b, "text") ?? "").ToArray());
        var text = HarnessBlocks.Replace(joined, "").Trim();
        if (text.Length == 0 || NotUserPrefixes.Any(p => text.StartsWith(p)) || text.Contains("[SYSTEM NOTIFICATION")) return "";
        return text;
    }

    static string Cut(string s, int n)
    {
        if (s.Length <= n) return s;
        if (char.IsHighSurrogate(s[n - 1])) n--;
        return s.Substring(0, n) + " ...";
    }

    static string[] Lines(string s) { return s.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries); }
    static string OneLine(string s) { return string.Join(" ", Lines(s)).Trim(); }

    // A line that asks the user to choose: ends in "?", or says pick / choose / which / reply "X" or "Y".
    static readonly Regex QuestionLine = new Regex(@"\?[*_]*\s*$|\b(pick one|choose|which one)\b|reply\s+[""“][^""”]{1,20}[""”]\s+or\b", RegexOptions.IgnoreCase);
    // A heading that starts a list of next steps.
    static readonly Regex NextStepsHeading = new Regex(@"^[#*\s]*(next steps?|what you need to do next|to-?do)\b", RegexOptions.IgnoreCase);
    static readonly Regex ListItem = new Regex(@"^\s*([-*•]|\d+[.)])\s+");
    // Starts like an answer to a choice: "A", "2", "yes", "B, please", "option 1".
    static readonly Regex AnswerStart = new Regex(@"^\s*(option\s*)?([a-d]|[1-5]|yes|yep|yeah|no|nope|ok|okay|sure|both|neither)\b", RegexOptions.IgnoreCase);
    // "A. Wait.", "**B. Build it now.**", "- **A.** ...": a lettered option.
    static readonly Regex LetteredOption = new Regex(@"^\s*(-\s+)?(\*\*)?[A-D][.):](\*\*)?\s");

    static string Plain(string line)
    {
        return Regex.Replace(line, @"^\s*([-*•]|\d+[.)])\s+", "").Replace("**", "").Trim();
    }

    /// The last line in a reply that asks the user to choose. Options listed right under it
    /// ("Pick one:", "How should I land it?") come along.
    static string Question(string reply)
    {
        var lines = Lines(reply);
        // Quoted lines are drafts shown to the user, not questions to them.
        var asks = Enumerable.Range(0, lines.Length).Where(i => !lines[i].StartsWith(">") && QuestionLine.IsMatch(lines[i])).ToList();
        if (asks.Count == 0) return null;
        Func<int, List<string>> optionsAfter = i => lines.Skip(i + 1).TakeWhile(l => ListItem.IsMatch(l)).Take(MaxOptions).ToList();
        // "Pick one:" with its options beats a later bare "Reply A or B" that only points back at them.
        var withOptions = asks.Where(i => optionsAfter(i).Count > 0).ToList();
        var at = withOptions.Count > 0 ? withOptions.Last() : asks.Last();
        var found = optionsAfter(at);
        // A bare "Reply A or B": the lettered options are elsewhere in the reply.
        if (found.Count == 0) found = lines.Where(l => LetteredOption.IsMatch(l)).Take(MaxOptions).ToList();
        return Cut(Plain(lines[at]), QuestionChars) + string.Concat(found.Select(o => "\n    - " + Cut(Plain(o), OptionChars)));
    }

    static bool IsAnswer(string text)
    {
        return text.Length <= DecisionAnswerChars || (text.Length <= 80 && AnswerStart.IsMatch(text));
    }

    /// The list under a "Next steps" style heading in a reply.
    static List<string> NextSteps(string reply)
    {
        var lines = Lines(reply);
        var start = Array.FindLastIndex(lines, l => NextStepsHeading.IsMatch(l));
        if (start < 0) return new List<string>();
        return lines.Skip(start + 1).TakeWhile(l => ListItem.IsMatch(l)).Take(MaxNextSteps).ToList();
    }

    /// Builds <outDir>\<chat id>.md. Returns false if the file could not be read or written.
    public static bool WriteHandoff(string chat, string outDir)
    {
        string[] all;
        try
        {
            using (var fs = new FileStream(chat, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var r = new StreamReader(fs, Encoding.UTF8))
                all = r.ReadToEnd().Split('\n');
        }
        catch { return false; }

        string title = "", customTitle = "", cwd = "", branch = "", lastReply = "", summary = "";
        var prompts = new List<string>();
        var files = new List<string>();  // oldest first, each path once
        var decisions = new List<string>();
        var background = new List<string>();
        var commands = new Dictionary<string, string>();  // tool use id -> what it ran
        string lastError = "";
        var resultsSinceError = int.MaxValue;

        foreach (var line in all)
        {
            var o = Json.Parse(line);
            if (o == null) continue;
            var sidechain = Json.True(o, "isSidechain");
            var type = Json.Str(o, "type");
            if (type == "ai-title") title = Json.Str(o, "aiTitle") ?? title;
            // The name the user typed when renaming the tab. Beats the AI title.
            else if (type == "custom-title") customTitle = Json.Str(o, "customTitle") ?? customTitle;
            else if (type == "user" && !sidechain)
            {
                // First folder, not the last: the chat may cd into a subfolder later.
                if (cwd.Length == 0) cwd = Json.Str(o, "cwd") ?? "";
                if (branch.Length == 0) branch = Json.Str(o, "gitBranch") ?? "";
                var content = Json.Get(Json.Dict(o, "message"), "content");
                if (Json.True(o, "isCompactSummary"))
                {
                    // Claude Code's own summary, written when the chat ran out of room.
                    summary = BlockText(content);
                    continue;
                }
                foreach (var b in Json.List(content).Where(b => Json.Str(b, "type") == "tool_result"))
                {
                    if (resultsSinceError != int.MaxValue) resultsSinceError++;
                    if (!Json.True(b, "is_error")) continue;
                    var text = BlockText(Json.Get(b, "content"));
                    // The user turning down a tool call is a choice, not a failure.
                    if (text.Contains("doesn't want to proceed")) continue;
                    string what;
                    var id = Json.Str(b, "tool_use_id") ?? "";
                    lastError = (commands.TryGetValue(id, out what) ? what + "\n" : "") + Cut(text.Trim(), ErrorChars);
                    resultsSinceError = 0;
                }
                var said = UserText(o);
                if (said.Length == 0) continue;
                prompts.Add(said);
                string q;
                if (IsAnswer(said) && (q = Question(lastReply)) != null)
                {
                    var entry = "- Asked: " + q + "\n  Answer: " + OneLine(said);
                    // A message sent twice is one choice.
                    if (decisions.Count == 0 || decisions.Last() != entry) decisions.Add(entry);
                }
            }
            else if (type == "assistant" && !sidechain)
            {
                foreach (var b in Json.List(Json.Get(Json.Dict(o, "message"), "content")))
                {
                    var input = Json.Dict(b, "input");
                    var btype = Json.Str(b, "type");
                    var t = Json.Str(b, "text");
                    if (btype == "text" && t != null && t.Trim().Length > 0) lastReply = t.Trim();
                    else if (btype == "tool_use")
                    {
                        var name = Json.Str(b, "name") ?? "";
                        var p = Json.Str(input, "file_path");
                        if ((name == "Edit" || name == "Write") && p != null) { files.Remove(p); files.Add(p); }
                        var cmd = Json.Str(input, "command");
                        if (name == "Bash" && cmd != null)
                        {
                            var shown = Cut(OneLine(cmd), CommandChars);
                            commands[Json.Str(b, "id") ?? ""] = "Command: `" + shown + "`";
                            if (Json.True(input, "run_in_background"))
                            {
                                var desc = Json.Str(input, "description");
                                background.RemoveAll(x => x.EndsWith("`" + shown + "`"));
                                background.Add("- " + (desc != null ? desc + ": " : "") + "`" + shown + "`");
                            }
                        }
                        else if (name.Length > 0) commands[Json.Str(b, "id") ?? ""] = "Tool: " + name;
                    }
                }
            }
        }

        var session = Path.GetFileNameWithoutExtension(chat);
        if (customTitle.Length > 0) title = customTitle;
        var lines = new List<string> {
            "# Handoff: " + (title.Length == 0 ? session : title),
            "",
            "Continue the work from an earlier chat that ran out of cache. Read this, then ask the user what to do first.",
            "",
            "- Folder: " + cwd,
            "- Branch: " + (branch.Length == 0 ? "none" : branch),
            "- Old chat file: " + chat,
            "",
        };
        if (summary.Length > 0) lines.AddRange(new[] { "## Claude's summary of the earlier part of the chat", "", Cut(summary, SummaryChars), "" });
        if (prompts.Count > 0)
        {
            lines.AddRange(new[] { "## First request", "", Cut(prompts[0], PromptChars * 2), "" });
            lines.AddRange(new[] { "## Recent requests, oldest first", "" });
            var recent = prompts.Skip(Math.Max(0, prompts.Count - RecentPrompts)).ToList();
            for (var i = 0; i < recent.Count; i++) lines.Add((i + 1) + ". " + Cut(recent[i], PromptChars));
            lines.Add("");
        }
        if (decisions.Count > 0)
        {
            lines.AddRange(new[] { "## Choices the user made, oldest first. Do not reopen them.", "" });
            lines.AddRange(decisions.Skip(Math.Max(0, decisions.Count - MaxDecisions)));
            lines.Add("");
        }
        var steps = NextSteps(lastReply);
        if (steps.Count > 0)
        {
            lines.AddRange(new[] { "## Next steps listed at the end of the old chat", "" });
            lines.AddRange(steps);
            lines.Add("");
        }
        if (background.Count > 0)
        {
            lines.AddRange(new[] { "## Started in the background in the old chat. Check if still running.", "" });
            lines.AddRange(background.Skip(Math.Max(0, background.Count - MaxBackgroundCommands)));
            lines.Add("");
        }
        if (lastError.Length > 0 && resultsSinceError < RecentErrorWindow)
            lines.AddRange(new[] { "## Last error in the old chat", "", "```", lastError, "```", "" });
        if (files.Count > 0)
        {
            lines.AddRange(new[] { "## Files changed in the old chat, oldest first", "" });
            lines.AddRange(files.Skip(Math.Max(0, files.Count - MaxFiles)).Select(f => "- " + f));
            lines.Add("");
        }
        if (lastReply.Length > 0) lines.AddRange(new[] { "## Last reply from the old chat", "", Cut(lastReply, LastReplyChars), "" });

        try
        {
            Directory.CreateDirectory(outDir);
            File.WriteAllText(Path.Combine(outDir, session + ".md"), string.Join("\n", lines), new UTF8Encoding(false));
            return true;
        }
        catch { return false; }
    }
}
