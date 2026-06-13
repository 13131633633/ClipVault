package io.clipvault.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.os.Build
import androidx.activity.result.ActivityResult
import androidx.core.app.ActivityCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

@CapacitorPlugin(name = "ClipVaultNative")
class ClipVaultNativePlugin : Plugin() {
    private val listener = object : ClipVaultRuntime.StateListener {
        override fun onStateChanged(state: JSONObject) {
            notifyListeners(
                "stateChanged",
                JSObject().apply {
                    put("state", JSObject.fromJSONObject(state))
                },
            )
        }
    }

    override fun load() {
        super.load()
        ClipVaultRuntime.initialize(context.applicationContext)
        ClipVaultRuntime.addListener(listener)
    }

    @PluginMethod
    fun start(call: PluginCall) {
        try {
            ClipVaultRuntime.initialize(context.applicationContext)
            ClipVaultRuntime.startForegroundService(context.applicationContext)
            call.resolve(JSObject().apply {
                put("state", JSObject.fromJSONObject(ClipVaultRuntime.getStateJson()))
            })
        } catch (exception: Exception) {
            call.reject(exception.message)
        }
    }

    @PluginMethod
    fun getState(call: PluginCall) {
        call.resolve(JSObject().apply {
            put("state", JSObject.fromJSONObject(ClipVaultRuntime.getStateJson()))
        })
    }

    @PluginMethod
    fun refreshPairing(call: PluginCall) {
        ClipVaultRuntime.refreshPairing()
        call.resolve(JSObject().apply {
            put("state", JSObject.fromJSONObject(ClipVaultRuntime.getStateJson()))
        })
    }

    @PluginMethod
    fun connectWithPayload(call: PluginCall) {
        val payload = call.getString("payload")
        if (payload.isNullOrBlank()) {
            call.reject("配对内容为空。")
            return
        }
        Thread {
            try {
                ClipVaultRuntime.connectWithPayload(payload)
                val result = JSObject().apply {
                    put("state", JSObject.fromJSONObject(ClipVaultRuntime.getStateJson()))
                }
                activity?.runOnUiThread {
                    call.resolve(result)
                } ?: call.resolve(result)
            } catch (exception: Exception) {
                activity?.runOnUiThread {
                    call.reject(exception.message)
                } ?: call.reject(exception.message)
            }
        }.start()
    }

    @PluginMethod
    fun disconnectPeer(call: PluginCall) {
        val peerId = call.getString("peerId")
        if (peerId.isNullOrBlank()) {
            call.reject("缺少设备标识。")
            return
        }
        ClipVaultRuntime.disconnectPeer(peerId)
        call.resolve(JSObject().apply {
            put("state", JSObject.fromJSONObject(ClipVaultRuntime.getStateJson()))
        })
    }

    @PluginMethod
    fun disconnectAll(call: PluginCall) {
        ClipVaultRuntime.disconnectAll()
        call.resolve(JSObject().apply {
            put("state", JSObject.fromJSONObject(ClipVaultRuntime.getStateJson()))
        })
    }

    @PluginMethod
    fun copyHistory(call: PluginCall) {
        val entryId = call.getString("entryId")
        if (entryId.isNullOrBlank()) {
            call.reject("缺少记录标识。")
            return
        }
        ClipVaultRuntime.copyHistory(entryId)
        call.resolve(JSObject().apply {
            put("state", JSObject.fromJSONObject(ClipVaultRuntime.getStateJson()))
        })
    }

    @PluginMethod
    fun deleteHistory(call: PluginCall) {
        val entryId = call.getString("entryId")
        if (entryId.isNullOrBlank()) {
            call.reject("缺少记录标识。")
            return
        }
        ClipVaultRuntime.deleteHistory(entryId)
        call.resolve(JSObject().apply {
            put("state", JSObject.fromJSONObject(ClipVaultRuntime.getStateJson()))
        })
    }

    @PluginMethod
    fun clearHistory(call: PluginCall) {
        ClipVaultRuntime.clearHistory()
        call.resolve(JSObject().apply {
            put("state", JSObject.fromJSONObject(ClipVaultRuntime.getStateJson()))
        })
    }

    @PluginMethod
    fun updateSettings(call: PluginCall) {
        val settings = call.getString("settings")
        if (settings.isNullOrBlank()) {
            call.reject("设置参数为空。")
            return
        }
        ClipVaultRuntime.updateSettings(JSONObject(settings))
        call.resolve(JSObject().apply {
            put("state", JSObject.fromJSONObject(ClipVaultRuntime.getStateJson()))
        })
    }

    @PluginMethod
    fun openPermissionGuide(call: PluginCall) {
        ClipVaultRuntime.openPermissionGuide(activity)
        call.resolve()
    }

    @PluginMethod
    fun startAdvancedAdbPairing(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity?.let {
                ActivityCompat.requestPermissions(
                    it,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    4107,
                )
            }
        }
        AdvancedAdbManager.startPairingFlow(activity)
        call.resolve(JSObject().apply {
            put("state", JSObject.fromJSONObject(ClipVaultRuntime.getStateJson()))
        })
    }

    @PluginMethod
    fun scanQrCodeNative(call: PluginCall) {
        val hostActivity = activity
        if (hostActivity == null) {
            call.reject("当前界面还没有准备好。")
            return
        }
        val intent = Intent(hostActivity, ClipVaultScanActivity::class.java)
        startActivityForResult(call, intent, "handleNativeScanResult")
    }

    @ActivityCallback
    fun handleNativeScanResult(call: PluginCall, result: ActivityResult) {
        when (result.resultCode) {
            Activity.RESULT_OK -> {
                val payload = result.data?.getStringExtra(ClipVaultScanActivity.EXTRA_PAYLOAD).orEmpty()
                if (payload.isBlank()) {
                    call.reject("未识别到二维码内容。")
                    return
                }
                call.resolve(JSObject().apply {
                    put("payload", payload)
                })
            }
            Activity.RESULT_CANCELED -> call.reject("已取消扫码。")
            else -> call.reject("扫码失败，请重试。")
        }
    }
}
