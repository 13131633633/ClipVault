package io.clipvault.app

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.google.zxing.BarcodeFormat
import com.google.zxing.ResultPoint
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import com.journeyapps.barcodescanner.DefaultDecoderFactory
import com.journeyapps.barcodescanner.camera.CameraSettings
import kotlin.math.abs

class ClipVaultScanActivity : AppCompatActivity() {
    private lateinit var barcodeView: DecoratedBarcodeView
    private lateinit var hintView: TextView
    private lateinit var torchView: TextView
    private var torchEnabled = false
    private var finished = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_clipvault_scan)

        barcodeView = findViewById(R.id.barcode_scanner)
        hintView = findViewById(R.id.scan_hint)
        torchView = findViewById(R.id.scan_torch)

        val closeView: TextView = findViewById(R.id.scan_close)
        val cancelView: TextView = findViewById(R.id.scan_cancel)

        closeView.setOnClickListener { cancelScan() }
        cancelView.setOnClickListener { cancelScan() }
        torchView.setOnClickListener { toggleTorch() }

        barcodeView.setDecoderFactory(DefaultDecoderFactory(listOf(BarcodeFormat.QR_CODE)))
        barcodeView.initializeFromIntent(intent)
        barcodeView.setCameraSettings(
            CameraSettings().apply {
                setRequestedCameraId(0)
                setAutoFocusEnabled(true)
                setContinuousFocusEnabled(true)
                setMeteringEnabled(true)
            },
        )
        barcodeView.decodeContinuous(callback)
        barcodeView.resume()
    }

    override fun onResume() {
        super.onResume()
        barcodeView.resume()
    }

    override fun onPause() {
        barcodeView.pause()
        super.onPause()
    }

    private val callback = object : BarcodeCallback {
        override fun barcodeResult(result: BarcodeResult?) {
            if (finished || result == null) {
                return
            }
            val payload = result.text?.trim().orEmpty()
            if (payload.isBlank()) {
                return
            }
            if (!looksLikeClipVaultPayload(payload)) {
                hintView.text = "请扫描 ClipVault 生成的二维码"
                return
            }
            finished = true
            hintView.text = "识别成功，正在返回…"
            setResult(
                Activity.RESULT_OK,
                Intent().putExtra(EXTRA_PAYLOAD, payload),
            )
            finish()
        }

        override fun possibleResultPoints(resultPoints: List<ResultPoint>) {
            if (finished || resultPoints.isEmpty()) {
                return
            }
            val spreadX = resultPoints.maxOf { it.x } - resultPoints.minOf { it.x }
            val spreadY = resultPoints.maxOf { it.y } - resultPoints.minOf { it.y }
            hintView.text =
                if (abs(spreadX) < 110f && abs(spreadY) < 110f) {
                    "再靠近一点或稍微停稳，马上就能识别"
                } else {
                    "保持二维码出现在框内，系统正在自动识别"
                }
        }
    }

    private fun toggleTorch() {
        try {
            if (!torchEnabled) {
                barcodeView.setTorchOn()
                torchEnabled = true
                torchView.text = "关闭补光"
            } else {
                barcodeView.setTorchOff()
                torchEnabled = false
                torchView.text = "打开补光"
            }
        } catch (_: Exception) {
            hintView.text = "当前设备不支持补光，直接扫码即可"
        }
    }

    private fun cancelScan() {
        if (finished) {
            return
        }
        finished = true
        setResult(Activity.RESULT_CANCELED)
        finish()
    }

    private fun looksLikeClipVaultPayload(payload: String): Boolean =
        payload.contains("\"pairingCode\"") || payload.contains("\"deviceId\"")

    companion object {
        const val EXTRA_PAYLOAD = "clipvault_scan_payload"
    }
}
