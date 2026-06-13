package io.clipvault.app

import android.app.Activity
import android.app.AlarmManager
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.InputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.util.Collections
import java.util.LinkedHashMap
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

object ClipVaultRuntime {
    private const val DISCOVERY_PORT = 49373

    interface StateListener {
        fun onStateChanged(state: JSONObject)
    }

    private data class DeviceInfo(
        val id: String,
        val name: String,
        val platform: String,
        val role: String,
    )

    private data class SettingsState(
        var syncEnabled: Boolean = true,
        var launchAtStartup: Boolean = true,
        var minimizeToTray: Boolean = true,
        var historyLimit: Int = 200,
        var serverPort: Int = 49372,
        var theme: String = "hoj-light",
    )

    private data class HistoryEntry(
        val id: String,
        val mimeType: String,
        val preview: String,
        val text: String?,
        val imageBase64: String?,
        val createdAt: Long,
        val sourceDeviceId: String,
        val sourceDeviceName: String,
        val sha256: String,
        val direction: String,
    )

    private data class PeerDevice(
        var id: String,
        var name: String,
        var platform: String,
        var host: String,
        var status: String,
        var lastSeen: Long,
    )

    private data class SocketPeer(
        val device: PeerDevice,
        val socket: Socket,
        val input: DataInputStream,
        val output: DataOutputStream,
    )

    private lateinit var appContext: Context
    private var initialized = false
    private val executor = Executors.newCachedThreadPool()
    private val clipboardPoller: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private var clipboardPollTask: ScheduledFuture<*>? = null
    private val stateListeners = CopyOnWriteArraySet<StateListener>()
    private val peers = ConcurrentHashMap<String, SocketPeer>()
    private val routeIds = Collections.synchronizedMap(LinkedHashMap<String, Long>())
    private lateinit var clipboardManager: ClipboardManager
    private lateinit var storeFile: File
    private lateinit var clipboardListener: ClipboardManager.OnPrimaryClipChangedListener
    private var serverSocket: ServerSocket? = null
    private var discoverySocket: DatagramSocket? = null

    private data class ServerIdentity(
        var serverId: String = UUID.randomUUID().toString(),
        var token: String = UUID.randomUUID().toString(),
        var pairingCode: String = generatePairingCode(),
    )

    private var deviceInfo = DeviceInfo(
        id = UUID.randomUUID().toString(),
        name = "${Build.MANUFACTURER} ${Build.MODEL}",
        platform = "android",
        role = "mobile",
    )
    private val settingsState = SettingsState()
    private val history = mutableListOf<HistoryEntry>()
    private var serviceStatus = "offline"
    private var statusMessage = "等待配对"
    private var advancedAdbStatus = "未启用"
    private var localAddress = "0.0.0.0"
    private var lastClipboardSignature = ""
    private var suppressedClipboardSignature = ""
    private val serverIdentity = ServerIdentity()
    private val notes = listOf(
        "安卓端使用前台服务保持长连接。",
        "六位配对码按常见家庭局域网规则生成，可直接定位同一网段内的目标设备。",
        "建议关闭电池优化并允许自启动，以减少系统回收。",
        "文本和图片会保留在本地历史记录中。",
    )

    fun initialize(context: Context) {
        if (initialized) {
            return
        }

        appContext = context.applicationContext
        clipboardManager = appContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        storeFile = File(appContext.filesDir, "clipvault-android-state.json")
        loadPersistedState()
        localAddress = inferLocalAddress()
        clipboardListener = ClipboardManager.OnPrimaryClipChangedListener {
            handleClipboardChanged()
        }
        clipboardManager.addPrimaryClipChangedListener(clipboardListener)
        initialized = true
        startClipboardPolling()
        startPairingServers()
        notifyState()
    }

    fun addListener(listener: StateListener) {
        stateListeners.add(listener)
    }

    fun getStateJson(): JSONObject = synchronized(this) {
        localAddress = inferLocalAddress()
        JSONObject().apply {
            put(
                "device",
                JSONObject().apply {
                    put("id", deviceInfo.id)
                    put("name", deviceInfo.name)
                    put("platform", deviceInfo.platform)
                    put("role", deviceInfo.role)
                },
            )
            put("serviceStatus", serviceStatus)
            put("statusMessage", statusMessage)
            put("advancedAdbStatus", advancedAdbStatus)
            put("localAddress", localAddress)
            put("pairingPayload", createPairingPayload())
            put(
                "peers",
                JSONArray().apply {
                    peers.values
                        .sortedByDescending { it.device.lastSeen }
                        .forEach { peer ->
                            put(
                                JSONObject().apply {
                                    put("id", peer.device.id)
                                    put("name", peer.device.name)
                                    put("platform", peer.device.platform)
                                    put("host", peer.device.host)
                                    put("status", peer.device.status)
                                    put("lastSeen", peer.device.lastSeen)
                                },
                            )
                        }
                },
            )
            put(
                "history",
                JSONArray().apply {
                    history.forEach { entry ->
                        put(entry.toJson())
                    }
                },
            )
            put(
                "settings",
                JSONObject().apply {
                    put("syncEnabled", settingsState.syncEnabled)
                    put("launchAtStartup", settingsState.launchAtStartup)
                    put("minimizeToTray", settingsState.minimizeToTray)
                    put("historyLimit", settingsState.historyLimit)
                    put("serverPort", settingsState.serverPort)
                    put("theme", settingsState.theme)
                },
            )
            put(
                "capabilities",
                JSONObject().apply {
                    put("canGenerateQr", true)
                    put("canScanQr", true)
                    put("canGuidePermissions", true)
                    put("backgroundMode", "foreground-service + auto-restart + clipboard listener")
                },
            )
            put(
                "notes",
                JSONArray().apply {
                    notes.forEach { put(it) }
                },
            )
        }
    }

    fun shouldLaunchAtStartup(): Boolean = settingsState.launchAtStartup

    fun updateAdvancedAdbState(message: String) {
        advancedAdbStatus = message
        statusMessage = message
        notifyState()
    }

    fun ingestAdvancedClipboardText(text: String) {
        if (!initialized || !settingsState.syncEnabled) {
            return
        }
        val normalized = text.trim()
        if (normalized.isBlank()) {
            return
        }
        val digest = sha256(normalized.toByteArray())
        val signature = "text/plain:$digest"
        if (signature == lastClipboardSignature) {
            return
        }
        lastClipboardSignature = signature
        val outbound = HistoryEntry(
            id = UUID.randomUUID().toString(),
            mimeType = "text/plain",
            preview = previewText(normalized),
            text = normalized,
            imageBase64 = null,
            createdAt = System.currentTimeMillis(),
            sourceDeviceId = deviceInfo.id,
            sourceDeviceName = deviceInfo.name,
            sha256 = digest,
            direction = if (peers.isEmpty()) "local" else "outbound",
        )
        pushHistory(outbound)
        broadcastClipboardEntry(outbound, null, UUID.randomUUID().toString())
    }

    fun startForegroundService(context: Context) {
        val intent = Intent(context, ClipVaultSyncService::class.java)
        ContextCompat.startForegroundService(context, intent)
    }

    fun refreshPairing() {
        serverIdentity.token = UUID.randomUUID().toString()
        serverIdentity.pairingCode = buildPairingCode(generatePairingSecret())
        statusMessage = "二维码和配对码已刷新"
        notifyState()
        persistState()
    }

    private fun startPairingServers() {
        startTcpServer()
    }

    private fun startTcpServer() {
        if (serverSocket != null && serverSocket?.isClosed == false) {
            return
        }
        executor.execute {
            try {
                val listener = ServerSocket(settingsState.serverPort)
                serverSocket = listener
                serviceStatus = "online"
                statusMessage = "等待设备连接"
                notifyState()
                while (!listener.isClosed) {
                    val socket = listener.accept()
                    handleAcceptedSocket(socket)
                }
            } catch (exception: Exception) {
                if (serverSocket?.isClosed != true) {
                    serviceStatus = if (peers.isEmpty()) "offline" else "online"
                    statusMessage = "监听端口失败：${exception.message ?: "未知错误"}"
                    notifyState()
                }
            }
        }
    }

    private fun restartTcpServer() {
        try {
            serverSocket?.close()
        } catch (_: Exception) {
        }
        serverSocket = null
        startTcpServer()
    }

    private fun startDiscoveryServer() {
        if (discoverySocket != null && discoverySocket?.isClosed == false) {
            return
        }
        executor.execute {
            try {
                val socket = DatagramSocket(DISCOVERY_PORT)
                socket.broadcast = true
                discoverySocket = socket
                val buffer = ByteArray(8192)
                while (!socket.isClosed) {
                    val packet = DatagramPacket(buffer, buffer.size)
                    socket.receive(packet)
                    handleDiscoveryPacket(socket, packet)
                }
            } catch (_: Exception) {
            }
        }
    }

    private fun handleDiscoveryPacket(socket: DatagramSocket, packet: DatagramPacket) {
        try {
            val request = JSONObject(String(packet.data, 0, packet.length, Charsets.UTF_8))
            if (request.optString("type") != "clipvault_pairing_lookup") {
                return
            }
            if (request.optString("requesterId") == deviceInfo.id) {
                return
            }
            if (request.optString("pairingCode") != serverIdentity.pairingCode) {
                return
            }
            val response = JSONObject().apply {
                put("type", "clipvault_pairing_offer")
                put("payload", createPairingPayload())
            }.toString().toByteArray(Charsets.UTF_8)
            socket.send(DatagramPacket(response, response.size, packet.address, packet.port))
        } catch (_: Exception) {
        }
    }

    private fun handleAcceptedSocket(socket: Socket) {
        executor.execute {
            socket.keepAlive = true
            val peer = SocketPeer(
                device = PeerDevice(
                    id = "pending-${UUID.randomUUID()}",
                    name = "待认证设备",
                    platform = "unknown",
                    host = "${socket.inetAddress.hostAddress}:${socket.port}",
                    status = "syncing",
                    lastSeen = System.currentTimeMillis(),
                ),
                socket = socket,
                input = DataInputStream(socket.getInputStream()),
                output = DataOutputStream(socket.getOutputStream()),
            )
            readSocketLoop(peer)
        }
    }

    fun connectWithPayload(payload: String) {
        initialize(appContext)
        val normalized = payload.trim()
        if (Regex("^\\d{6}$").matches(normalized)) {
            statusMessage = "正在连接配对码 $normalized"
            serviceStatus = "syncing"
            notifyState()
            val parsed = resolvePairingCode(normalized)
            connectWithResolvedPayload(parsed, true)
            return
        }
        val parsed = try {
            JSONObject(normalized)
        } catch (exception: Exception) {
            throw IllegalArgumentException("请扫描本软件生成的二维码，或输入 6 位配对码。")
        }
        connectWithResolvedPayload(parsed, false)
    }

    private fun connectWithResolvedPayload(parsed: JSONObject, fromPairingCode: Boolean) {
        val host = parsed.getString("host")
        val port = parsed.getInt("port")
        val serverId = parsed.getString("serverId")
        if (serverId == serverIdentity.serverId) {
            throw IllegalArgumentException("不能连接本机生成的配对码。")
        }
        val token = parsed.getString("token")
        val serverName = parsed.optString("serverName", "ClipVault 设备")
        val platform = parsed.optString("platform", "windows")
        val pairingSecret = parsed.optString("pairingSecret", parsed.optString("pairingCode").takeLast(3))
        if (fromPairingCode && host == localAddress && pairingSecret == currentPairingSecret()) {
            throw IllegalArgumentException("不能连接本机生成的配对码。")
        }
        disconnectPeer(serverId)
        statusMessage = "正在连接 $serverName"
        serviceStatus = "syncing"
        notifyState()

        var socket: Socket? = null
        try {
            socket = Socket().apply {
                tcpNoDelay = true
                keepAlive = true
            }
            val connectTimeout = if (fromPairingCode) 1500 else 5000
            val handshakeTimeout = if (fromPairingCode) 2000 else 6000
            socket.connect(InetSocketAddress(host, port), connectTimeout)
            socket.soTimeout = handshakeTimeout
            val input = DataInputStream(socket.getInputStream())
            val output = DataOutputStream(socket.getOutputStream())
            val peerDevice = PeerDevice(
                id = serverId,
                name = serverName,
                platform = platform,
                host = "$host:$port",
                status = "syncing",
                lastSeen = System.currentTimeMillis(),
            )
            val peer = SocketPeer(peerDevice, socket, input, output)
            peers[serverId] = peer
            writeFrame(
                output,
                JSONObject().apply {
                    put("type", "hello")
                    if (token.isNotBlank()) {
                        put("token", token)
                    }
                    if (pairingSecret.isNotBlank()) {
                        put("pairingSecret", pairingSecret)
                    }
                    put(
                        "device",
                        JSONObject().apply {
                            put("id", deviceInfo.id)
                            put("name", deviceInfo.name)
                            put("platform", deviceInfo.platform)
                            put("role", deviceInfo.role)
                        },
                    )
                },
            )

            val welcome = readFrame(input)
            if (welcome.optString("type") != "welcome") {
                throw IllegalStateException("设备握手失败，请重新生成配对信息后再试。")
            }
            welcome.optJSONObject("server")?.let { server ->
                peer.device.name = server.optString("name", peer.device.name)
                peer.device.platform = server.optString("platform", peer.device.platform)
            }
            peer.device.status = "online"
            peer.device.lastSeen = System.currentTimeMillis()
            serviceStatus = "online"
            statusMessage = "已连接 $serverName"
            notifyState()
            socket.soTimeout = 0
            readSocketLoop(peer)
        } catch (exception: Exception) {
            peers.remove(serverId)
            try {
                socket?.close()
            } catch (_: Exception) {
            }
            serviceStatus = if (peers.isEmpty()) "offline" else "online"
            statusMessage = buildConnectionErrorMessage(exception, fromPairingCode)
            notifyState()
            throw IllegalStateException(statusMessage)
        }
    }

    private fun resolvePairingCode(pairingCode: String): JSONObject {
        val host = resolveHostFromPairingCode(pairingCode)
        return JSONObject().apply {
            put("version", 1)
            put("host", host)
            put("port", settingsState.serverPort)
            put("serverId", "pairing-$host")
            put("serverName", "ClipVault 设备")
            put("platform", "unknown")
            put("token", "")
            put("pairingCode", pairingCode)
            put("pairingSecret", pairingCode.takeLast(3))
            put("issuedAt", System.currentTimeMillis())
        }
    }

    fun disconnectPeer(peerId: String) {
        val peer = peers.remove(peerId) ?: return
        try {
            peer.socket.close()
        } catch (_: Exception) {
        }
        serviceStatus = if (peers.isEmpty()) "offline" else "online"
        statusMessage = if (peers.isEmpty()) "已断开所有连接" else "已断开指定设备"
        notifyState()
        persistState()
    }

    fun disconnectAll() {
        peers.keys.toList().forEach(::disconnectPeer)
        statusMessage = "已断开全部设备"
        notifyState()
    }

    fun copyHistory(entryId: String) {
        val entry = synchronized(this) { history.firstOrNull { it.id == entryId } } ?: return
        applyClipboardEntry(entry)
        val resend = entry.copy(
            id = UUID.randomUUID().toString(),
            createdAt = System.currentTimeMillis(),
            sourceDeviceId = deviceInfo.id,
            sourceDeviceName = deviceInfo.name,
            direction = if (peers.isEmpty()) "local" else "outbound",
        )
        pushHistory(resend)
        broadcastClipboardEntry(resend, null, UUID.randomUUID().toString())
    }

    fun deleteHistory(entryId: String) {
        synchronized(this) {
            history.removeAll { it.id == entryId }
        }
        statusMessage = "已删除记录"
        notifyState()
        persistState()
    }

    fun clearHistory() {
        synchronized(this) {
            history.clear()
        }
        statusMessage = "历史记录已清空"
        notifyState()
        persistState()
    }

    fun updateSettings(patch: JSONObject) {
        val previousPort = settingsState.serverPort
        if (patch.has("syncEnabled")) settingsState.syncEnabled = patch.optBoolean("syncEnabled", settingsState.syncEnabled)
        if (patch.has("launchAtStartup")) settingsState.launchAtStartup = patch.optBoolean("launchAtStartup", settingsState.launchAtStartup)
        if (patch.has("minimizeToTray")) settingsState.minimizeToTray = patch.optBoolean("minimizeToTray", settingsState.minimizeToTray)
        if (patch.has("historyLimit")) settingsState.historyLimit = patch.optInt("historyLimit", settingsState.historyLimit).coerceIn(20, 1000)
        if (patch.has("serverPort")) settingsState.serverPort = patch.optInt("serverPort", settingsState.serverPort).coerceIn(1024, 65535)
        if (settingsState.serverPort != previousPort) {
            restartTcpServer()
        }
        statusMessage = "设置已保存"
        trimHistory()
        notifyState()
        persistState()
    }

    fun openPermissionGuide(activity: Activity?) {
        val intent = when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !isIgnoringBatteryOptimizations() -> {
                Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:${appContext.packageName}"),
                )
            }
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !canScheduleExactAlarms() -> {
                Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
            }
            Settings.canDrawOverlays(appContext).not() -> {
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${appContext.packageName}"),
                )
            }
            else -> {
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:${appContext.packageName}"),
                )
            }
        }.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }

        (activity ?: appContext).startActivity(intent)
    }

    private fun canScheduleExactAlarms(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return true
        }
        val alarmManager = appContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        return alarmManager?.canScheduleExactAlarms() == true
    }

    private fun loadPersistedState() {
        if (!storeFile.exists()) {
            persistState()
            return
        }

        try {
            val parsed = JSONObject(storeFile.readText())
            val device = parsed.optJSONObject("device")
            if (device != null) {
                deviceInfo = DeviceInfo(
                    id = device.optString("id", deviceInfo.id),
                    name = device.optString("name", deviceInfo.name),
                    platform = "android",
                    role = "mobile",
                )
            }
            val settings = parsed.optJSONObject("settings")
            if (settings != null) {
                settingsState.syncEnabled = settings.optBoolean("syncEnabled", settingsState.syncEnabled)
                settingsState.launchAtStartup = settings.optBoolean("launchAtStartup", settingsState.launchAtStartup)
                settingsState.minimizeToTray = settings.optBoolean("minimizeToTray", settingsState.minimizeToTray)
                settingsState.historyLimit = settings.optInt("historyLimit", settingsState.historyLimit).coerceIn(20, 1000)
                settingsState.serverPort = settings.optInt("serverPort", settingsState.serverPort).coerceIn(1024, 65535)
                settingsState.theme = settings.optString("theme", settingsState.theme)
            }
            val identity = parsed.optJSONObject("serverIdentity")
            if (identity != null) {
                serverIdentity.serverId = identity.optString("serverId", serverIdentity.serverId)
                serverIdentity.token = identity.optString("token", serverIdentity.token)
                serverIdentity.pairingCode = identity.optString("pairingCode", serverIdentity.pairingCode)
            }
            val historyArray = parsed.optJSONArray("history") ?: JSONArray()
            history.clear()
            for (index in 0 until historyArray.length()) {
                val item = historyArray.getJSONObject(index)
                history.add(
                    HistoryEntry(
                        id = item.getString("id"),
                        mimeType = item.getString("mimeType"),
                        preview = item.getString("preview"),
                        text = item.optString("text").takeIf { item.has("text") && !item.isNull("text") },
                        imageBase64 = item.optString("imageBase64").takeIf { item.has("imageBase64") && !item.isNull("imageBase64") },
                        createdAt = item.getLong("createdAt"),
                        sourceDeviceId = item.getString("sourceDeviceId"),
                        sourceDeviceName = item.getString("sourceDeviceName"),
                        sha256 = item.getString("sha256"),
                        direction = item.optString("direction", "local"),
                    ),
                )
            }
            trimHistory()
        } catch (_: Exception) {
            history.clear()
        }
    }

    private fun persistState() {
        try {
            storeFile.writeText(
                JSONObject().apply {
                    put(
                        "device",
                        JSONObject().apply {
                            put("id", deviceInfo.id)
                            put("name", deviceInfo.name)
                        },
                    )
                    put(
                        "settings",
                        JSONObject().apply {
                            put("syncEnabled", settingsState.syncEnabled)
                            put("launchAtStartup", settingsState.launchAtStartup)
                            put("minimizeToTray", settingsState.minimizeToTray)
                            put("historyLimit", settingsState.historyLimit)
                            put("serverPort", settingsState.serverPort)
                            put("theme", settingsState.theme)
                        },
                    )
                    put(
                        "serverIdentity",
                        JSONObject().apply {
                            put("serverId", serverIdentity.serverId)
                            put("token", serverIdentity.token)
                            put("pairingCode", serverIdentity.pairingCode)
                        },
                    )
                    put(
                        "history",
                        JSONArray().apply {
                            history.forEach { put(it.toJson()) }
                        },
                    )
                }.toString(2),
            )
        } catch (_: Exception) {
        }
    }

    private fun notifyState() {
        persistState()
        val snapshot = getStateJson()
        stateListeners.forEach { it.onStateChanged(snapshot) }
    }

    private fun trimHistory() {
        synchronized(this) {
            while (history.size > settingsState.historyLimit) {
                history.removeLast()
            }
        }
    }

    private fun handleClipboardChanged() {
        if (!initialized || !settingsState.syncEnabled) {
            return
        }

        val entry = try {
            buildEntryFromClipboard()
        } catch (_: SecurityException) {
            return
        } catch (_: Exception) {
            return
        } ?: return
        val signature = "${entry.mimeType}:${entry.sha256}"
        if (signature == suppressedClipboardSignature) {
            lastClipboardSignature = signature
            suppressedClipboardSignature = ""
            return
        }
        if (signature == lastClipboardSignature) {
            return
        }
        lastClipboardSignature = signature
        val outbound = entry.copy(direction = if (peers.isEmpty()) "local" else "outbound")
        pushHistory(outbound)
        broadcastClipboardEntry(outbound, null, UUID.randomUUID().toString())
    }

    private fun startClipboardPolling() {
        if (clipboardPollTask?.isCancelled == false && clipboardPollTask?.isDone == false) {
            return
        }
        clipboardPollTask = clipboardPoller.scheduleWithFixedDelay(
            {
                handleClipboardChanged()
            },
            700,
            900,
            TimeUnit.MILLISECONDS,
        )
    }

    private fun pushHistory(entry: HistoryEntry) {
        synchronized(this) {
            history.removeAll { it.id == entry.id || (it.sha256 == entry.sha256 && it.mimeType == entry.mimeType) }
            history.add(0, entry)
            trimHistory()
        }
        notifyState()
    }

    private fun buildEntryFromClipboard(): HistoryEntry? {
        val clipData = clipboardManager.primaryClip ?: return null
        if (clipData.itemCount == 0) {
            return null
        }
        val item = clipData.getItemAt(0)
        val description = clipboardManager.primaryClipDescription
        val imageUri = item.uri

        if (looksLikeImage(description, imageUri)) {
            val bytes = readImageBytes(imageUri ?: return null) ?: return null
            val digest = sha256(bytes)
            return HistoryEntry(
                id = UUID.randomUUID().toString(),
                mimeType = "image/png",
                preview = "PNG 图片",
                text = null,
                imageBase64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP),
                createdAt = System.currentTimeMillis(),
                sourceDeviceId = deviceInfo.id,
                sourceDeviceName = deviceInfo.name,
                sha256 = digest,
                direction = "local",
            )
        }

        val text = item.coerceToText(appContext)?.toString()?.trim().orEmpty()
        if (text.isBlank()) {
            return null
        }
        return HistoryEntry(
            id = UUID.randomUUID().toString(),
            mimeType = "text/plain",
            preview = previewText(text),
            text = text,
            imageBase64 = null,
            createdAt = System.currentTimeMillis(),
            sourceDeviceId = deviceInfo.id,
            sourceDeviceName = deviceInfo.name,
            sha256 = sha256(text.toByteArray()),
            direction = "local",
        )
    }

    private fun applyClipboardEntry(entry: HistoryEntry) {
        if (entry.mimeType == "text/plain" && !entry.text.isNullOrBlank()) {
            clipboardManager.setPrimaryClip(ClipData.newPlainText("ClipVault", entry.text))
            suppressedClipboardSignature = "text/plain:${entry.sha256}"
            lastClipboardSignature = suppressedClipboardSignature
            return
        }

        if (entry.mimeType == "image/png" && !entry.imageBase64.isNullOrBlank()) {
            val bytes = android.util.Base64.decode(entry.imageBase64, android.util.Base64.DEFAULT)
            val imageFile = File(appContext.cacheDir, "clipvault-images/${entry.sha256}.png")
            imageFile.parentFile?.mkdirs()
            imageFile.writeBytes(bytes)
            val uri = FileProvider.getUriForFile(
                appContext,
                "${appContext.packageName}.fileprovider",
                imageFile,
            )
            clipboardManager.setPrimaryClip(ClipData.newUri(appContext.contentResolver, "ClipVault Image", uri))
            suppressedClipboardSignature = "image/png:${entry.sha256}"
            lastClipboardSignature = suppressedClipboardSignature
        }
    }

    private fun broadcastClipboardEntry(entry: HistoryEntry, originPeerId: String?, routeId: String) {
        rememberRoute(routeId)
        val payload = JSONObject().apply {
            put("type", "clipboard_update")
            put("routeId", routeId)
            put("entry", entry.toJson())
        }
        var sentCount = 0
        peers.values.forEach { peer ->
            if (peer.device.id != originPeerId) {
                try {
                    writeFrame(peer.output, payload)
                    sentCount += 1
                } catch (_: Exception) {
                    disconnectPeer(peer.device.id)
                }
            }
        }
        Log.d("ClipVaultRuntime", "broadcast clipboard route=$routeId peers=${peers.size} sent=$sentCount preview=${entry.preview}")
        serviceStatus = "online"
        statusMessage = if (peers.isEmpty()) "本地历史已更新" else "已同步到已连接设备"
        notifyState()
    }

    private fun readSocketLoop(peer: SocketPeer) {
        executor.execute {
            try {
                while (!peer.socket.isClosed) {
                    val length = peer.input.readInt()
                    val buffer = ByteArray(length)
                    peer.input.readFully(buffer)
                    val message = JSONObject(String(buffer, Charsets.UTF_8))
                    handleSocketMessage(peer, message)
                }
            } catch (_: Exception) {
                disconnectPeer(peer.device.id)
            }
        }
    }

    private fun handleSocketMessage(peer: SocketPeer, message: JSONObject) {
        when (message.optString("type")) {
            "hello" -> {
                val tokenMatched = message.optString("token").isNotBlank() && message.optString("token") == serverIdentity.token
                val secretMatched =
                    message.optString("pairingSecret").isNotBlank() && message.optString("pairingSecret") == currentPairingSecret()
                if (!tokenMatched && !secretMatched) {
                    try {
                        peer.socket.close()
                    } catch (_: Exception) {
                    }
                    return
                }
                val remoteDevice = message.optJSONObject("device") ?: return
                val previousId = peer.device.id
                peer.device.id = remoteDevice.optString("id", peer.device.id)
                peer.device.name = remoteDevice.optString("name", peer.device.name)
                peer.device.platform = remoteDevice.optString("platform", peer.device.platform)
                peer.device.status = "online"
                peer.device.lastSeen = System.currentTimeMillis()
                if (previousId != peer.device.id) {
                    peers.remove(previousId)
                }
                peers[peer.device.id] = peer
                writeFrame(
                    peer.output,
                    JSONObject().apply {
                        put("type", "welcome")
                        put(
                            "server",
                            JSONObject().apply {
                                put("id", deviceInfo.id)
                                put("name", deviceInfo.name)
                                put("platform", deviceInfo.platform)
                            },
                        )
                    },
                )
                serviceStatus = "online"
                statusMessage = "设备已连接，实时同步中"
                notifyState()
            }

            "welcome" -> {
                val server = message.optJSONObject("server")
                if (server != null) {
                    val previousId = peer.device.id
                    peer.device.id = server.optString("id", peer.device.id)
                    peer.device.name = server.optString("name", peer.device.name)
                    peer.device.platform = server.optString("platform", peer.device.platform)
                    if (previousId != peer.device.id) {
                        peers.remove(previousId)
                        peers[peer.device.id] = peer
                    }
                }
                peer.device.lastSeen = System.currentTimeMillis()
                peer.device.status = "online"
                serviceStatus = "online"
                statusMessage = "连接已建立"
                notifyState()
            }

            "clipboard_update" -> {
                val routeId = message.optString("routeId", UUID.randomUUID().toString())
                if (isRouteKnown(routeId)) {
                    return
                }
                rememberRoute(routeId)
                val entryJson = message.optJSONObject("entry") ?: return
                val entry = HistoryEntry(
                    id = UUID.randomUUID().toString(),
                    mimeType = entryJson.getString("mimeType"),
                    preview = entryJson.getString("preview"),
                    text = entryJson.optString("text").takeIf { entryJson.has("text") && !entryJson.isNull("text") },
                    imageBase64 = entryJson.optString("imageBase64").takeIf { entryJson.has("imageBase64") && !entryJson.isNull("imageBase64") },
                    createdAt = System.currentTimeMillis(),
                    sourceDeviceId = entryJson.getString("sourceDeviceId"),
                    sourceDeviceName = entryJson.getString("sourceDeviceName"),
                    sha256 = entryJson.getString("sha256"),
                    direction = "inbound",
                )
                applyClipboardEntry(entry)
                pushHistory(entry)
                broadcastClipboardEntry(entry.copy(direction = "outbound"), peer.device.id, routeId)
            }
        }
    }

    private fun writeFrame(output: DataOutputStream, payload: JSONObject) {
        val bytes = payload.toString().toByteArray(Charsets.UTF_8)
        synchronized(output) {
            output.writeInt(bytes.size)
            output.write(bytes)
            output.flush()
        }
    }

    private fun readFrame(input: DataInputStream): JSONObject {
        val length = input.readInt()
        val buffer = ByteArray(length)
        input.readFully(buffer)
        return JSONObject(String(buffer, Charsets.UTF_8))
    }

    private fun looksLikeImage(description: ClipDescription?, uri: Uri?): Boolean {
        if (description?.hasMimeType("image/*") == true) {
            return true
        }
        val mime = uri?.let { appContext.contentResolver.getType(it) }.orEmpty()
        return mime.startsWith("image/")
    }

    private fun readImageBytes(uri: Uri): ByteArray? {
        return try {
            appContext.contentResolver.openInputStream(uri)?.use { input -> input.readBytes() }
        } catch (_: Exception) {
            null
        }
    }

    private fun isIgnoringBatteryOptimizations(): Boolean {
        val powerManager = appContext.getSystemService(Context.POWER_SERVICE) as PowerManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            powerManager.isIgnoringBatteryOptimizations(appContext.packageName)
        } else {
            true
        }
    }

    private fun rememberRoute(routeId: String) {
        synchronized(routeIds) {
            routeIds[routeId] = System.currentTimeMillis()
            while (routeIds.size > 512) {
                val firstKey = routeIds.keys.firstOrNull() ?: break
                routeIds.remove(firstKey)
            }
        }
    }

    private fun isRouteKnown(routeId: String): Boolean = synchronized(routeIds) {
        routeIds.containsKey(routeId)
    }

    private fun buildConnectionErrorMessage(exception: Exception, fromPairingCode: Boolean): String {
        val message = exception.message.orEmpty()
        if (message.contains("未连接到局域网") || message.contains("无法推断")) {
            return message
        }
        if (message.contains("不能连接本机")) {
            return message
        }
        if (message.contains("timed out", true) || message.contains("failed to connect", true) || message.contains("ECONN", true)) {
            return if (fromPairingCode) {
                "配对码错误，请确认两台设备在同一 Wi-Fi，且目标设备当前显示的是这个 6 位配对码。"
            } else {
                "连接失败，请重新生成二维码后再试。"
            }
        }
        if (message.contains("Connection reset", true) || message.contains("EOF", true) || message.contains("握手失败")) {
            return if (fromPairingCode) {
                "配对码错误，或目标设备已经刷新了配对信息。"
            } else {
                "二维码已失效，请重新生成后再扫。"
            }
        }
        return if (fromPairingCode) {
            "配对码错误，请确认两台设备在同一 Wi-Fi，且目标设备当前显示的是这个 6 位配对码。"
        } else {
            "连接失败：${message.ifBlank { "请重新生成二维码后再试。" }}"
        }
    }

    private fun createPairingPayload(): JSONObject {
        localAddress = inferLocalAddress()
        val pairingCode = buildPairingCode(currentPairingSecret())
        serverIdentity.pairingCode = pairingCode
        return JSONObject().apply {
            put("version", 1)
            put("host", localAddress)
            put("port", settingsState.serverPort)
            put("serverId", serverIdentity.serverId)
            put("serverName", deviceInfo.name)
            put("platform", deviceInfo.platform)
            put("token", serverIdentity.token)
            put("pairingCode", pairingCode)
            put("pairingSecret", currentPairingSecret())
            put("issuedAt", System.currentTimeMillis())
        }
    }

    private fun inferLocalAddress(): String {
        val interfaces = NetworkInterface.getNetworkInterfaces() ?: return "0.0.0.0"
        while (interfaces.hasMoreElements()) {
            val network = interfaces.nextElement()
            val addresses = network.inetAddresses
            while (addresses.hasMoreElements()) {
                val address = addresses.nextElement()
                if (!address.isLoopbackAddress && address.hostAddress?.contains(':') == false) {
                    return address.hostAddress ?: "0.0.0.0"
                }
            }
        }
        return "0.0.0.0"
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { each -> "%02x".format(each) }

    private fun previewText(text: String): String {
        val normalized = text.replace("\\s+".toRegex(), " ").trim()
        return if (normalized.length > 96) normalized.take(96) + "..." else normalized
    }

    private fun currentPairingSecret(): String = serverIdentity.pairingCode.takeLast(3).padStart(3, '0')

    private fun generatePairingSecret(): String = (0..999).random().toString().padStart(3, '0')

    private fun buildPairingCode(secret: String): String {
        localAddress = inferLocalAddress()
        val hostCode = parseIpv4Parts(localAddress)?.getOrNull(3)?.toString()?.padStart(3, '0') ?: "000"
        return hostCode + secret.padStart(3, '0').takeLast(3)
    }

    private fun resolveHostFromPairingCode(pairingCode: String): String {
        localAddress = inferLocalAddress()
        val currentParts =
            parseIpv4Parts(localAddress) ?: throw IllegalStateException("当前设备未连接到局域网 Wi-Fi，请先连到同一网络。")
        val targetSuffix = pairingCode.take(3).toIntOrNull()
            ?: throw IllegalStateException("配对码格式不正确，请输入 6 位数字。")
        if (targetSuffix !in 1..254) {
            throw IllegalStateException("配对码格式不正确，请输入有效的 6 位配对码。")
        }
        return "${currentParts[0]}.${currentParts[1]}.${currentParts[2]}.$targetSuffix"
    }

    private fun parseIpv4Parts(address: String): List<Int>? {
        val parts = address.split('.')
        if (parts.size != 4) {
            return null
        }
        val numbers = parts.map { it.toIntOrNull() ?: return null }
        if (numbers.any { it !in 0..255 }) {
            return null
        }
        return numbers
    }

    private fun generatePairingCode(): String = buildPairingCode(generatePairingSecret())

    private fun HistoryEntry.toJson(): JSONObject =
        JSONObject().apply {
            put("id", id)
            put("mimeType", mimeType)
            put("preview", preview)
            put("text", text ?: JSONObject.NULL)
            put("imageBase64", imageBase64 ?: JSONObject.NULL)
            put("createdAt", createdAt)
            put("sourceDeviceId", sourceDeviceId)
            put("sourceDeviceName", sourceDeviceName)
            put("sha256", sha256)
            put("direction", direction)
        }
}
