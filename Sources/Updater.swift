// Checks GitHub once a day for a newer HandoffBar release.
// This is the app's only network request. It sends nothing about the user or their chats:
// a plain GET for the latest release's version number.
import Foundation

let latestReleaseAPI = URL(string: "https://api.github.com/repos/Proxylang/handoff-bar/releases/latest")!
let latestDownload = URL(string: "https://github.com/Proxylang/handoff-bar/releases/latest/download/HandoffBar.dmg")!
// Once a day is enough for an app that ships a few times a month.
let updateCheckInterval: TimeInterval = 24 * 3600
let updateRequestTimeout: TimeInterval = 15

let currentVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"

/// True when `candidate` ("v1.3.0" or "1.3.0") is a higher version than `current`.
func isNewer(_ candidate: String, than current: String) -> Bool {
    func parts(_ v: String) -> [Int] {
        v.trimmingCharacters(in: CharacterSet(charactersIn: "vV")).split(separator: ".").map { Int($0) ?? 0 }
    }
    let a = parts(candidate), b = parts(current)
    for i in 0..<max(a.count, b.count) {
        let x = i < a.count ? a[i] : 0, y = i < b.count ? b[i] : 0
        if x != y { return x > y }
    }
    return false
}

final class UpdateChecker {
    private var timer: Timer?
    private let onNewVersion: (String) -> Void
    // No cookies, no cache, nothing stored between checks.
    private let session = URLSession(configuration: .ephemeral)

    init(onNewVersion: @escaping (String) -> Void) { self.onNewVersion = onNewVersion }

    func start() {
        check()
        timer = Timer.scheduledTimer(withTimeInterval: updateCheckInterval, repeats: true) { [weak self] _ in self?.check() }
    }

    private func check() {
        var request = URLRequest(url: latestReleaseAPI, timeoutInterval: updateRequestTimeout)
        // GitHub rejects API requests without a User-Agent.
        request.setValue("HandoffBar/\(currentVersion)", forHTTPHeaderField: "User-Agent")
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        session.dataTask(with: request) { [weak self] data, _, _ in
            // Offline or rate-limited: say nothing and try again tomorrow.
            guard let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let tag = json["tag_name"] as? String,
                  isNewer(tag, than: currentVersion) else { return }
            let version = tag.trimmingCharacters(in: CharacterSet(charactersIn: "vV"))
            DispatchQueue.main.async { self?.onNewVersion(version) }
        }.resume()
    }
}
