import AppKit
import Darwin

private enum ArgKey: String {
    case mainPid = "--main-pid"
    case mainBundleId = "--main-bundle-id"
    case mainBundlePath = "--main-bundle-path"
}

private func argValue(_ key: ArgKey) -> String? {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: key.rawValue), index + 1 < args.count else {
        return nil
    }
    return args[index + 1]
}

final class DockHelperAppDelegate: NSObject, NSApplicationDelegate {
    private let mainPid: pid_t?
    private let mainBundleId: String
    private let mainBundlePath: String?
    private var monitorTimer: Timer?
    private lazy var dockMenu: NSMenu = {
        let menu = NSMenu()
        let openItem = NSMenuItem(
            title: "Open DM NOTE",
            action: #selector(openMainFromMenu),
            keyEquivalent: ""
        )
        openItem.target = self
        menu.addItem(openItem)

        menu.addItem(NSMenuItem.separator())

        let quitItem = NSMenuItem(
            title: "Quit DM NOTE",
            action: #selector(quitMainAndHelper),
            keyEquivalent: "q"
        )
        quitItem.target = self
        menu.addItem(quitItem)
        return menu
    }()

    init(mainPid: pid_t?, mainBundleId: String, mainBundlePath: String?) {
        self.mainPid = mainPid
        self.mainBundleId = mainBundleId
        self.mainBundlePath = mainBundlePath
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        startMainProcessMonitor()
    }

    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        dockMenu
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        activateOrLaunchMain()
        return false
    }

    @objc private func openMainFromMenu() {
        activateOrLaunchMain()
    }

    @objc private func quitMainAndHelper() {
        terminateMainApplications()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [mainBundleId] in
            let running = NSRunningApplication.runningApplications(withBundleIdentifier: mainBundleId)
            for app in running where !app.isTerminated {
                app.forceTerminate()
            }
            NSApp.terminate(nil)
        }
    }

    private func startMainProcessMonitor() {
        monitorTimer?.invalidate()
        monitorTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            if self.mainIsAlive() {
                return
            }
            NSApp.terminate(nil)
        }
    }

    private func mainIsAlive() -> Bool {
        if let pid = mainPid {
            return kill(pid, 0) == 0
        }

        let apps = NSRunningApplication.runningApplications(withBundleIdentifier: mainBundleId)
        return apps.contains { !$0.isTerminated }
    }

    private func terminateMainApplications() {
        if let pid = mainPid, let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated {
            _ = app.terminate()
        }

        let running = NSRunningApplication.runningApplications(withBundleIdentifier: mainBundleId)
        for app in running where !app.isTerminated {
            _ = app.terminate()
        }
    }

    private func activateOrLaunchMain() {
        if let pid = mainPid, let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated {
            app.activate(options: [.activateIgnoringOtherApps])
            return
        }

        if let running = NSRunningApplication
            .runningApplications(withBundleIdentifier: mainBundleId)
            .first(where: { !$0.isTerminated }) {
            running.activate(options: [.activateIgnoringOtherApps])
            return
        }

        let workspace = NSWorkspace.shared
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true

        if let bundlePath = mainBundlePath {
            let bundleURL = URL(fileURLWithPath: bundlePath)
            workspace.openApplication(at: bundleURL, configuration: configuration) { _, _ in }
            return
        }

        if let bundleURL = workspace.urlForApplication(withBundleIdentifier: mainBundleId) {
            workspace.openApplication(at: bundleURL, configuration: configuration) { _, _ in }
        }
    }
}

let mainPid = argValue(.mainPid).flatMap { pid_t($0) }
let mainBundleId = argValue(.mainBundleId) ?? "com.dmnote.desktop"
let mainBundlePath = argValue(.mainBundlePath)

let app = NSApplication.shared
ProcessInfo.processInfo.processName = "DM NOTE"
let delegate = DockHelperAppDelegate(
    mainPid: mainPid,
    mainBundleId: mainBundleId,
    mainBundlePath: mainBundlePath
)
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
