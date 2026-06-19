package com.dskmusic.dsklofi

import android.content.Context
import android.media.MediaScannerConnection
import android.os.Environment
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream

/**
 * DSK•LoFi — DskStorage
 *
 * Guarda TODO lo que produce la app en una única carpeta en la RAÍZ del
 * almacenamiento compartido:
 *
 *     /storage/emulated/0/DSKlofi
 *
 * (audio descargado, PDFs de letras y audio procesado con efectos).
 *
 * Las descargas de audio de YouTube van en /DSKlofi/Downloads, y si la pista
 * pertenece a una lista (local o de YouTube), en /DSKlofi/Downloads/<lista>.
 *
 * IMPORTANTE: escribir en la raíz NO es posible con scoped storage. Requiere:
 *   - Android 11+ (API 30+): permiso "Acceso a todos los archivos"
 *       (MANAGE_EXTERNAL_STORAGE) → Environment.isExternalStorageManager().
 *   - Android 10 (API 29): android:requestLegacyExternalStorage="true" + WRITE.
 *   - Android 9 o anterior: permiso WRITE_EXTERNAL_STORAGE.
 * (Ver MainActivity.ensureStorageAccess() y los cambios del Manifest.)
 *
 * Devuelve el nombre guardado, o null si falló.
 */
object DskStorage {

    /** Carpeta raíz /DSKlofi (la crea si no existe). */
    fun dir(): File {
        val root = Environment.getExternalStorageDirectory()   // /storage/emulated/0
        val dir = File(root, "DSKlofi")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    /** /DSKlofi/Downloads (y opcionalmente /DSKlofi/Downloads/<playlist>). La crea si no existe. */
    fun downloadsDir(playlistName: String? = null): File {
        var d = File(dir(), "Downloads")
        if (!playlistName.isNullOrBlank()) {
            d = File(d, sanitize(playlistName).take(120).ifBlank { "playlist" })
        }
        if (!d.exists()) d.mkdirs()
        return d
    }

    fun saveBytes(ctx: Context, name: String, mime: String, bytes: ByteArray, dest: File = dir()): String? =
        saveStream(ctx, name, mime, dest) { out -> out.write(bytes) }

    fun saveFromStream(ctx: Context, name: String, mime: String, input: InputStream, dest: File = dir()): String? =
        saveStream(ctx, name, mime, dest) { out -> input.copyTo(out, 64 * 1024) }

    private fun saveStream(ctx: Context, name: String, mime: String, dest: File, writer: (OutputStream) -> Unit): String? {
        return try {
            val file = File(dest, name)
            FileOutputStream(file).use { writer(it) }
            // que aparezca en reproductores / gestores de archivos
            try {
                MediaScannerConnection.scanFile(ctx, arrayOf(file.absolutePath), arrayOf(mime), null)
            } catch (e: Exception) {}
            name
        } catch (e: Exception) {
            null
        }
    }

    /** Saneado de nombre de archivo (quita caracteres ilegales). */
    fun sanitize(s: String): String =
        s.replace(Regex("[\\\\/:*?\"<>|\\r\\n\\t]"), " ")
         .replace(Regex("\\s+"), " ")
         .trim()
}
