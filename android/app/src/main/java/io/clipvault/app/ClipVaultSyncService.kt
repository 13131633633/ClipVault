package io.clipvault.app

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat

class ClipVaultSyncService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        acquireWakeLock()
        ClipVaultRuntime.initialize(applicationContext)
        startForeground(NOTIFICATION_ID, createNotification())
        AdvancedAdbManager.ensurePersistentConnection(applicationContext, "service-create")
        ClipVaultWatchdogWorker.schedule(applicationContext)
        scheduleWatchdog()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        acquireWakeLock()
        ClipVaultRuntime.initialize(applicationContext)
        startForeground(NOTIFICATION_ID, createNotification())
        AdvancedAdbManager.handleServiceIntent(applicationContext, intent)
        AdvancedAdbManager.ensurePersistentConnection(
            applicationContext,
            intent?.action ?: "service-start",
        )
        ClipVaultWatchdogWorker.schedule(applicationContext)
        scheduleWatchdog()
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        scheduleRestart()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        scheduleRestart()
        releaseWakeLock()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotification(): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "ClipVault Sync",
                NotificationManager.IMPORTANCE_LOW,
            )
            channel.description = "保持剪贴板同步和局域网连接"
            manager.createNotificationChannel(channel)
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("ClipVault 正在同步")
            .setContentText("局域网剪贴板同步服务保持运行中")
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun acquireWakeLock() {
        val current = wakeLock
        if (current?.isHeld == true) {
            return
        }
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "ClipVault:SyncKeepAlive",
        ).apply {
            setReferenceCounted(false)
            acquire(12 * 60 * 60 * 1000L)
        }
    }

    private fun releaseWakeLock() {
        val current = wakeLock
        if (current?.isHeld == true) {
            current.release()
        }
        wakeLock = null
    }

    private fun scheduleWatchdog() {
        val watchdogIntent = Intent(applicationContext, ClipVaultWatchdogReceiver::class.java).apply {
            action = ACTION_WATCHDOG
        }
        val pendingIntent = PendingIntent.getBroadcast(
            applicationContext,
            1,
            watchdogIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val triggerAt = SystemClock.elapsedRealtime() + 20_000L
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
            alarmManager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent)
        } else {
            alarmManager.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent)
        }
    }

    private fun scheduleRestart() {
        if (!ClipVaultRuntime.shouldLaunchAtStartup()) {
            return
        }
        val restartIntent = Intent(applicationContext, ClipVaultWatchdogReceiver::class.java).apply {
            action = ACTION_RESTART
        }
        val pendingIntent = PendingIntent.getBroadcast(
            applicationContext,
            0,
            restartIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val triggerAt = SystemClock.elapsedRealtime() + 1800L
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarmManager.canScheduleExactAlarms()) {
            alarmManager.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent)
        } else {
            alarmManager.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent)
        }
    }

    companion object {
        const val ACTION_RESTART = "io.clipvault.app.RESTART_SYNC"
        const val ACTION_WATCHDOG = "io.clipvault.app.WATCHDOG_SYNC"
        const val CHANNEL_ID = "clipvault_sync"
        const val NOTIFICATION_ID = 3007
    }
}
