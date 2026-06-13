package io.clipvault.app

import android.content.Context
import io.github.muntashirakon.adb.AbsAdbConnectionManager
import java.io.File
import java.math.BigInteger
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.cert.Certificate
import java.security.cert.CertificateFactory
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Date
import android.util.Base64
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder

class ClipVaultAdbConnectionManager private constructor(
    private val context: Context,
) : AbsAdbConnectionManager() {
    private val keyFile = File(context.filesDir, "clipvault-adb.key")
    private val certFile = File(context.filesDir, "clipvault-adb.crt")
    private val privateKey: PrivateKey
    private val certificate: Certificate

    init {
        val material = loadOrCreateMaterial()
        privateKey = material.first
        certificate = material.second
        setHostAddress("127.0.0.1")
        setApi(android.os.Build.VERSION.SDK_INT)
        setThrowOnUnauthorised(true)
    }

    override fun getPrivateKey(): PrivateKey = privateKey

    override fun getCertificate(): Certificate = certificate

    override fun getDeviceName(): String = "ClipVault"

    private fun loadOrCreateMaterial(): Pair<PrivateKey, Certificate> {
        return try {
            if (keyFile.isFile && certFile.isFile) {
                val keyBytes = Base64.decode(keyFile.readText(), Base64.DEFAULT)
                val certBytes = Base64.decode(certFile.readText(), Base64.DEFAULT)
                val key = KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(keyBytes))
                val cert = CertificateFactory.getInstance("X.509").generateCertificate(certBytes.inputStream())
                key to cert
            } else {
                createAndPersistMaterial()
            }
        } catch (_: Exception) {
            keyFile.delete()
            certFile.delete()
            createAndPersistMaterial()
        }
    }

    private fun createCertificate(keyPair: java.security.KeyPair): Certificate {
        val now = System.currentTimeMillis()
        val from = Date(now - 60_000L)
        val to = Date(now + 20L * 365L * 24L * 60L * 60L * 1000L)
        val owner = X500Name("CN=ClipVault,O=ClipVault")
        val signer = JcaContentSignerBuilder("SHA256withRSA")
            .build(keyPair.private)
        val holder = JcaX509v3CertificateBuilder(
            owner,
            BigInteger.valueOf(now),
            from,
            to,
            owner,
            keyPair.public,
        ).build(signer)
        return JcaX509CertificateConverter().getCertificate(holder)
    }

    private fun createAndPersistMaterial(): Pair<PrivateKey, Certificate> {
        val keyPair = KeyPairGenerator.getInstance("RSA").apply {
            initialize(2048)
        }.generateKeyPair()
        val cert = createCertificate(keyPair)
        keyFile.writeText(Base64.encodeToString(keyPair.private.encoded, Base64.NO_WRAP))
        certFile.writeText(Base64.encodeToString(cert.encoded, Base64.NO_WRAP))
        return keyPair.private to cert
    }

    companion object {
        @Volatile
        private var instance: ClipVaultAdbConnectionManager? = null

        fun get(context: Context): ClipVaultAdbConnectionManager =
            instance ?: synchronized(this) {
                instance ?: ClipVaultAdbConnectionManager(context.applicationContext).also {
                    instance = it
                }
            }
    }
}
