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
    private var mainPid: pid_t?
    private let mainBundleId: String
    private let mainBundlePath: String?
    private var monitorTimer: Timer?
    private var isQuitting = false
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
        let currentPid = ProcessInfo.processInfo.processIdentifier
        // 기존 helper 인스턴스가 있으면 종료시키고 이 인스턴스(최신 main-pid)가 대체한다.
        // 반대로 새 인스턴스를 자결시키면 앱 재시작 시 구 helper도 곧 죽어 Dock 아이콘이 사라진다
        let staleHelpers = NSRunningApplication
            .runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "")
            .filter { $0.processIdentifier != currentPid && !$0.isTerminated }
        for helper in staleHelpers {
            helper.terminate()
        }

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
        guard !isQuitting else { return }
        isQuitting = true
        monitorTimer?.invalidate()
        terminateMainApplications()
        waitForMainTermination(attempt: 0)
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
        // kill(pid,0)은 번들 여부와 무관하게 모든 프로세스에 동작 — dev 바이너리 포함.
        // NSRunningApplication은 LaunchServices에 등록된 앱만 조회돼 생존 확인엔 부적합
        // pid 재사용 위험은 원 설계와 동일하게 수용
        if let pid = mainPid, kill(pid, 0) == 0 {
            return true
        }
        // pid가 죽었으면 같은 번들 ID로 재시작된 메인에 재결합 (패키지 앱 재시작)
        return currentMainApplication() != nil
    }

    private func currentMainApplication() -> NSRunningApplication? {
        // 부모가 넘겨준 pid는 신뢰한다. 번들 ID 동일성은 pid 재사용 방어용이며
        // non-nil일 때만 검사 — dev 실행 메인은 번들이 아니라 bundleIdentifier가
        // nil이므로, 동일성을 요구하면 helper가 메인 사망으로 오판해 자결한다
        if let pid = mainPid,
           let app = NSRunningApplication(processIdentifier: pid),
           !app.isTerminated,
           app.bundleIdentifier == nil || app.bundleIdentifier == mainBundleId {
            return app
        }

        let replacement = NSRunningApplication
            .runningApplications(withBundleIdentifier: mainBundleId)
            .first { !$0.isTerminated }
        mainPid = replacement?.processIdentifier
        return replacement
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

    private func waitForMainTermination(attempt: Int) {
        let running = NSRunningApplication
            .runningApplications(withBundleIdentifier: mainBundleId)
            .filter { !$0.isTerminated }
        if running.isEmpty {
            NSApp.terminate(nil)
            return
        }

        if attempt >= 50 {
            for app in running {
                app.forceTerminate()
            }
            NSApp.terminate(nil)
            return
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.waitForMainTermination(attempt: attempt + 1)
        }
    }

    private func sendReopenEvent(to pid: pid_t) {
        // openApplication이 번들 앱에 보내는 reopen(aevt/rapp)과 동일한 이벤트를 pid로 직접 전송
        // — 메인의 RunEvent::Reopen 핸들러가 트레이에 숨긴 창을 복원한다. reopen은 TCC 동의 면제
        let target = NSAppleEventDescriptor(processIdentifier: pid)
        let event = NSAppleEventDescriptor(
            eventClass: AEEventClass(kCoreEventClass),
            eventID: AEEventID(kAEReopenApplication),
            targetDescriptor: target,
            returnID: AEReturnID(kAutoGenerateReturnID),
            transactionID: AETransactionID(kAnyTransactionID)
        )
        AESendMessage(event.aeDesc, nil, AESendMode(kAENoReply), kAEDefaultTimeout)
    }

    private func activateOrLaunchMain() {
        let workspace = NSWorkspace.shared
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true

        if let running = currentMainApplication() {
            // 번들 없는 프로세스(dev 바이너리)의 bundleURL은 실행 파일 경로를 그대로 반환하는데,
            // 그걸 openApplication에 넘기면 LaunchServices가 Terminal로 열어 새 인스턴스가 뜬다.
            // 실제 .app 번들일 때만 openApplication 사용, dev는 reopen 이벤트를 직접 전송
            if let bundleURL = running.bundleURL, bundleURL.pathExtension == "app" {
                workspace.openApplication(at: bundleURL, configuration: configuration) { _, _ in }
            } else {
                sendReopenEvent(to: running.processIdentifier)
                running.activate(options: [.activateIgnoringOtherApps])
            }
            return
        }

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
