package local.mistake.notebook.mobile

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.Manifest
import android.content.pm.PackageManager
import android.provider.MediaStore
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import java.io.File
import java.util.UUID
import org.json.JSONArray
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg class SecureArgs { lateinit var key: String; var value: String? = null }
@InvokeArg class UrlArgs { lateinit var url: String }
@InvokeArg class ExportArgs { lateinit var name: String; lateinit var contents: String }
@InvokeArg class CaptureArgs { var camera: Boolean = false }
@InvokeArg class SnapshotOption { lateinit var name: String; var modifiedMs: Long = 0; var size: Long = 0 }
@InvokeArg class SnapshotArgs { lateinit var snapshots: Array<SnapshotOption> }

/** Invoked only from Rust's private bridge, never a public frontend credential API. */
@TauriPlugin
class NotebookMobilePlugin(private val activity: Activity): Plugin(activity) {
    private val worker = Executors.newSingleThreadExecutor()
    private val preferences by lazy { activity.getSharedPreferences("ctb-secure-v1", Activity.MODE_PRIVATE) }
    private var cameraFile: File? = null
    private fun importDirectory() = File(activity.cacheDir, "capture-imports").apply { mkdirs() }
    private fun key(): SecretKey {
        val alias = activity.packageName + ".ctb.secure.v1"
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (store.containsAlias(alias)) return store.getKey(alias, null) as SecretKey
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }
    private fun validKey(value: String) { require(value.matches(Regex("[a-zA-Z0-9._-]{1,240}"))) }
    @Command fun secureRead(invoke: Invoke) {
        val args = invoke.parseArgs(SecureArgs::class.java)
        worker.execute {
            try {
                validKey(args.key)
                val encrypted = preferences.getString(args.key, null)
                val result = JSObject()
                if (encrypted != null) {
                    val parts = encrypted.split(":"); require(parts.size == 2)
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
                    cipher.updateAAD((activity.packageName + ":" + args.key).toByteArray(Charsets.UTF_8))
                    result.put("value", String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8))
                }
                invoke.resolve(result)
            } catch (_: Exception) { invoke.reject("安全存储读取失败；没有清空原凭据") }
        }
    }
    @Command fun secureWrite(invoke: Invoke) {
        val args = invoke.parseArgs(SecureArgs::class.java)
        worker.execute {
            try {
                validKey(args.key)
                val edit = preferences.edit()
                if (args.value == null) edit.remove(args.key) else {
                    require(args.value!!.length <= 16384)
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.ENCRYPT_MODE, key())
                    cipher.updateAAD((activity.packageName + ":" + args.key).toByteArray(Charsets.UTF_8))
                    val value = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(args.value!!.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
                    edit.putString(args.key, value)
                }
                check(edit.commit()); invoke.resolve(JSObject())
            } catch (_: Exception) { invoke.reject("安全存储写入失败；不使用明文回退") }
        }
    }
    @Command fun openAuthorization(invoke: Invoke) {
        try {
            val url = Uri.parse(invoke.parseArgs(UrlArgs::class.java).url)
            require(url.scheme == "https" && url.host == "accounts.feishu.cn" && url.path == "/open-apis/authen/v1/authorize" && url.userInfo == null)
            activity.startActivity(Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE))
            invoke.resolve(JSObject())
        } catch (_: Exception) { invoke.reject("无法打开飞书授权浏览器") }
    }
    @Command fun exportJson(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(ExportArgs::class.java)
            require(args.name.endsWith(".json") && !args.name.contains('/'))
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE, args.name)
            startActivityForResult(invoke, intent, "exportResult")
        } catch (_: Exception) { invoke.reject("无法打开系统保存窗口") }
    }
    @Command fun selectSnapshot(invoke: Invoke) {
        try {
            val snapshots = invoke.parseArgs(SnapshotArgs::class.java).snapshots
            require(snapshots.isNotEmpty())
            val format = java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT)
            val labels = snapshots.map { format.format(java.util.Date(it.modifiedMs)) + " · " + (it.size / 1024).coerceAtLeast(1) + " KB" }.toTypedArray()
            AlertDialog.Builder(activity).setTitle("选择同步前自动备份")
                .setItems(labels) { _, index -> invoke.resolve(JSObject().put("name", snapshots[index].name)) }
                .setNegativeButton("取消") { _, _ -> invoke.resolve(JSObject()) }
                .setOnCancelListener { invoke.resolve(JSObject()) }.show()
        } catch (_: Exception) { invoke.reject("无法选择自动备份") }
    }
    @ActivityCallback fun exportResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) { invoke.resolve(JSObject()); return }
        val uri = result.data?.data ?: run { invoke.reject("保存位置不可用"); return }
        worker.execute {
            try {
                val args = invoke.parseArgs(ExportArgs::class.java)
                val stream = activity.contentResolver.openOutputStream(uri, "wt") ?: error("无法写入")
                stream.use { it.write(args.contents.toByteArray(Charsets.UTF_8)); it.flush() }
                invoke.resolve(JSObject().put("path", uri.toString()))
            } catch (_: Exception) { invoke.reject("备份写入失败，请检查空间和保存位置") }
        }
    }
    @Command fun pickImages(invoke: Invoke) {
        try {
            if (invoke.parseArgs(CaptureArgs::class.java).camera) {
                require(activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
                val file = File(importDirectory(), UUID.randomUUID().toString() + ".jpg")
                cameraFile = file
                val uri = FileProvider.getUriForFile(activity, activity.packageName + ".notebookfiles", file)
                val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, uri)
                    .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                startActivityForResult(invoke, intent, "cameraResult")
            } else {
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE)
                    .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                startActivityForResult(invoke, intent, "imagesResult")
            }
        } catch (_: Exception) { cameraFile?.delete(); cameraFile = null; invoke.reject("无法打开相册或相机，请检查权限和可用空间") }
    }
    @ActivityCallback fun cameraResult(invoke: Invoke, result: ActivityResult) {
        val file = cameraFile; cameraFile = null
        if (result.resultCode != Activity.RESULT_OK || file == null) { file?.delete(); invoke.resolve(JSObject().put("paths", JSONArray())); return }
        invoke.resolve(JSObject().put("paths", JSONArray().put(file.absolutePath)))
    }
    @ActivityCallback fun imagesResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) { invoke.resolve(JSObject().put("paths", JSONArray())); return }
        val data = result.data
        val uris = if (data?.clipData != null) (0 until data.clipData!!.itemCount).map { data.clipData!!.getItemAt(it).uri } else listOfNotNull(data?.data)
        worker.execute {
            val paths = JSONArray(); var skipped = 0; var total = 0L
            for (uri in uris.take(50)) {
                val file = File(importDirectory(), UUID.randomUUID().toString() + ".image")
                try {
                    activity.contentResolver.openInputStream(uri).use { input ->
                        require(input != null)
                        file.outputStream().use { output ->
                            val buffer = ByteArray(65536); var length = 0L
                            while (true) {
                                val count = input.read(buffer); if (count < 0) break
                                length += count; require(length <= 25L * 1024 * 1024 && total + length <= 50L * 1024 * 1024)
                                output.write(buffer, 0, count)
                            }
                            require(length > 0); total += length
                        }
                    }
                    paths.put(file.absolutePath)
                } catch (_: Exception) { file.delete(); skipped++ }
            }
            invoke.resolve(JSObject().put("paths", paths).put("skipped", skipped + (uris.size - 50).coerceAtLeast(0)))
        }
    }
}
