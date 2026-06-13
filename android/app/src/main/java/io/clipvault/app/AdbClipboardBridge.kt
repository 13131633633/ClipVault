package io.clipvault.app

import android.content.Context
import android.util.Log
import io.github.muntashirakon.adb.AdbStream
import java.io.BufferedReader
import java.io.InputStreamReader
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

object AdbClipboardBridge {
    private val running = AtomicBoolean(false)

    fun ensureRunning(context: Context, manager: ClipVaultAdbConnectionManager) {
        if (!running.compareAndSet(false, true)) {
            return
        }
        Thread {
            try {
                applyKeepAliveTweaks(manager, context.packageName)
                streamClipboardAgent(context, manager)
            } catch (exception: Exception) {
                Log.e("ClipVaultAdbBridge", "bridge stopped", exception)
                ClipVaultRuntime.updateAdvancedAdbState("高级后台同步已断开")
                AdvancedAdbManager.scheduleReconnect(context.applicationContext, 1_500L, "bridge-stopped")
            } finally {
                running.set(false)
            }
        }.apply {
            name = "ClipVaultAdbClipboardBridge"
            isDaemon = true
            start()
        }
    }

    private fun applyKeepAliveTweaks(manager: ClipVaultAdbConnectionManager, packageName: String) {
        val command = buildString {
            append("cmd deviceidle whitelist +")
            append(packageName)
            append(" >/dev/null 2>&1; ")
            append("cmd activity set-standby-bucket ")
            append(packageName)
            append(" active >/dev/null 2>&1; ")
            append("cmd appops set ")
            append(packageName)
            append(" RUN_IN_BACKGROUND allow >/dev/null 2>&1; ")
            append("cmd appops set ")
            append(packageName)
            append(" RUN_ANY_IN_BACKGROUND allow >/dev/null 2>&1")
        }
        runFireAndForget(manager, command)
    }

    private fun streamClipboardAgent(context: Context, manager: ClipVaultAdbConnectionManager) {
        val command = buildString {
            append("export ANDROID_ROOT=/system; ")
            append("export ANDROID_DATA=/data; ")
            append("CLASSPATH=")
            append(context.packageCodePath)
            append(" app_process /system/bin io.clipvault.app.ClipVaultShellAgent watch-clipboard")
        }
        val stream = manager.openStream("shell:$command")
        stream.use {
            val reader = BufferedReader(InputStreamReader(it.openInputStream(), StandardCharsets.UTF_8))
            while (true) {
                val line = reader.readLine() ?: break
                handleAgentLine(line)
            }
        }
    }

    private fun handleAgentLine(line: String) {
        val payload = try {
            JSONObject(line)
        } catch (_: Exception) {
            return
        }
        if (payload.optString("type") != "clipboard") {
            return
        }
        val text = payload.optString("text")
        if (text.isNotBlank()) {
            ClipVaultRuntime.ingestAdvancedClipboardText(text)
        }
    }

    private fun runFireAndForget(manager: ClipVaultAdbConnectionManager, command: String) {
        try {
            val stream: AdbStream = manager.openStream("shell:$command")
            stream.close()
        } catch (exception: Exception) {
            Log.d("ClipVaultAdbBridge", "keepalive tweaks skipped: ${exception.message}")
        }
    }
}
