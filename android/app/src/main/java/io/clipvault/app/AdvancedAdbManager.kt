package io.clipvault.app

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import java.net.NetworkInterface
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

object AdvancedAdbManager {
    const val ACTION_OPEN_WIRELESS_DEBUGGING = "io.clipvault.app.OPEN_WIRELESS_DEBUGGING"
    const val ACTION_SUBMIT_PAIR_CODE = "io.clipvault.app.SUBMIT_ADB_PAIR_CODE"
    const val KEY_PAIR_CODE = "clipvault_pair_code"
    private const val CHANNEL_ID = "clipvault_advanced_adb"
    private const val NOTIFICATION_ID = 4007
    private const val ADB_PAIRING_SERVICE = "_adb-tls-pairing._tcp."
    private const val ADB_CONNECT_SERVICE = "_adb-tls-connect._tcp."
    private const val PREFS_NAME = "clipvault_advanced_adb"
    private const val PREF_AUTO_RECONNECT = "auto_reconnect"
    private const val PREF_LAST_SUCCESS_AT = "last_success_at"
    private val reconnectInFlight = AtomicBoolean(false)

    fun startPairingFlow(activity: Activity?) {
        val context = activity?.applicationContext ?: return
        ClipVaultRuntime.startForegroundService(context)
        showPairingNotification(context, "请输入配对码")
        ClipVaultRuntime.updateAdvancedAdbState("正在检查已配对连接")
        Thread {
            val directConnected = tryDirectReconnect(context, 8_000L)
            if (directConnected) {
                return@Thread
            }
            ClipVaultRuntime.updateAdvancedAdbState("等待输入配对码")
            showPairingNotification(context, "请输入配对码")
            openWirelessDebuggingSettings(activity, context)
        }.start()
    }

    fun ensurePersistentConnection(context: Context, reason: String = "auto") {
        if (!shouldAutoReconnect(context)) {
            return
        }
        if (!reconnectInFlight.compareAndSet(false, true)) {
            return
        }
        Thread {
            try {
                val manager = ClipVaultAdbConnectionManager.get(context)
                if (manager.isConnected()) {
                    markAutoReconnectEnabled(context)
                    ClipVaultRuntime.updateAdvancedAdbState("高级后台同步已连接")
                    return@Thread
                }
                ClipVaultRuntime.updateAdvancedAdbState("正在自动连接高级后台同步")
                val connected = tryDirectReconnect(context, 6_000L)
                if (!connected) {
                    ClipVaultRuntime.updateAdvancedAdbState("已配对，等待无线调试服务可用")
                    Log.d("ClipVaultAdvancedAdb", "auto reconnect unavailable reason=$reason")
                }
            } catch (exception: Exception) {
                Log.d("ClipVaultAdvancedAdb", "auto reconnect skipped reason=$reason error=${exception.message}")
            } finally {
                reconnectInFlight.set(false)
            }
        }.apply {
            name = "ClipVaultAdbAutoReconnect"
            isDaemon = true
            start()
        }
    }

    fun scheduleReconnect(context: Context, delayMs: Long, reason: String = "retry") {
        if (!shouldAutoReconnect(context)) {
            return
        }
        Thread {
            try {
                Thread.sleep(delayMs)
                ensurePersistentConnection(context, reason)
            } catch (_: InterruptedException) {
            }
        }.apply {
            name = "ClipVaultAdbReconnectDelay"
            isDaemon = true
            start()
        }
    }

    fun handleServiceIntent(context: Context, intent: Intent?) {
        when (intent?.action) {
            ACTION_OPEN_WIRELESS_DEBUGGING -> openWirelessDebuggingSettings(null, context)
            ACTION_SUBMIT_PAIR_CODE -> {
                val input = RemoteInput.getResultsFromIntent(intent)
                val code = input?.getCharSequence(KEY_PAIR_CODE)?.toString()?.trim().orEmpty()
                if (!Regex("^\\d{6}$").matches(code)) {
                    showPairingNotification(context, "配对码必须是系统弹窗里的 6 位数字。")
                    return
                }
                ClipVaultRuntime.updateAdvancedAdbState("正在输入配对码")
                showPairingNotification(context, "请输入配对码")
                Thread {
                    runPairing(context, code)
                }.start()
            }
        }
    }

    private fun runPairing(context: Context, code: String) {
        try {
            val target = discoverPairingTarget(context)
            if (target == null) {
                showPairingNotification(context, "没有发现无线调试配对端口，请确认配对弹窗还停留在屏幕上。")
                ClipVaultRuntime.updateAdvancedAdbState("未发现配对端口")
                return
            }
            showPairingNotification(context, "已发现 ${target.host}:${target.port}，正在配对…")
            ClipVaultRuntime.updateAdvancedAdbState("正在配对无线调试")
            val manager = ClipVaultAdbConnectionManager.get(context)
            val paired = manager.pair(target.host, target.port, code)
            if (!paired) {
                showPairingNotification(context, "ADB 配对失败，请重新生成配对码。")
                ClipVaultRuntime.updateAdvancedAdbState("ADB 配对失败")
                return
            }
            showPairingNotification(context, "配对成功，正在连接…")
            ClipVaultRuntime.updateAdvancedAdbState("配对成功，正在连接")
            val connected = connectToLocalTlsService(context, manager, target.host, 15_000L)
            if (!connected) {
                showPairingNotification(context, "已配对，请再点一次高级后台同步。")
                ClipVaultRuntime.updateAdvancedAdbState("已配对，等待直连")
                markAutoReconnectEnabled(context)
                return
            }
            AdbClipboardBridge.ensureRunning(context, manager)
            markAutoReconnectEnabled(context)
            ClipVaultRuntime.updateAdvancedAdbState("高级后台同步已连接")
            showPairingNotification(context, "高级后台同步已连接")
            Log.d("ClipVaultAdvancedAdb", "pair/connect ok target=${target.host}:${target.port}")
        } catch (exception: Exception) {
            Log.e("ClipVaultAdvancedAdb", "pairing failed", exception)
            showPairingNotification(context, formatPairingError(exception))
            ClipVaultRuntime.updateAdvancedAdbState("等待重新配对")
        }
    }

    private fun formatPairingError(exception: Exception): String {
        val message = exception.message.orEmpty()
        return when {
            message.contains("cannot create signer", ignoreCase = true) ->
                "本机 ADB 配对证书初始化失败，已自动修复。请重新打开无线调试配对弹窗，再输入一次 6 位配对码。"
            message.contains("certificate", ignoreCase = true) ->
                "本机 ADB 配对证书异常，已自动重建。请重新生成系统配对码后再试一次。"
            else ->
                "配对失败：${exception.message ?: "请重新打开无线调试配对弹窗"}"
        }
    }

    private fun tryDirectReconnect(context: Context, timeoutMs: Long): Boolean {
        return try {
            val manager = ClipVaultAdbConnectionManager.get(context)
            if (manager.isConnected()) {
                markAutoReconnectEnabled(context)
                ClipVaultRuntime.updateAdvancedAdbState("高级后台同步已连接")
                showPairingNotification(context, "高级后台同步已连接")
                return true
            }
            showPairingNotification(context, "正在尝试直接连接…")
            ClipVaultRuntime.updateAdvancedAdbState("正在尝试直接连接")
            val connected = connectToLocalTlsService(context, manager, inferLocalAddress(), timeoutMs)
            if (connected) {
                AdbClipboardBridge.ensureRunning(context, manager)
                markAutoReconnectEnabled(context)
                ClipVaultRuntime.updateAdvancedAdbState("高级后台同步已连接")
                showPairingNotification(context, "高级后台同步已连接")
                true
            } else {
                false
            }
        } catch (exception: Exception) {
            Log.d("ClipVaultAdvancedAdb", "direct reconnect unavailable: ${exception.message}")
            false
        }
    }

    private fun connectToLocalTlsService(
        context: Context,
        manager: ClipVaultAdbConnectionManager,
        expectedHost: String?,
        timeoutMs: Long,
    ): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        val triedTargets = linkedSetOf<String>()
        while (System.currentTimeMillis() < deadline) {
            val remaining = deadline - System.currentTimeMillis()
            val target = discoverTarget(context, ADB_CONNECT_SERVICE, expectedHost, minOf(remaining, 3_500L))
            if (target == null) {
                continue
            }
            val key = "${target.host}:${target.port}"
            if (!triedTargets.add(key)) {
                continue
            }
            try {
                manager.disconnect()
            } catch (_: Exception) {
            }
            try {
                return manager.connect(target.host, target.port)
            } catch (exception: Exception) {
                Log.d("ClipVaultAdvancedAdb", "connect retry failed target=$key error=${exception.message}")
            }
        }
        return false
    }

    private fun discoverPairingTarget(context: Context): PairTarget? =
        discoverTarget(context, ADB_PAIRING_SERVICE, inferLocalAddress(), 18_000L)

    private fun discoverTarget(
        context: Context,
        serviceType: String,
        preferredHost: String?,
        waitMs: Long,
    ): PairTarget? {
        val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
        val latch = CountDownLatch(1)
        var target: PairTarget? = null
        var discoveryListener: NsdManager.DiscoveryListener? = null

        fun stopDiscovery() {
            try {
                discoveryListener?.let(nsdManager::stopServiceDiscovery)
            } catch (_: Exception) {
            }
        }

        discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) = Unit
            override fun onDiscoveryStopped(serviceType: String) = Unit
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                latch.countDown()
            }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
            override fun onServiceLost(serviceInfo: NsdServiceInfo) = Unit

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                if (serviceInfo.serviceType != serviceType) {
                    return
                }
                nsdManager.resolveService(
                    serviceInfo,
                    object : NsdManager.ResolveListener {
                        override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = Unit

                        override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                            val host = serviceInfo.host?.hostAddress
                            if (
                                !host.isNullOrBlank() &&
                                serviceInfo.port > 0 &&
                                (preferredHost.isNullOrBlank() || preferredHost == host)
                            ) {
                                target = PairTarget(host, serviceInfo.port)
                                stopDiscovery()
                                latch.countDown()
                            }
                        }
                    },
                )
            }
        }

        nsdManager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, discoveryListener)
        latch.await(waitMs, TimeUnit.MILLISECONDS)
        stopDiscovery()
        return target
    }

    private fun openWirelessDebuggingSettings(activity: Activity?, context: Context? = null) {
        val base = activity ?: context ?: return
        val candidates = listOf(
            Intent("com.android.settings.WIRELESS_DEBUGGING_SETTINGS"),
            Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS),
        )
        for (intent in candidates) {
            try {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                base.startActivity(intent)
                return
            } catch (_: Exception) {
            }
        }
    }

    private fun showPairingNotification(context: Context, message: String) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "ClipVault Advanced ADB",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "无线调试配对与高级后台同步"
                },
            )
        }

        val openIntent = Intent(context, ClipVaultSyncService::class.java).apply {
            action = ACTION_OPEN_WIRELESS_DEBUGGING
        }
        val openPendingIntent = PendingIntent.getService(
            context,
            4008,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val submitIntent = Intent(context, ClipVaultSyncService::class.java).apply {
            action = ACTION_SUBMIT_PAIR_CODE
        }
        val submitPendingIntent = PendingIntent.getService(
            context,
            4009,
            submitIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
        val remoteInput = RemoteInput.Builder(KEY_PAIR_CODE)
            .setLabel("输入 6 位配对码")
            .build()
        val pairAction = NotificationCompat.Action.Builder(
            R.mipmap.ic_launcher,
            "输入配对码",
            submitPendingIntent,
        )
            .addRemoteInput(remoteInput)
            .setAllowGeneratedReplies(false)
            .build()

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("ClipVault 高级后台同步")
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .addAction(R.mipmap.ic_launcher, "打开无线调试", openPendingIntent)
            .addAction(pairAction)
            .build()

        manager.notify(NOTIFICATION_ID, notification)
    }

    private fun inferLocalAddress(): String? {
        val interfaces = NetworkInterface.getNetworkInterfaces() ?: return null
        while (interfaces.hasMoreElements()) {
            val network = interfaces.nextElement()
            val addresses = network.inetAddresses
            while (addresses.hasMoreElements()) {
                val address = addresses.nextElement()
                val host = address.hostAddress
                if (!address.isLoopbackAddress && !host.isNullOrBlank() && !host.contains(':')) {
                    return host
                }
            }
        }
        return null
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun markAutoReconnectEnabled(context: Context) {
        prefs(context)
            .edit()
            .putBoolean(PREF_AUTO_RECONNECT, true)
            .putLong(PREF_LAST_SUCCESS_AT, System.currentTimeMillis())
            .apply()
    }

    private fun shouldAutoReconnect(context: Context): Boolean =
        prefs(context).getBoolean(PREF_AUTO_RECONNECT, false)

    private data class PairTarget(val host: String, val port: Int)
}
