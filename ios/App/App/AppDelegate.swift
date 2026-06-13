import UIKit
import Capacitor
import Network
import Foundation
import CryptoKit

struct IOSDeviceInfo: Codable {
    var id: String
    var name: String
    var platform: String
    var role: String
}

struct IOSSettingsState: Codable {
    var syncEnabled: Bool = true
    var launchAtStartup: Bool = true
    var minimizeToTray: Bool = true
    var historyLimit: Int = 200
    var serverPort: Int = 49372
    var theme: String = "hoj-light"
}

struct IOSHistoryEntry: Codable, Equatable {
    var id: String
    var mimeType: String
    var preview: String
    var text: String?
    var imageBase64: String?
    var createdAt: Double
    var sourceDeviceId: String
    var sourceDeviceName: String
    var sha256: String
    var direction: String
}

struct IOSPeerDevice: Codable {
    var id: String
    var name: String
    var platform: String
    var host: String
    var status: String
    var lastSeen: Double
}

struct IOSPersistedState: Codable {
    var device: IOSDeviceInfo
    var settings: IOSSettingsState
    var history: [IOSHistoryEntry]
}

final class IOSSocketPeer {
    let deviceId: String
    var device: IOSPeerDevice
    let connection: NWConnection

    init(deviceId: String, device: IOSPeerDevice, connection: NWConnection) {
        self.deviceId = deviceId
        self.device = device
        self.connection = connection
    }
}

final class ClipVaultIOSRuntime {
    static let shared = ClipVaultIOSRuntime()

    typealias Listener = ([String: Any]) -> Void

    private var listeners: [UUID: Listener] = [:]
    private var device = IOSDeviceInfo(
        id: UUID().uuidString,
        name: UIDevice.current.name,
        platform: "ios",
        role: "mobile"
    )
    private var settings = IOSSettingsState()
    private var history: [IOSHistoryEntry] = []
    private var peers: [String: IOSSocketPeer] = [:]
    private var serviceStatus = "offline"
    private var statusMessage = "等待配对"
    private var localAddress = "0.0.0.0"
    private var routeIds: [String: Double] = [:]
    private var clipboardTimer: Timer?
    private var lastClipboardSignature = ""
    private var suppressedClipboardSignature = ""
    private var activeBackgroundTask: UIBackgroundTaskIdentifier = .invalid

    private let notes = [
        "iPhone 与电脑保持局域网 TCP 长连接。",
        "iOS 受系统规则限制，切到后台后使用有限时长的保活与后台刷新策略。",
        "文本和图片会保留在本地历史记录中。",
    ]

    private lazy var stateURL: URL = {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let folder = support.appendingPathComponent("ClipVault", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent("clipvault-ios-state.json")
    }()

    private init() {
        loadState()
        localAddress = inferLocalAddress()
        startClipboardTimer()
    }

    func addListener(_ listener: @escaping Listener) -> UUID {
        let token = UUID()
        listeners[token] = listener
        return token
    }

    func removeListener(_ token: UUID) {
        listeners[token] = nil
    }

    func start() -> [String: Any] {
        localAddress = inferLocalAddress()
        notifyState()
        return stateDictionary()
    }

    func refreshPairing() -> [String: Any] {
        return stateDictionary()
    }

    func connect(with payload: String) throws -> [String: Any] {
        let raw = Data(payload.utf8)
        let json = try JSONSerialization.jsonObject(with: raw, options: []) as? [String: Any] ?? [:]
        guard
            let host = json["host"] as? String,
            let port = json["port"] as? Int,
            let serverId = json["serverId"] as? String,
            let token = json["token"] as? String
        else {
            throw NSError(domain: "ClipVault", code: 1001, userInfo: [NSLocalizedDescriptionKey: "二维码内容不完整"])
        }

        let serverName = (json["serverName"] as? String) ?? "ClipVault Desktop"
        disconnectPeer(serverId)

        let device = IOSPeerDevice(
            id: serverId,
            name: serverName,
            platform: "windows",
            host: "\(host):\(port)",
            status: "syncing",
            lastSeen: Date().timeIntervalSince1970 * 1000
        )
        let connection = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(integerLiteral: NWEndpoint.Port.IntegerLiteralType(port)), using: .tcp)
        let peer = IOSSocketPeer(deviceId: serverId, device: device, connection: connection)
        peers[serverId] = peer
        serviceStatus = "syncing"
        statusMessage = "正在连接 \(serverName)"
        notifyState()

        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                peer.device.status = "online"
                peer.device.lastSeen = Date().timeIntervalSince1970 * 1000
                self.serviceStatus = "online"
                self.statusMessage = "已连接 \(serverName)"
                self.sendHello(to: peer, token: token)
                self.receiveHeader(from: peer)
                self.notifyState()
            case .failed(let error):
                self.peers.removeValue(forKey: serverId)
                self.serviceStatus = self.peers.isEmpty ? "offline" : "online"
                self.statusMessage = "连接失败：\(error.localizedDescription)"
                self.notifyState()
            case .cancelled:
                self.peers.removeValue(forKey: serverId)
                self.serviceStatus = self.peers.isEmpty ? "offline" : "online"
                self.statusMessage = self.peers.isEmpty ? "等待配对" : "连接已更新"
                self.notifyState()
            default:
                break
            }
        }

        connection.start(queue: .global(qos: .utility))
        return stateDictionary()
    }

    func disconnectPeer(_ peerId: String) {
        guard let peer = peers.removeValue(forKey: peerId) else { return }
        peer.connection.cancel()
        serviceStatus = peers.isEmpty ? "offline" : "online"
        statusMessage = peers.isEmpty ? "已断开所有连接" : "已断开指定设备"
        notifyState()
    }

    func disconnectAll() {
        let keys = Array(peers.keys)
        keys.forEach(disconnectPeer(_:))
        statusMessage = "已断开全部设备"
        notifyState()
    }

    func copyHistory(_ entryId: String) -> [String: Any] {
        guard let entry = history.first(where: { $0.id == entryId }) else {
            return stateDictionary()
        }
        applyClipboard(entry)
        let resend = IOSHistoryEntry(
            id: UUID().uuidString,
            mimeType: entry.mimeType,
            preview: entry.preview,
            text: entry.text,
            imageBase64: entry.imageBase64,
            createdAt: Date().timeIntervalSince1970 * 1000,
            sourceDeviceId: device.id,
            sourceDeviceName: device.name,
            sha256: entry.sha256,
            direction: peers.isEmpty ? "local" : "outbound"
        )
        pushHistory(resend)
        broadcast(entry: resend, routeId: UUID().uuidString, originPeerId: nil)
        return stateDictionary()
    }

    func deleteHistory(_ entryId: String) -> [String: Any] {
        history.removeAll { $0.id == entryId }
        statusMessage = "已删除记录"
        notifyState()
        return stateDictionary()
    }

    func clearHistory() -> [String: Any] {
        history.removeAll()
        statusMessage = "历史记录已清空"
        notifyState()
        return stateDictionary()
    }

    func updateSettings(_ patch: [String: Any]) -> [String: Any] {
        if let syncEnabled = patch["syncEnabled"] as? Bool {
            settings.syncEnabled = syncEnabled
        }
        if let launchAtStartup = patch["launchAtStartup"] as? Bool {
            settings.launchAtStartup = launchAtStartup
        }
        if let minimizeToTray = patch["minimizeToTray"] as? Bool {
            settings.minimizeToTray = minimizeToTray
        }
        if let historyLimit = patch["historyLimit"] as? Int {
            settings.historyLimit = min(max(historyLimit, 20), 1000)
        }
        if let serverPort = patch["serverPort"] as? Int {
            settings.serverPort = min(max(serverPort, 1024), 65535)
        }
        history = Array(history.prefix(settings.historyLimit))
        statusMessage = "设置已保存"
        notifyState()
        return stateDictionary()
    }

    func openPermissionGuide() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    func beginBackgroundTask() {
        guard activeBackgroundTask == .invalid else { return }
        activeBackgroundTask = UIApplication.shared.beginBackgroundTask(withName: "ClipVaultSync") { [weak self] in
            self?.endBackgroundTask()
        }
    }

    func endBackgroundTask() {
        guard activeBackgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(activeBackgroundTask)
        activeBackgroundTask = .invalid
    }

    func stateDictionary() -> [String: Any] {
        localAddress = inferLocalAddress()
        return [
            "device": [
                "id": device.id,
                "name": device.name,
                "platform": device.platform,
                "role": device.role,
            ],
            "serviceStatus": serviceStatus,
            "statusMessage": statusMessage,
            "localAddress": localAddress,
            "pairingPayload": NSNull(),
            "peers": peers.values
                .sorted(by: { $0.device.lastSeen > $1.device.lastSeen })
                .map { peer in
                    [
                        "id": peer.device.id,
                        "name": peer.device.name,
                        "platform": peer.device.platform,
                        "host": peer.device.host,
                        "status": peer.device.status,
                        "lastSeen": peer.device.lastSeen,
                    ]
                },
            "history": history.map { entry in
                [
                    "id": entry.id,
                    "mimeType": entry.mimeType,
                    "preview": entry.preview,
                    "text": entry.text ?? NSNull(),
                    "imageBase64": entry.imageBase64 ?? NSNull(),
                    "createdAt": entry.createdAt,
                    "sourceDeviceId": entry.sourceDeviceId,
                    "sourceDeviceName": entry.sourceDeviceName,
                    "sha256": entry.sha256,
                    "direction": entry.direction,
                ]
            },
            "settings": [
                "syncEnabled": settings.syncEnabled,
                "launchAtStartup": settings.launchAtStartup,
                "minimizeToTray": settings.minimizeToTray,
                "historyLimit": settings.historyLimit,
                "serverPort": settings.serverPort,
                "theme": settings.theme,
            ],
            "capabilities": [
                "canGenerateQr": false,
                "canScanQr": true,
                "canGuidePermissions": true,
                "backgroundMode": "foreground active + background refresh",
            ],
            "notes": notes,
        ]
    }

    private func notifyState() {
        persistState()
        let snapshot = stateDictionary()
        listeners.values.forEach { $0(snapshot) }
    }

    private func startClipboardTimer() {
        clipboardTimer?.invalidate()
        clipboardTimer = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { [weak self] _ in
            self?.pollClipboard()
        }
        RunLoop.main.add(clipboardTimer!, forMode: .common)
    }

    private func pollClipboard() {
        guard settings.syncEnabled else { return }
        guard let entry = buildEntryFromClipboard() else { return }
        let signature = "\(entry.mimeType):\(entry.sha256)"
        if signature == suppressedClipboardSignature {
            lastClipboardSignature = signature
            suppressedClipboardSignature = ""
            return
        }
        if signature == lastClipboardSignature {
            return
        }
        lastClipboardSignature = signature
        let outbound = IOSHistoryEntry(
            id: UUID().uuidString,
            mimeType: entry.mimeType,
            preview: entry.preview,
            text: entry.text,
            imageBase64: entry.imageBase64,
            createdAt: Date().timeIntervalSince1970 * 1000,
            sourceDeviceId: device.id,
            sourceDeviceName: device.name,
            sha256: entry.sha256,
            direction: peers.isEmpty ? "local" : "outbound"
        )
        pushHistory(outbound)
        broadcast(entry: outbound, routeId: UUID().uuidString, originPeerId: nil)
    }

    private func buildEntryFromClipboard() -> IOSHistoryEntry? {
        let pasteboard = UIPasteboard.general
        if let image = pasteboard.image, let pngData = image.pngData() {
            let digest = sha256(pngData)
            return IOSHistoryEntry(
                id: UUID().uuidString,
                mimeType: "image/png",
                preview: "PNG 图片",
                text: nil,
                imageBase64: pngData.base64EncodedString(),
                createdAt: Date().timeIntervalSince1970 * 1000,
                sourceDeviceId: device.id,
                sourceDeviceName: device.name,
                sha256: digest,
                direction: "local"
            )
        }

        let text = pasteboard.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if text.isEmpty {
            return nil
        }
        return IOSHistoryEntry(
            id: UUID().uuidString,
            mimeType: "text/plain",
            preview: previewText(text),
            text: text,
            imageBase64: nil,
            createdAt: Date().timeIntervalSince1970 * 1000,
            sourceDeviceId: device.id,
            sourceDeviceName: device.name,
            sha256: sha256(Data(text.utf8)),
            direction: "local"
        )
    }

    private func applyClipboard(_ entry: IOSHistoryEntry) {
        if entry.mimeType == "text/plain", let text = entry.text {
            UIPasteboard.general.string = text
            suppressedClipboardSignature = "text/plain:\(entry.sha256)"
            lastClipboardSignature = suppressedClipboardSignature
            return
        }
        if entry.mimeType == "image/png", let imageBase64 = entry.imageBase64, let data = Data(base64Encoded: imageBase64), let image = UIImage(data: data) {
            UIPasteboard.general.image = image
            suppressedClipboardSignature = "image/png:\(entry.sha256)"
            lastClipboardSignature = suppressedClipboardSignature
        }
    }

    private func pushHistory(_ entry: IOSHistoryEntry) {
        history.removeAll { $0.id == entry.id || ($0.sha256 == entry.sha256 && $0.mimeType == entry.mimeType) }
        history.insert(entry, at: 0)
        if history.count > settings.historyLimit {
            history = Array(history.prefix(settings.historyLimit))
        }
        notifyState()
    }

    private func sendHello(to peer: IOSSocketPeer, token: String) {
        let payload: [String: Any] = [
            "type": "hello",
            "token": token,
            "device": [
                "id": device.id,
                "name": device.name,
                "platform": device.platform,
                "role": device.role,
            ],
        ]
        send(payload: payload, to: peer)
    }

    private func broadcast(entry: IOSHistoryEntry, routeId: String, originPeerId: String?) {
        rememberRoute(routeId)
        let payload: [String: Any] = [
            "type": "clipboard_update",
            "routeId": routeId,
            "entry": [
                "id": entry.id,
                "mimeType": entry.mimeType,
                "preview": entry.preview,
                "text": entry.text as Any,
                "imageBase64": entry.imageBase64 as Any,
                "createdAt": entry.createdAt,
                "sourceDeviceId": entry.sourceDeviceId,
                "sourceDeviceName": entry.sourceDeviceName,
                "sha256": entry.sha256,
                "direction": "outbound",
            ],
        ]
        for peer in peers.values where peer.device.id != originPeerId {
            send(payload: payload, to: peer)
        }
        serviceStatus = peers.isEmpty ? "offline" : "online"
        statusMessage = peers.isEmpty ? "本地历史已更新" : "已同步到已连接设备"
        notifyState()
    }

    private func send(payload: [String: Any], to peer: IOSSocketPeer) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: []) else { return }
        var length = UInt32(data.count).bigEndian
        let packet = Data(bytes: &length, count: 4) + data
        peer.connection.send(content: packet, completion: .contentProcessed { _ in })
    }

    private func receiveHeader(from peer: IOSSocketPeer) {
        peer.connection.receive(minimumIncompleteLength: 4, maximumLength: 4) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let error {
                self.disconnectPeer(peer.device.id)
                self.statusMessage = "连接中断：\(error.localizedDescription)"
                self.notifyState()
                return
            }
            if isComplete {
                self.disconnectPeer(peer.device.id)
                return
            }
            guard let data, data.count == 4 else {
                self.receiveHeader(from: peer)
                return
            }
            let length = data.withUnsafeBytes { $0.load(as: UInt32.self).bigEndian }
            self.receiveBody(from: peer, length: Int(length))
        }
    }

    private func receiveBody(from peer: IOSSocketPeer, length: Int) {
        peer.connection.receive(minimumIncompleteLength: length, maximumLength: length) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if let error {
                self.disconnectPeer(peer.device.id)
                self.statusMessage = "连接中断：\(error.localizedDescription)"
                self.notifyState()
                return
            }
            if isComplete {
                self.disconnectPeer(peer.device.id)
                return
            }
            guard let data else {
                self.receiveHeader(from: peer)
                return
            }
            self.handleMessage(data: data, from: peer)
            self.receiveHeader(from: peer)
        }
    }

    private func handleMessage(data: Data, from peer: IOSSocketPeer) {
        guard let json = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] else { return }
        guard let type = json["type"] as? String else { return }

        if type == "welcome" {
            if let server = json["server"] as? [String: Any], let name = server["name"] as? String {
                peer.device.name = name
            }
            peer.device.status = "online"
            peer.device.lastSeen = Date().timeIntervalSince1970 * 1000
            serviceStatus = "online"
            statusMessage = "连接已建立"
            notifyState()
            return
        }

        if type == "clipboard_update",
           let routeId = json["routeId"] as? String,
           let entry = json["entry"] as? [String: Any] {
            if routeIds[routeId] != nil {
                return
            }
            rememberRoute(routeId)
            let inbound = IOSHistoryEntry(
                id: UUID().uuidString,
                mimeType: entry["mimeType"] as? String ?? "text/plain",
                preview: entry["preview"] as? String ?? "",
                text: entry["text"] as? String,
                imageBase64: entry["imageBase64"] as? String,
                createdAt: Date().timeIntervalSince1970 * 1000,
                sourceDeviceId: entry["sourceDeviceId"] as? String ?? peer.device.id,
                sourceDeviceName: entry["sourceDeviceName"] as? String ?? peer.device.name,
                sha256: entry["sha256"] as? String ?? UUID().uuidString,
                direction: "inbound"
            )
            applyClipboard(inbound)
            pushHistory(inbound)
            broadcast(entry: inbound, routeId: routeId, originPeerId: peer.device.id)
        }
    }

    private func rememberRoute(_ routeId: String) {
        routeIds[routeId] = Date().timeIntervalSince1970 * 1000
        if routeIds.count > 512, let oldestKey = routeIds.sorted(by: { $0.value < $1.value }).first?.key {
            routeIds.removeValue(forKey: oldestKey)
        }
    }

    private func persistState() {
        let persisted = IOSPersistedState(device: device, settings: settings, history: history)
        if let data = try? JSONEncoder().encode(persisted) {
            try? data.write(to: stateURL, options: .atomic)
        }
    }

    private func loadState() {
        guard let data = try? Data(contentsOf: stateURL),
              let persisted = try? JSONDecoder().decode(IOSPersistedState.self, from: data)
        else { return }
        device = persisted.device
        device.platform = "ios"
        device.role = "mobile"
        settings = persisted.settings
        history = persisted.history
    }

    private func inferLocalAddress() -> String {
        var address = "0.0.0.0"
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else {
            return address
        }
        defer { freeifaddrs(ifaddr) }
        var cursor = first
        while true {
            let interface = cursor.pointee
            let addrFamily = interface.ifa_addr.pointee.sa_family
            if addrFamily == UInt8(AF_INET) {
                let name = String(cString: interface.ifa_name)
                if name != "lo0" {
                    var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                    getnameinfo(
                        interface.ifa_addr,
                        socklen_t(interface.ifa_addr.pointee.sa_len),
                        &host,
                        socklen_t(host.count),
                        nil,
                        0,
                        NI_NUMERICHOST
                    )
                    address = String(cString: host)
                    break
                }
            }
            guard let next = interface.ifa_next else { break }
            cursor = next
        }
        return address
    }

    private func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).compactMap { String(format: "%02x", $0) }.joined()
    }

    private func previewText(_ text: String) -> String {
        let normalized = text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        return normalized.count > 96 ? String(normalized.prefix(96)) + "..." : normalized
    }
}

@objc(ClipVaultNativePlugin)
public class ClipVaultNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClipVaultNativePlugin"
    public let jsName = "ClipVaultNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "refreshPairing", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connectWithPayload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnectPeer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnectAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "copyHistory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteHistory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearHistory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openPermissionGuide", returnType: CAPPluginReturnPromise),
    ]

    private var listenerToken: UUID?

    public override func load() {
        super.load()
        listenerToken = ClipVaultIOSRuntime.shared.addListener { [weak self] state in
            self?.notifyListeners("stateChanged", data: ["state": state])
        }
    }

    deinit {
        if let listenerToken {
            ClipVaultIOSRuntime.shared.removeListener(listenerToken)
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        call.resolve(["state": ClipVaultIOSRuntime.shared.start()])
    }

    @objc func getState(_ call: CAPPluginCall) {
        call.resolve(["state": ClipVaultIOSRuntime.shared.stateDictionary()])
    }

    @objc func refreshPairing(_ call: CAPPluginCall) {
        call.resolve(["state": ClipVaultIOSRuntime.shared.refreshPairing()])
    }

    @objc func connectWithPayload(_ call: CAPPluginCall) {
        guard let payload = call.getString("payload") else {
            call.reject("缺少配对内容。")
            return
        }
        do {
            call.resolve(["state": try ClipVaultIOSRuntime.shared.connect(with: payload)])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func disconnectPeer(_ call: CAPPluginCall) {
        guard let peerId = call.getString("peerId") else {
            call.reject("缺少设备标识。")
            return
        }
        ClipVaultIOSRuntime.shared.disconnectPeer(peerId)
        call.resolve(["state": ClipVaultIOSRuntime.shared.stateDictionary()])
    }

    @objc func disconnectAll(_ call: CAPPluginCall) {
        ClipVaultIOSRuntime.shared.disconnectAll()
        call.resolve(["state": ClipVaultIOSRuntime.shared.stateDictionary()])
    }

    @objc func copyHistory(_ call: CAPPluginCall) {
        guard let entryId = call.getString("entryId") else {
            call.reject("缺少记录标识。")
            return
        }
        call.resolve(["state": ClipVaultIOSRuntime.shared.copyHistory(entryId)])
    }

    @objc func deleteHistory(_ call: CAPPluginCall) {
        guard let entryId = call.getString("entryId") else {
            call.reject("缺少记录标识。")
            return
        }
        call.resolve(["state": ClipVaultIOSRuntime.shared.deleteHistory(entryId)])
    }

    @objc func clearHistory(_ call: CAPPluginCall) {
        call.resolve(["state": ClipVaultIOSRuntime.shared.clearHistory()])
    }

    @objc func updateSettings(_ call: CAPPluginCall) {
        guard let rawSettings = call.getString("settings"),
              let data = rawSettings.data(using: .utf8),
              let patch = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any]
        else {
            call.reject("设置参数无效。")
            return
        }
        call.resolve(["state": ClipVaultIOSRuntime.shared.updateSettings(patch)])
    }

    @objc func openPermissionGuide(_ call: CAPPluginCall) {
        ClipVaultIOSRuntime.shared.openPermissionGuide()
        call.resolve()
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        _ = ClipVaultIOSRuntime.shared.start()
        application.setMinimumBackgroundFetchInterval(UIApplication.backgroundFetchIntervalMinimum)
        return true
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        ClipVaultIOSRuntime.shared.beginBackgroundTask()
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        ClipVaultIOSRuntime.shared.endBackgroundTask()
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    func application(_ application: UIApplication, performFetchWithCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        _ = ClipVaultIOSRuntime.shared.start()
        completionHandler(.newData)
    }
}
