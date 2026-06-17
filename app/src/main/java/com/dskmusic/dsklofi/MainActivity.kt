package com.dskmusic.dsklofi

import android.app.Activity
import android.os.Bundle
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.JavascriptInterface
import java.util.concurrent.Executors
import android.webkit.WebChromeClient
import android.webkit.ValueCallback
import android.webkit.PermissionRequest
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.util.Base64
import java.io.File
import java.io.FileOutputStream
import android.os.Environment
import android.widget.Toast
import android.content.Intent
import android.content.Context
import android.content.ClipData
import android.content.ClipboardManager
import android.net.Uri
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import android.Manifest
import java.io.InputStream
import android.graphics.Color
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import java.io.ByteArrayOutputStream
import androidx.core.view.WindowCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import android.provider.DocumentsContract

class MainActivity : Activity() {

    companion object {
        private var ref: java.lang.ref.WeakReference<MainActivity>? = null
        // Llamado desde PlaybackService para controlar la app web (toggle / timer).
        fun runJs(js: String) { ref?.get()?.evalJs(js) }
        // Pool para browseAsync() (escaneo SAF fuera del hilo del WebView).
        private val browsePool = Executors.newCachedThreadPool()
    }

    // Ejecuta JS en el WebView desde el hilo de UI (lo usa la notificación nativa).
    fun evalJs(js: String) {
        runOnUiThread {
            if (!::webView.isInitialized) return@runOnUiThread
            try { webView.resumeTimers(); webView.onResume() } catch (e: Exception) {}
            webView.evaluateJavascript(js, null)
        }
    }

    private lateinit var webView: WebView
    private val PERMISSION_REQUEST_CODE = 1001
    private var uploadMessage: ValueCallback<Array<Uri>>? = null
    private val REQUEST_SELECT_FILE = 100
    private val REQUEST_PICK_AUDIO = 200   // picker de audio → carga toda la carpeta
    private val REQUEST_PICK_TREE = 201    // picker de carpeta (SAF tree) → 100% fiable
    private val REQUEST_ADD_ROOT = 202     // añadir carpeta raíz al explorador (no toca la cola)
    private val REQUEST_RELINK_ROOT = 203  // re-vincular carpeta pendiente tras importar configuración

    // URI (string) de la carpeta pendiente que se está re-vinculando, o null
    private var relinkPendingUri: String? = null

    // Playlist nativa: URIs de los audios de la carpeta del archivo elegido
    private var folderUris: List<Uri> = emptyList()
    private var hasIncomingAudio = false

    // Mapa para trackear callbacks pendientes por track
    private val pendingCallbacks = mutableMapOf<String, String>()

    // Texto de un proyecto .dsk abierto desde el explorador (pendiente de cargar en el WebView)
    private var pendingProjectText: String? = null

    // Bridge de YouTube (también usado por el proxy interno /yt/<id>)
    private lateinit var ytBridge: YoutubeBridge

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ref = java.lang.ref.WeakReference(this)

        // Evita el destello blanco: fondo de ventana oscuro antes de pintar el WebView
        window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.parseColor("#05080a")))

        // Verificar y solicitar permisos
        checkPermissions()
        // Acceso a la raíz /DSKlofi (todos los archivos en Android 11+)
        ensureStorageAccess()

        // Crear WebView programáticamente
        webView = WebView(this)
        webView.setBackgroundColor(Color.parseColor("#05080a"))
        setContentView(webView)

        // ---- NO edge-to-edge: aplicar barras de sistema como padding ----
        // El padding se aplica al CONTENEDOR raíz (android.R.id.content), no al
        // WebView: así los insets llegan aunque el tema los consumiría antes.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val root = findViewById<android.view.View>(android.R.id.content)
        root.setBackgroundColor(Color.parseColor("#05080a"))
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val b = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            v.setPadding(b.left, b.top, b.right, b.bottom)
            insets
        }
        ViewCompat.requestApplyInsets(root)
        // Iconos claros en la barra de estado (fondo oscuro)
        WindowCompat.getInsetsController(window, webView).isAppearanceLightStatusBars = false

        // Fondo oscuro para la barra de navegación inferior
        window.navigationBarColor = Color.parseColor("#05080a") // Puedes poner Color.BLACK si prefieres negro puro

        // Botones de navegación (triángulo, círculo, cuadrado) en color claro
        WindowCompat.getInsetsController(window, webView).isAppearanceLightNavigationBars = false

        // Configurar WebView
        setupWebView()
        if (0 != (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        // Cargar la página desde assets
        webView.loadUrl("file:///android_asset/index.html")
        readIncomingProject(intent) // por si se abrió tocando un .dsk
        hasIncomingAudio = readIncomingAudio(intent)   // por si se abrió/compartió audio
        readIncomingYouTube(intent)   // por si se compartió un enlace de YouTube
    }

    override fun onNewIntent(newIntent: android.content.Intent?) {
        super.onNewIntent(newIntent)
        setIntent(newIntent)
        if (readIncomingProject(newIntent) && ::webView.isInitialized) {
            webView.post {
                webView.evaluateJavascript("window.DSKOpenProject && window.DSKOpenProject();", null)
            }
        }
        // audio compartido/abierto con la app ya en marcha
        if (readIncomingAudio(newIntent)) deliverIncomingAudio()
        // enlace/texto de YouTube compartido
        if (readIncomingYouTube(newIntent)) deliverIncomingYouTube()
    }

    // URL de YouTube recibida por intent (SEND text/plain), pendiente de entregar.
    private var pendingYouTubeUrl: String? = null

    // Detecta si el texto compartido contiene un enlace de YouTube y lo guarda.
    private fun readIncomingYouTube(i: android.content.Intent?): Boolean {
        if (i == null) return false
        if (i.action != android.content.Intent.ACTION_SEND) return false
        val type = i.type ?: ""
        if (!type.startsWith("text")) return false
        val text = i.getStringExtra(android.content.Intent.EXTRA_TEXT)?.trim() ?: return false
        // ¿contiene un enlace de YouTube? (la validación fina la hace el JS)
        val yt = Regex("(?:youtu\\.be|youtube\\.com|youtube-nocookie\\.com|music\\.youtube\\.[a-z.]+)", RegexOption.IGNORE_CASE)
        if (!yt.containsMatchIn(text)) return false
        // extraer la primera URL del texto (a veces comparten "Mira esto: https://…")
        val urlMatch = Regex("https?://\\S+").find(text)
        pendingYouTubeUrl = urlMatch?.value ?: text
        return true
    }

    // Entrega el enlace de YouTube al WebView: abre la pestaña Online y lo busca.
    private fun deliverIncomingYouTube() {
        val url = pendingYouTubeUrl ?: return
        if (!::webView.isInitialized) return
        pendingYouTubeUrl = null
        webView.post {
            webView.evaluateJavascript(
                "window.DSKOpenYouTubeUrl && window.DSKOpenYouTubeUrl(" +
                        org.json.JSONObject.quote(url) + ");", null
            )
        }
    }

    // URIs de audio recibidos por intent (VIEW / SEND / SEND_MULTIPLE), pendientes
    // de entregar al WebView cuando la página esté lista.
    private var pendingAudioUris: List<Uri> = emptyList()

    private fun readIncomingAudio(i: android.content.Intent?): Boolean {
        if (i == null) return false
        val uris = ArrayList<Uri>()
        when (i.action) {
            android.content.Intent.ACTION_VIEW -> i.data?.let { uris.add(it) }
            android.content.Intent.ACTION_SEND -> {
                val u = i.getParcelableExtra<Uri>(android.content.Intent.EXTRA_STREAM)
                if (u != null) uris.add(u)
            }
            android.content.Intent.ACTION_SEND_MULTIPLE -> {
                i.getParcelableArrayListExtra<Uri>(android.content.Intent.EXTRA_STREAM)?.let { uris.addAll(it) }
            }
        }
        // filtrar solo audio (por tipo o extensión) y descartar .dsk
        val audioExt = Regex("\\.(mp3|wav|ogg|opus|flac|m4a|aac|webm)$", RegexOption.IGNORE_CASE)
        val filtered = uris.filter { u ->
            val t = contentResolver.getType(u) ?: ""
            val name = queryDisplayName(u)
            (t.startsWith("audio") || audioExt.containsMatchIn(name)) && !name.endsWith(".dsk", true)
        }
        if (filtered.isEmpty()) return false
        pendingAudioUris = filtered
        return true
    }

    // Entrega el audio entrante al WebView. Si es UNO solo, carga su carpeta entera
    // (como abrir desde el propio selector). Si son VARIOS, los carga como playlist.
    private fun deliverIncomingAudio() {
        if (pendingAudioUris.isEmpty() || !::webView.isInitialized) return
        val uris = pendingAudioUris
        pendingAudioUris = emptyList()
        webView.post {
            if (uris.size == 1) {
                handlePickedAudio(uris[0])   // carga la canción + toda su carpeta
            } else {
                // varios compartidos: construir playlist con esos archivos
                val names = ArrayList<String>()
                uris.forEach { names.add(queryDisplayName(it).ifEmpty { "audio" }) }
                folderUris = uris
                persistFolderUris()
                val arr = org.json.JSONArray(); names.forEach { arr.put(it) }
                webView.evaluateJavascript(
                    "window.DSKLoadFolder && window.DSKLoadFolder(" +
                            org.json.JSONObject.quote(arr.toString()) + ", 0);", null
                )
            }
        }
    }

    // Lee el contenido del .dsk recibido por intent (VIEW/SEND) y lo deja pendiente
    private fun readIncomingProject(i: android.content.Intent?): Boolean {
        if (i == null) return false
        val uri: Uri? = when (i.action) {
            android.content.Intent.ACTION_SEND -> i.getParcelableExtra(android.content.Intent.EXTRA_STREAM)
            else -> i.data
        }
        if (uri == null) return false
        return try {
            val text = contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
            if (!text.isNullOrEmpty()) { pendingProjectText = text; true } else false
        } catch (e: Exception) { false }
    }

    private fun ensureStorageAccess() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // Android 11+: "Acceso a todos los archivos" para escribir en la raíz /DSKlofi
                if (!Environment.isExternalStorageManager()) {
                    try {
                        val i = Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
                        i.data = Uri.parse("package:$packageName")
                        startActivity(i)
                    } catch (e: Exception) {
                        try { startActivity(Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)) } catch (e2: Exception) {}
                    }
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(arrayOf(android.Manifest.permission.WRITE_EXTERNAL_STORAGE), 9123)
                }
            }
        } catch (e: Exception) {}
    }

    private fun checkPermissions() {
        val permissions = mutableListOf<String>()

        // WRITE solo en Android 9 y anteriores
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            }
        }

        // READ_EXTERNAL_STORAGE para acceso global a la biblioteca de audio
        // (necesario en Android 9–12L; en 13+ lo sustituye READ_MEDIA_AUDIO)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.READ_EXTERNAL_STORAGE)
            }
        }

        // Permiso de audio para Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.READ_MEDIA_AUDIO)
            }
        }

        // Permiso de notificaciones (Android 13+) para la notificación persistente
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        // Permiso de micrófono
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.RECORD_AUDIO)
        }

        if (permissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, permissions.toTypedArray(), PERMISSION_REQUEST_CODE)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)

        if (requestCode == PERMISSION_REQUEST_CODE) {
            val recordAudioGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

            val storageGranted = when {
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> {
                    ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_AUDIO) == PackageManager.PERMISSION_GRANTED
                }
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> true
                else -> {
                    ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED &&
                            ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
                }
            }

            if (!recordAudioGranted || !storageGranted) {
                Toast.makeText(this, "Permisos necesarios para cargar y guardar archivos", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun setupWebView() {
        // Desactiva las barras nativas de Android que se superponen a tu diseño
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false

        val webSettings: WebSettings = webView.settings

        webSettings.javaScriptEnabled = true

        webSettings.allowFileAccess = true
        webSettings.allowFileAccessFromFileURLs = true
        webSettings.allowUniversalAccessFromFileURLs = true

        webSettings.mediaPlaybackRequiresUserGesture = false
        webSettings.domStorageEnabled = true
        webSettings.databaseEnabled = true

        webSettings.cacheMode = WebSettings.LOAD_DEFAULT

        webSettings.javaScriptCanOpenWindowsAutomatically = true
        webSettings.setSupportMultipleWindows(true)
        webSettings.loadWithOverviewMode = true
        webSettings.useWideViewPort = true
        webSettings.setSupportZoom(false)
        webSettings.builtInZoomControls = false
        webSettings.displayZoomControls = false

        webSettings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

        // UA propio: suprime AdSense/Analytics y permite detectar el WebView en JS
        webSettings.userAgentString = webSettings.userAgentString + " DSKMusicApp/1.0"

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                return false
            }

            // Sirve el audio de la playlist como stream: el JS pide
            // https://dsklofi.local/track/<n> y aquí devolvemos el InputStream del
            // URI correspondiente. Evita pasar base64 gigante por el puente JS
            // (que falla con archivos grandes).
            override fun shouldInterceptRequest(
                view: WebView?, request: WebResourceRequest?
            ): WebResourceResponse? {
                val url = request?.url?.toString() ?: return null
                val marker = "dsklofi.local/track/"
                val idx = url.indexOf(marker)
                if (idx >= 0) {
                    return try {
                        val numStr = url.substring(idx + marker.length).substringBefore("?").substringBefore("/")
                        val n = numStr.toIntOrNull() ?: return errorResponse()
                        if (n < 0 || n >= folderUris.size) return errorResponse()
                        val uri = folderUris[n]
                        val stream = contentResolver.openInputStream(uri) ?: return errorResponse()
                        val mime = contentResolver.getType(uri) ?: "audio/*"
                        val headers = HashMap<String, String>()
                        headers["Access-Control-Allow-Origin"] = "*"
                        headers["Cache-Control"] = "no-store"
                        WebResourceResponse(mime, null, 200, "OK", headers, stream)
                    } catch (e: Exception) { errorResponse() }
                }
                // Reproducción por URI estable (listas/explorador): /uri/<uri-encoded>
                // Respaldo: ?p=<ruta-encoded> → si el permiso SAF ya no existe
                // (datos borrados / lista importada), se abre el fichero por ruta
                // (requiere "Acceso a todos los archivos").
                val um = "dsklofi.local/uri/"
                val uidx = url.indexOf(um)
                if (uidx >= 0) {
                    val pathParam = try { request?.url?.getQueryParameter("p") } catch (e: Exception) { null }
                    var safUri: Uri? = null
                    // 1) intentar por URI SAF (si aún hay permiso del árbol)
                    try {
                        val enc = url.substring(uidx + um.length).substringBefore("?").substringBefore("#")
                        val uriStr = java.net.URLDecoder.decode(enc, "UTF-8")
                        safUri = Uri.parse(uriStr)
                        val stream = contentResolver.openInputStream(safUri)
                        if (stream != null) {
                            val mime = contentResolver.getType(safUri) ?: "audio/*"
                            val headers = HashMap<String, String>()
                            headers["Access-Control-Allow-Origin"] = "*"
                            headers["Cache-Control"] = "no-store"
                            return WebResourceResponse(mime, null, 200, "OK", headers, stream)
                        }
                    } catch (e: Exception) {}
                    // 2) respaldo por RUTA real (no depende del permiso SAF):
                    //    primero la ruta guardada (?p=), si no, se DERIVA del docId
                    //    embebido en la propia URI → así funcionan también las listas
                    //    antiguas. Requiere "Acceso a todos los archivos".
                    var path = pathParam
                    if (path.isNullOrBlank() && safUri != null) {
                        path = try { docIdToPath(DocumentsContract.getDocumentId(safUri)) } catch (e: Exception) { "" }
                    }
                    if (!path.isNullOrBlank()) {
                        try {
                            val f = java.io.File(path)
                            if (f.exists()) {
                                val headers = HashMap<String, String>()
                                headers["Access-Control-Allow-Origin"] = "*"
                                headers["Cache-Control"] = "no-store"
                                return WebResourceResponse(mimeForName(f.name), null, 200, "OK", headers, java.io.FileInputStream(f))
                            }
                        } catch (e: Exception) {}
                    }
                    return errorResponse()
                }
                // Túnel de audio de YouTube para descargar/convertir en el WebView.
                // La URL ya viene resuelta desde JS: /ytproxy?u=<url-encoded>
                // (la extracción pesada se hace antes en JS, no aquí, para no colgar).
                val pm = "dsklofi.local/ytproxy"
                if (url.indexOf(pm) >= 0) {
                    return try {
                        val streamUrl = request?.url?.getQueryParameter("u")
                        if (streamUrl.isNullOrBlank() ||
                            !(streamUrl.contains("googlevideo.com") || streamUrl.contains("youtube"))) {
                            return errorResponse()
                        }
                        val resp = ytBridge.openUrlStream(streamUrl) ?: return errorResponse()
                        val body = resp.body ?: run { resp.close(); return errorResponse() }
                        val mime = body.contentType()?.toString()?.substringBefore(";")?.trim()
                            ?: "audio/webm"
                        val headers = HashMap<String, String>()
                        headers["Access-Control-Allow-Origin"] = "*"
                        headers["Access-Control-Expose-Headers"] = "Content-Length"
                        headers["Cache-Control"] = "no-store"
                        val cl = try { body.contentLength() } catch (e: Exception) { -1L }
                        if (cl > 0) headers["Content-Length"] = cl.toString()
                        WebResourceResponse(mime, null, 200, "OK", headers, body.byteStream())
                    } catch (e: Exception) { errorResponse() }
                }
                // Sirve el temporal ya descargado (rápido, local) para convertir en JS
                val lm = "dsklofi.local/ytlocal"
                if (url.indexOf(lm) >= 0) {
                    return try {
                        val token = request?.url?.getQueryParameter("id")
                        val f = if (token != null) ytBridge.tempFile(token) else null
                        if (f == null || !f.exists()) errorResponse()
                        else {
                            val headers = HashMap<String, String>()
                            headers["Access-Control-Allow-Origin"] = "*"
                            headers["Cache-Control"] = "no-store"
                            WebResourceResponse("application/octet-stream", null, 200, "OK", headers, java.io.FileInputStream(f))
                        }
                    } catch (e: Exception) { errorResponse() }
                }
                return super.shouldInterceptRequest(view, request)
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                injectFileInputFix()
                // entregar audio entrante (abrir/compartir) una vez la web está lista
                view?.postDelayed({ deliverIncomingAudio() }, 350)
                // entregar enlace de YouTube compartido (pronto, para retener el splash)
                view?.postDelayed({ deliverIncomingYouTube() }, 60)
                // si no hubo audio entrante, restaurar la última cola
                view?.postDelayed({ tryRestoreQueue() }, 500)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                uploadMessage?.onReceiveValue(null)
                uploadMessage = filePathCallback

                val intent = Intent(Intent.ACTION_GET_CONTENT)
                intent.addCategory(Intent.CATEGORY_OPENABLE)
                intent.type = "*/*"
                // Respetar el accept del <input> SOLO si es un tipo comodín fiable
                // (audio/*, image/*…). Tipos concretos como "application/json" o
                // extensiones (".json") no siempre coinciden con el MIME real que
                // reporta el proveedor de archivos y dejarían la lista vacía.
                val accept = fileChooserParams?.acceptTypes
                    ?.flatMap { it.split(",") }
                    ?.map { it.trim() }
                    ?.filter { Regex("^[a-z]+/\\*$").matches(it) }
                if (!accept.isNullOrEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES, accept.toTypedArray())

                try {
                    startActivityForResult(Intent.createChooser(intent, "Seleccionar archivo"), REQUEST_SELECT_FILE)
                } catch (e: Exception) {
                    uploadMessage = null
                    Toast.makeText(this@MainActivity, "No se puede abrir el selector de archivos", Toast.LENGTH_LONG).show()
                    return false
                }

                return true
            }

            override fun onPermissionRequest(request: PermissionRequest?) {
                request?.grant(request.resources)
            }
        }

        // NewPipe (YouTube en el dispositivo) — init una sola vez
        try { org.schabi.newpipe.extractor.NewPipe.init(YtDownloader.getInstance()) } catch (e: Exception) {}

        webView.addJavascriptInterface(AndroidFileManager(), "AndroidFileManager")
        webView.addJavascriptInterface(AndroidDownloader(), "AndroidDownloader")
        webView.addJavascriptInterface(AndroidMedia(), "AndroidMedia")
        webView.addJavascriptInterface(DskBridge(), "DSKBridge")
        webView.addJavascriptInterface(LyricsBridge(), "DSKLyrics")
        ytBridge = YoutubeBridge(this)
        webView.addJavascriptInterface(ytBridge, "DSKYoutube")
        webView.addJavascriptInterface(DownloadsBridge(), "DSKDownloads")
        webView.addJavascriptInterface(UpdateChecker(this), "DSKUpdate")
    }

    private fun injectFileInputFix() {
        val script = """
            (function() {
                const originalCreateElement = document.createElement;
                document.createElement = function(tagName) {
                    const element = originalCreateElement.call(this, tagName);
                    if (tagName.toLowerCase() === 'input' && element.type === 'file') {
                        element.addEventListener('click', function(e) {
                            console.log('File input clicked in WebView');
                        });
                    }
                    return element;
                };
                if (window.AndroidFileManager) {
                    console.log('AndroidFileManager available');
                }
            })();
        """.trimIndent()

        webView.evaluateJavascript(script, null)
    }

    // Puente para la notificación persistente: la web empuja su estado aquí
    // (cada segundo cuando hay temporizador) y el servicio dibuja la notificación.
    inner class AndroidMedia {
        @JavascriptInterface
        fun update(json: String) {
            try {
                val o = org.json.JSONObject(json)
                // cover: presente = base64/"" ; ausente = sin cambio (null)
                val cover = if (o.has("cover")) o.optString("cover", "") else null
                PlaybackService.pushState(
                    this@MainActivity,
                    o.optBoolean("playing", false),
                    o.optString("title", "DSK•LoFi"),
                    o.optString("artist", "lofi tape machine"),
                    cover,
                    o.optInt("duration", 0),
                    o.optInt("position", 0)
                )
            } catch (e: Exception) {}
        }

        // Cierra la notificación (cuando se hace stop o se descarga la pista)
        @JavascriptInterface
        fun stopNotification() {
            try { stopService(Intent(this@MainActivity, PlaybackService::class.java)) } catch (e: Exception) {}
        }
    }

    // Clase interna para manejar archivos
    inner class AndroidFileManager {

        // Entrega (y limpia) el .dsk abierto desde el explorador
        @JavascriptInterface
        fun consumePendingProject(): String {
            val t = pendingProjectText ?: ""
            pendingProjectText = null
            return t
        }
        @JavascriptInterface
        fun loadAudioFile(trackId: String) {
            runOnUiThread {
                val intent = Intent(Intent.ACTION_GET_CONTENT)
                intent.type = "audio/*"
                intent.addCategory(Intent.CATEGORY_OPENABLE)

                try {
                    pendingCallbacks[REQUEST_SELECT_FILE.toString()] = trackId
                    startActivityForResult(Intent.createChooser(intent, "Seleccionar archivo de audio para $trackId"), REQUEST_SELECT_FILE)
                } catch (e: Exception) {
                    showMessage("Error al abrir selector de archivos: ${e.message}")
                    webView.evaluateJavascript("if(window.handleAudioFileLoadError) window.handleAudioFileLoadError('$trackId', '${e.message}');", null)
                }
            }
        }

        @JavascriptInterface
        fun showMessage(message: String) {
            runOnUiThread {
                Toast.makeText(this@MainActivity, message, Toast.LENGTH_SHORT).show()
            }
        }

        // Abre un enlace en el navegador del sistema (fuera del WebView)
        @JavascriptInterface
        fun openExternal(url: String) {
            runOnUiThread {
                try {
                    val i = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    startActivity(i)
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "No se pudo abrir el enlace", Toast.LENGTH_SHORT).show()
                }
            }
        }

        // Mantiene la pantalla encendida mientras se graba o reproduce
        @JavascriptInterface
        fun keepScreenOn(on: Boolean) {
            runOnUiThread {
                if (on) window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }

        @JavascriptInterface
        fun getAssetFile(filename: String): String? {
            return try {
                val input = assets.open(filename)
                val out = java.io.ByteArrayOutputStream()
                val buf = ByteArray(8192); var n: Int
                while (input.read(buf).also { n = it } != -1) out.write(buf, 0, n)
                input.close()
                Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            } catch (e: Exception) {
                null
            }
        }

        @JavascriptInterface
        fun logDebug(message: String) {
            android.util.Log.d("DSKDrumBox", "JS: $message")
        }
    }

    // Clase interna para manejar descargas desde JavaScript
    inner class AndroidDownloader {

        // --- NUEVA FUNCIÓN PARA AETHER ---
        @JavascriptInterface
        fun saveWavFile(base64Data: String) {
            try {
                // 1. Extraemos los bytes puros eliminando la cabecera data:audio/wav;base64,
                val cleanBase64 = base64Data.substringAfter(",")
                val bytes = Base64.decode(cleanBase64, Base64.DEFAULT)

                // 2. Formato de nombre exacto: aether_dsk_YYYYMMDD_HHMMSS.wav
                val timeStamp = java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.getDefault()).format(java.util.Date())
                val fileName = "lullaby_bydsk_$timeStamp.wav"

                // 3. Guardado condicional según la versión del sistema operativo
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    // SISTEMAS MODERNOS (Android 10+): Usamos MediaStore de forma segura
                    val resolver = contentResolver
                    val contentValues = android.content.ContentValues().apply {
                        put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                        put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "audio/wav")
                        // Lo mandamos directamente a la carpeta pública de Descargas
                        put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    }

                    val uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
                    uri?.let {
                        resolver.openOutputStream(it)?.use { outputStream ->
                            outputStream.write(bytes)
                            outputStream.flush()
                        }
                        runOnUiThread {
                            Toast.makeText(this@MainActivity, "Audio guardado en Descargas:\n$fileName", Toast.LENGTH_LONG).show()
                        }
                    }
                } else {
                    // SISTEMAS ANTIGUOS (Android 9 y anterior): Escribimos directamente en el disco
                    val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    if (!downloadsDir.exists()) {
                        downloadsDir.mkdirs()
                    }

                    val file = File(downloadsDir, fileName)
                    FileOutputStream(file).use { outputStream ->
                        outputStream.write(bytes)
                        outputStream.flush()
                    }
                    runOnUiThread {
                        Toast.makeText(this@MainActivity, "Audio guardado en Descargas:\n$fileName", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Error al guardar el archivo", Toast.LENGTH_SHORT).show()
                }
            }
        }
        // ----------------------------------

        // --- AETHER: guardar grabación MP3 en Descargas ---
        @JavascriptInterface
        fun saveMp3File(base64Data: String) {
            try {
                val cleanBase64 = base64Data.substringAfter(",")
                val bytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                val timeStamp = java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.getDefault()).format(java.util.Date())
                val fileName = "lullaby_bydsk_$timeStamp.mp3"
                saveToDownloads(bytes, fileName, "audio/mpeg")
            } catch (e: Exception) {
                e.printStackTrace()
                runOnUiThread { Toast.makeText(this@MainActivity, "Error al guardar el archivo", Toast.LENGTH_SHORT).show() }
            }
        }

        // --- AETHER: exportar preset JSON a Descargas ---
        @JavascriptInterface
        fun saveJsonFile(base64Data: String, filename: String) {
            try {
                val cleanBase64 = base64Data.substringAfter(",")
                val bytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                val safe = if (filename.endsWith(".json")) filename else "$filename.json"
                saveToDownloads(bytes, safe, "application/json")
            } catch (e: Exception) {
                e.printStackTrace()
                runOnUiThread { Toast.makeText(this@MainActivity, "Error al guardar el preset", Toast.LENGTH_SHORT).show() }
            }
        }

        // Guardado genérico en la carpeta pública Descargas (MediaStore en 10+, disco directo en 9-)
        private fun saveToDownloads(bytes: ByteArray, fileName: String, mime: String) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = contentResolver
                val contentValues = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                    put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime)
                    put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }
                val uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
                uri?.let {
                    resolver.openOutputStream(it)?.use { out -> out.write(bytes); out.flush() }
                    runOnUiThread { Toast.makeText(this@MainActivity, "Guardado en Descargas:\n$fileName", Toast.LENGTH_LONG).show() }
                }
            } else {
                val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                if (!downloadsDir.exists()) downloadsDir.mkdirs()
                val file = File(downloadsDir, fileName)
                FileOutputStream(file).use { out -> out.write(bytes); out.flush() }
                runOnUiThread { Toast.makeText(this@MainActivity, "Guardado en Descargas:\n$fileName", Toast.LENGTH_LONG).show() }
            }
        }

        @JavascriptInterface
        fun downloadAudio(base64Data: String, filename: String) {
            try {
                val audioData = Base64.decode(base64Data, Base64.DEFAULT)
                saveFile(audioData, filename, "Archivo")
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Error al guardar: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }

        @JavascriptInterface
        fun downloadImage(base64Data: String, filename: String) {
            try {
                val imageData = Base64.decode(base64Data, Base64.DEFAULT)
                saveFile(imageData, filename, "Imagen")
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Error al guardar imagen: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }

        // guarda un sample confirmado en /DSKvokal/samples
        @JavascriptInterface
        fun saveSample(base64Data: String, filename: String): String {
            return try {
                val data = Base64.decode(base64Data, Base64.DEFAULT)
                saveFile(data, filename, "Sample", "samples")
                "ok"
            } catch (e: Exception) { "err:${e.message}" }
        }

        @JavascriptInterface
        fun listSamples(): String {
            return try {
                val dir = File(File(Environment.getExternalStorageDirectory(), "DSKvokal"), "samples")
                if (!dir.exists()) return "[]"
                val names = dir.listFiles()?.filter { it.isFile }?.map { it.name } ?: emptyList()
                org.json.JSONArray(names).toString()
            } catch (e: Exception) { "[]" }
        }

        @JavascriptInterface
        fun readSample(filename: String): String {
            return try {
                val f = File(File(File(Environment.getExternalStorageDirectory(), "DSKvokal"), "samples"), filename)
                if (!f.exists()) "" else Base64.encodeToString(f.readBytes(), Base64.NO_WRAP)
            } catch (e: Exception) { "" }
        }

        // ¿existe ya este archivo en /DSKvokal? (para avisar de sobrescritura)
        @JavascriptInterface
        fun fileExists(filename: String): Boolean {
            return try { File(File(Environment.getExternalStorageDirectory(), "DSKvokal"), filename).exists() } catch (e: Exception) { false }
        }

        // Autoguardado del proyecto (sobrevive a los reinicios aunque falle el localStorage)
        @JavascriptInterface
        fun saveProject(json: String) {
            try {
                val base = File(Environment.getExternalStorageDirectory(), "DSKvokal")
                if (!base.exists()) base.mkdirs()
                File(base, "project.json").writeText(json)
            } catch (e: Exception) {}
        }

        @JavascriptInterface
        fun readProject(): String {
            return try {
                val f = File(File(Environment.getExternalStorageDirectory(), "DSKvokal"), "project.json")
                if (f.exists()) f.readText() else ""
            } catch (e: Exception) { "" }
        }

        @JavascriptInterface
        fun showMessage(message: String) {
            runOnUiThread {
                Toast.makeText(this@MainActivity, message, Toast.LENGTH_SHORT).show()
            }
        }

        private fun saveFile(data: ByteArray, filename: String, fileType: String, subdir: String = "") {
            try {
                val base = File(Environment.getExternalStorageDirectory(), "DSKvokal")
                val dir = if (subdir.isEmpty()) base else File(base, subdir)
                if (!dir.exists()) dir.mkdirs()
                val file = File(dir, filename)
                FileOutputStream(file).use { it.write(data) }
                try {
                    val scan = Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE)
                    scan.data = Uri.fromFile(file); sendBroadcast(scan)
                } catch (e: Exception) {}
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "$fileType: $filename", Toast.LENGTH_LONG).show()
                }
            } catch (e: Exception) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Error al guardar $fileType: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }

        private fun mimeFor(name: String): String = when {
            name.endsWith(".mp3") -> "audio/mpeg"
            name.endsWith(".wav") -> "audio/wav"
            name.endsWith(".json") -> "application/json"
            name.endsWith(".mid") -> "audio/midi"
            else -> "application/octet-stream"
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        if (requestCode == REQUEST_PICK_AUDIO) {
            if (resultCode == RESULT_OK && data?.data != null) {
                handlePickedAudio(data.data!!)
            }
            return
        }

        if (requestCode == REQUEST_PICK_TREE) {
            if (resultCode == RESULT_OK && data?.data != null) {
                handlePickedTree(data.data!!)
            }
            return
        }

        if (requestCode == REQUEST_ADD_ROOT) {
            if (resultCode == RESULT_OK && data?.data != null) {
                addRoot(data.data!!)
                runOnUiThread { webView.evaluateJavascript("window.DSKRootsChanged && window.DSKRootsChanged();", null) }
            }
            return
        }

        if (requestCode == REQUEST_RELINK_ROOT) {
            val old = relinkPendingUri; relinkPendingUri = null
            if (resultCode == RESULT_OK && data?.data != null) {
                addRoot(data.data!!)
                if (old != null) savePendingRoots(loadPendingRoots().filter { it != old })
                runOnUiThread { webView.evaluateJavascript("window.DSKRootsChanged && window.DSKRootsChanged();", null) }
            }
            return
        }

        if (requestCode == REQUEST_SELECT_FILE) {
            val result = if (resultCode == RESULT_OK && data != null) {
                data.data?.let { arrayOf(it) }
            } else null

            uploadMessage?.onReceiveValue(result)
            uploadMessage = null

            if (resultCode == RESULT_OK && data != null) {
                val uri = data.data
                val trackId = pendingCallbacks[requestCode.toString()]

                if (uri != null && trackId != null) {
                    try {
                        android.util.Log.d("DSKDrumBox", "Procesando archivo para track: $trackId")

                        val inputStream: InputStream? = contentResolver.openInputStream(uri)
                        val buffer = inputStream?.readBytes()
                        inputStream?.close()

                        if (buffer != null) {
                            val base64Data = Base64.encodeToString(buffer, Base64.NO_WRAP)
                            android.util.Log.d("DSKDrumBox", "Archivo convertido a base64, tamaño: ${base64Data.length}")

                            val jsCall = "if(window.handleAudioFileLoadSuccess) window.handleAudioFileLoadSuccess('$trackId', '$base64Data');"
                            webView.evaluateJavascript(jsCall, null)

                            runOnUiThread {
                                Toast.makeText(this, "Sample cargado para $trackId", Toast.LENGTH_SHORT).show()
                            }
                        } else {
                            android.util.Log.e("DSKDrumBox", "Error: buffer es null")
                            webView.evaluateJavascript("if(window.handleAudioFileLoadError) window.handleAudioFileLoadError('$trackId', 'Error al leer archivo');", null)
                        }
                    } catch (e: Exception) {
                        android.util.Log.e("DSKDrumBox", "Error procesando archivo: ${e.message}")
                        webView.evaluateJavascript("if(window.handleAudioFileLoadError) window.handleAudioFileLoadError('$trackId', 'Error: ${e.message}');", null)
                    }
                } else {
                    android.util.Log.w("DSKDrumBox", "URI o trackId es null. URI: $uri, trackId: $trackId")
                    if (trackId != null) {
                        webView.evaluateJavascript("if(window.handleAudioFileLoadError) window.handleAudioFileLoadError('$trackId', 'No se seleccionó archivo');", null)
                    }
                }

                pendingCallbacks.remove(requestCode.toString())
            } else {
                android.util.Log.w("DSKDrumBox", "Resultado cancelado o sin datos")
                pendingCallbacks[requestCode.toString()]?.let { trackId ->
                    webView.evaluateJavascript("if(window.handleAudioFileLoadError) window.handleAudioFileLoadError('$trackId', 'Selección cancelada');", null)
                }
                pendingCallbacks.remove(requestCode.toString())
            }
        }
    }

    // Puente de descargas: encola en el servicio nativo (descarga + guardado/
    // transcodificación). El servicio sobrevive a segundo plano y al cierre.
    inner class DownloadsBridge {
        @JavascriptInterface
        fun enqueue(videoId: String, title: String, thumb: String) {
            DownloadService.enqueue(this@MainActivity, videoId, title, thumb)
        }
    }

    // Puente que bridge.js espera: window.DSKBridge.saveFile(name, base64, mime)
    // Guarda en Music/DSKlofi (fuera de Descargas).
    inner class DskBridge {

        @JavascriptInterface
        fun saveFile(name: String, base64: String, mime: String) {
            try {
                val safeName = DskStorage.sanitize(name)
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                val saved = DskStorage.saveBytes(this@MainActivity, safeName, mime, bytes)
                runOnUiThread {
                    if (saved != null) Toast.makeText(this@MainActivity, "Guardado en DSKlofi: $saved", Toast.LENGTH_LONG).show()
                    else Toast.makeText(this@MainActivity, "Error al guardar", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                runOnUiThread { Toast.makeText(this@MainActivity, "Error al guardar: ${e.message}", Toast.LENGTH_SHORT).show() }
            }
        }

        @JavascriptInterface
        fun appVersion(): String = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: "1.0"
        } catch (e: Exception) { "1.0" }

        // ¿Sigue existiendo el archivo (uri SAF)? Para limpiar la cola de borrados.
        @JavascriptInterface
        fun uriExists(uri: String): Boolean {
            return try {
                val df = androidx.documentfile.provider.DocumentFile.fromSingleUri(this@MainActivity, Uri.parse(uri))
                df != null && df.exists()
            } catch (e: Exception) { true }   // ante la duda, NO borrar
        }

        // ¿Tenemos "Acceso a todos los archivos" (lectura por ruta sin SAF)?
        @JavascriptInterface
        fun hasAllFiles(): Boolean = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Environment.isExternalStorageManager()
            else checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED
        } catch (e: Exception) { false }

        // Abre los ajustes para concederlo (lo llama el JS si una pista no se lee).
        @JavascriptInterface
        fun requestAllFiles() { runOnUiThread { ensureStorageAccess() } }

        // Copia texto al portapapeles del sistema (título/intérprete de la pista).
        @JavascriptInterface
        fun copyToClipboard(text: String) {
            runOnUiThread {
                try {
                    val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    cm.setPrimaryClip(ClipData.newPlainText("DSK•LoFi", text))
                } catch (e: Exception) {}
            }
        }

        // Comparte la letra como texto (diálogo nativo: WhatsApp, Facebook, etc.).
        @JavascriptInterface
        fun shareText(text: String) {
            runOnUiThread {
                try {
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, text)
                    }
                    val chooser = Intent.createChooser(send, "DSK•LoFi")
                    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    startActivity(chooser)
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "No se pudo compartir", Toast.LENGTH_SHORT).show()
                }
            }
        }

        // Comparte una imagen (base64 JPEG/PNG) vía el diálogo nativo del sistema.
        @JavascriptInterface
        fun shareImage(base64Data: String, filename: String) {
            runOnUiThread {
                try {
                    val clean = if (base64Data.contains(",")) base64Data.substringAfter(",") else base64Data
                    val bytes = Base64.decode(clean, Base64.DEFAULT)
                    val mime = if (filename.endsWith(".png", ignoreCase = true)) "image/png" else "image/jpeg"
                    // carpeta interna compartible vía FileProvider (no requiere permisos)
                    val shareDir = File(getExternalFilesDir(null), "share").also { it.mkdirs() }
                    val file = File(shareDir, filename)
                    file.writeBytes(bytes)
                    val uri = androidx.core.content.FileProvider.getUriForFile(
                        this@MainActivity, "${packageName}.fileprovider", file
                    )
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = mime
                        putExtra(Intent.EXTRA_STREAM, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    val chooser = Intent.createChooser(send, "DSK•LoFi")
                    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    startActivity(chooser)
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "No se pudo compartir la imagen: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }

        // Guarda una imagen (base64 JPEG/PNG) en /DSKlofi. Devuelve true si OK.
        @JavascriptInterface
        fun saveImage(base64Data: String, filename: String): Boolean {
            return try {
                val clean = if (base64Data.contains(",")) base64Data.substringAfter(",") else base64Data
                val bytes = Base64.decode(clean, Base64.DEFAULT)
                val mime = if (filename.endsWith(".png", ignoreCase = true)) "image/png" else "image/jpeg"
                val safeName = DskStorage.sanitize(filename)
                val saved = DskStorage.saveBytes(this@MainActivity, safeName, mime, bytes)
                runOnUiThread {
                    if (saved != null) Toast.makeText(this@MainActivity, "Guardado en DSKlofi: $saved", Toast.LENGTH_LONG).show()
                    else Toast.makeText(this@MainActivity, "Error al guardar la imagen", Toast.LENGTH_SHORT).show()
                }
                saved != null
            } catch (e: Exception) {
                runOnUiThread { Toast.makeText(this@MainActivity, "Error al guardar: ${e.message}", Toast.LENGTH_SHORT).show() }
                false
            }
        }

        // Genera un PDF (título grande arriba, intérprete debajo, letra y pie con
        // el enlace de la app) y lo guarda en Descargas como
        //   DSKlofi - <artista>_<titulo>.pdf
        @JavascriptInterface
        fun saveLyricsPdf(artist: String, title: String, lyrics: String) {
            Thread {
                try {
                    val bytes = buildLyricsPdf(artist, title, lyrics)
                    val base = "DSKlofi - " + (if (artist.isNotBlank()) artist + "_" else "") + title
                    val name = DskStorage.sanitize(base).take(120) + ".pdf"
                    val saved = DskStorage.saveBytes(this@MainActivity, name, "application/pdf", bytes)
                    runOnUiThread {
                        if (saved != null) Toast.makeText(this@MainActivity, "Guardado en DSKlofi: $name", Toast.LENGTH_LONG).show()
                        else Toast.makeText(this@MainActivity, "No se pudo guardar el PDF", Toast.LENGTH_SHORT).show()
                    }
                } catch (e: Exception) {
                    runOnUiThread { Toast.makeText(this@MainActivity, "Error al crear el PDF: ${e.message}", Toast.LENGTH_SHORT).show() }
                }
            }.start()
        }

        private fun sanitizeFileName(s: String): String =
            s.replace(Regex("[\\\\/:*?\"<>|\\r\\n\\t]"), " ")
                .replace(Regex("\\s+"), " ")
                .trim()

        private fun wrapText(text: String, paint: Paint, maxW: Float): List<String> {
            val lines = ArrayList<String>()
            var line = StringBuilder()
            for (w in text.split(" ")) {
                val test = if (line.isEmpty()) w else "$line $w"
                if (paint.measureText(test) <= maxW) { line = StringBuilder(test); continue }
                if (line.isNotEmpty()) { lines.add(line.toString()); line = StringBuilder() }
                if (paint.measureText(w) <= maxW) {
                    line = StringBuilder(w)
                } else {
                    var rest = w
                    while (paint.measureText(rest) > maxW && rest.length > 1) {
                        var cut = rest.length
                        while (cut > 1 && paint.measureText(rest.substring(0, cut)) > maxW) cut--
                        lines.add(rest.substring(0, cut)); rest = rest.substring(cut)
                    }
                    line = StringBuilder(rest)
                }
            }
            if (line.isNotEmpty()) lines.add(line.toString())
            if (lines.isEmpty()) lines.add("")
            return lines
        }

        private fun buildLyricsPdf(artist: String, title: String, lyrics: String): ByteArray {
            val pageW = 595; val pageH = 842            // A4 en puntos
            val margin = 48f
            val maxW = pageW - margin * 2
            val footerY = pageH - 32f

            val titlePaint  = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK; textSize = 22f; typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD) }
            val artistPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(110, 110, 110); textSize = 14f }
            val bodyPaint   = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(20, 20, 20); textSize = 12f }
            val footPaint   = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(150, 150, 150); textSize = 10f }
            val rulePaint   = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(220, 220, 220); strokeWidth = 1f }

            val pdf = PdfDocument()
            var pageNum = 1
            var page = pdf.startPage(PdfDocument.PageInfo.Builder(pageW, pageH, pageNum).create())
            var c: Canvas = page.canvas
            var y = margin

            fun drawFooter(cv: Canvas) {
                cv.drawLine(margin, footerY - 12f, pageW - margin, footerY - 12f, rulePaint)
                cv.drawText("DSK•LoFi", margin, footerY, footPaint)
                val link = "apps.dskmusic.com"
                cv.drawText(link, pageW - margin - footPaint.measureText(link), footerY, footPaint)
            }
            fun newPage() {
                drawFooter(c)
                pdf.finishPage(page)
                pageNum++
                page = pdf.startPage(PdfDocument.PageInfo.Builder(pageW, pageH, pageNum).create())
                c = page.canvas
                y = margin
            }
            fun ensure(lineH: Float) { if (y + lineH > footerY - 20f) newPage() }

            for (ln in wrapText(title, titlePaint, maxW)) { ensure(28f); y += 22f; c.drawText(ln, margin, y, titlePaint); y += 6f }
            if (artist.isNotBlank()) for (ln in wrapText(artist, artistPaint, maxW)) { ensure(20f); y += 16f; c.drawText(ln, margin, y, artistPaint) }
            y += 18f

            val text = if (lyrics.isBlank()) "—" else lyrics
            for (raw in text.split("\n")) {
                val wl = if (raw.isBlank()) listOf("") else wrapText(raw, bodyPaint, maxW)
                for (ln in wl) { ensure(17f); y += 17f; if (ln.isNotEmpty()) c.drawText(ln, margin, y, bodyPaint) }
            }

            drawFooter(c)
            pdf.finishPage(page)
            val out = ByteArrayOutputStream()
            pdf.writeTo(out)
            pdf.close()
            return out.toByteArray()
        }

        private fun savePdfToDownloads(bytes: ByteArray, name: String) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val cv = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name)
                    put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "application/pdf")
                    put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }
                val uri = contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv)
                uri?.let { contentResolver.openOutputStream(it)?.use { out -> out.write(bytes) } }
            } else {
                val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                if (!dir.exists()) dir.mkdirs()
                val file = File(dir, name)
                FileOutputStream(file).use { it.write(bytes) }
                try { val scan = Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE); scan.data = Uri.fromFile(file); sendBroadcast(scan) } catch (e: Exception) {}
            }
        }

        // Abre el selector de UN audio. Al elegirlo, se listan TODOS los audios de
        // su misma carpeta y se mandan al WebView como playlist (comportamiento de
        // reproductor: abres una canción y se carga la carpeta entera).
        @JavascriptInterface
        fun pickAudioFolder() {
            runOnUiThread {
                try {
                    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
                    intent.addCategory(Intent.CATEGORY_OPENABLE)
                    intent.type = "audio/*"
                    intent.putExtra("android.content.extra.SHOW_ADVANCED", true)
                    startActivityForResult(intent, REQUEST_PICK_AUDIO)
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "No se puede abrir el selector", Toast.LENGTH_LONG).show()
                }
            }
        }

        // Selector de CARPETA (SAF tree). 100% fiable: lista todos los audios de la
        // carpeta elegida aunque MediaStore no los tenga indexados.
        @JavascriptInterface
        fun pickFolderTree() {
            runOnUiThread {
                try {
                    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                    intent.putExtra("android.content.extra.SHOW_ADVANCED", true)
                    startActivityForResult(intent, REQUEST_PICK_TREE)
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "No se puede abrir el selector de carpeta", Toast.LENGTH_LONG).show()
                }
            }
        }

        // Devuelve el audio nativo en esa posición de la playlist como base64.
        @JavascriptInterface
        fun readAudioAt(index: Int): String {
            return try {
                if (index < 0 || index >= folderUris.size) return ""
                val uri = folderUris[index]
                contentResolver.openInputStream(uri)?.use { input ->
                    Base64.encodeToString(input.readBytes(), Base64.NO_WRAP)
                } ?: ""
            } catch (e: Exception) { "" }
        }

        // ---- Explorador SAF + listas con URIs estables (Opción A) ----

        // Lanza el selector de carpeta SOLO para añadirla como raíz del explorador
        // (no reemplaza la cola en curso).
        @JavascriptInterface
        fun addExplorerRoot() {
            runOnUiThread {
                try {
                    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                    intent.putExtra("android.content.extra.SHOW_ADVANCED", true)
                    startActivityForResult(intent, REQUEST_ADD_ROOT)
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "No se puede abrir el selector de carpeta", Toast.LENGTH_LONG).show()
                }
            }
        }

        // Carpetas raíz guardadas como JSON [{name,uri,dir:true}].
        @JavascriptInterface
        fun listRoots(): String = rootsJson()

        // Quita una raíz guardada (o pendiente) y libera su permiso persistente.
        @JavascriptInterface
        fun removeRoot(uriString: String) {
            // Solo se quita de la lista de "Archivos". NO se libera el permiso
            // persistente del árbol: así las pistas de cualquier playlist que
            // apunten a archivos dentro de esa carpeta siguen abriéndose aunque
            // la carpeta ya no aparezca en Archivos.
            saveRoots(loadRoots().filter { it.toString() != uriString })
            savePendingRoots(loadPendingRoots().filter { it != uriString })
        }

        // Hijos (carpetas + audios) de una carpeta del árbol como JSON [{name,uri,dir}].
        @JavascriptInterface
        fun browse(folderUriString: String): String = listChildrenJson(Uri.parse(folderUriString))

        // Versión asíncrona de browse(): no bloquea el hilo del WebView (carpetas
        // grandes). Responde por window.DSKBridge.__browseResult(reqId, json).
        @JavascriptInterface
        fun browseAsync(folderUriString: String, reqId: String) {
            val uri = Uri.parse(folderUriString)
            browsePool.execute {
                val json = try { listChildrenJson(uri) } catch (e: Exception) { "[]" }
                val payload = org.json.JSONObject.quote(json)
                runJs("window.DSKBridge&&window.DSKBridge.__browseResult&&window.DSKBridge.__browseResult(${org.json.JSONObject.quote(reqId)},$payload)")
            }
        }

        // Estadísticas de una carpeta: nº de audios + duración total (segundos).
        // El conteo es barato (una query SAF). La duración exige abrir cada audio
        // con MediaMetadataRetriever (parte costosa). Si knownCount >= 0 y coincide
        // con el conteo actual, NO se recalcula la duración (dur = -1) y el lado JS
        // reutiliza la guardada. Todo en segundo plano.
        // Responde por window.DSKBridge.__folderStats(reqId, json{count,dur}).
        @JavascriptInterface
        fun folderStats(folderUriString: String, knownCount: Int, reqId: String) {
            val uri = Uri.parse(folderUriString)
            browsePool.execute {
                var count = 0
                var durMs = 0L
                var skipDur = false
                try {
                    val isTree = !uri.toString().contains("/document/")
                    val parentId = if (isTree) DocumentsContract.getTreeDocumentId(uri)
                                   else DocumentsContract.getDocumentId(uri)
                    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(uri, parentId)
                    val audioUris = ArrayList<Uri>()
                    contentResolver.query(
                        childrenUri,
                        arrayOf(
                            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                            DocumentsContract.Document.COLUMN_MIME_TYPE
                        ), null, null, null
                    )?.use { c ->
                        val di = c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
                        val ni = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
                        val mi = c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
                        while (c.moveToNext()) {
                            val cid = if (di >= 0) c.getString(di) else continue
                            val nm = if (ni >= 0) c.getString(ni) ?: "" else ""
                            val mime = if (mi >= 0) c.getString(mi) ?: "" else ""
                            if (mime == DocumentsContract.Document.MIME_TYPE_DIR) continue
                            if (mime.startsWith("audio") || AUDIO_EXT.containsMatchIn(nm)) {
                                count++
                                audioUris.add(DocumentsContract.buildDocumentUriUsingTree(uri, cid))
                            }
                        }
                    }
                    // conteo sin cambios → no recalcular la duración
                    if (knownCount >= 0 && knownCount == count) {
                        skipDur = true
                    } else {
                        for (au in audioUris) {
                            val mmr = android.media.MediaMetadataRetriever()
                            try {
                                mmr.setDataSource(this@MainActivity, au)
                                val d = mmr.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)
                                durMs += d?.toLongOrNull() ?: 0L
                            } catch (e: Exception) {
                            } finally { try { mmr.release() } catch (e: Exception) {} }
                        }
                    }
                } catch (e: Exception) {}
                val durOut = if (skipDur) -1.0 else durMs / 1000.0
                val json = org.json.JSONObject().put("count", count).put("dur", durOut).toString()
                val payload = org.json.JSONObject.quote(json)
                runJs("window.DSKBridge&&window.DSKBridge.__folderStats&&window.DSKBridge.__folderStats(${org.json.JSONObject.quote(reqId)},$payload)")
            }
        }

        // Suma la duración (segundos) de una lista de URIs de audio. Se usa para
        // la duración total de una LISTA. Solo se llama cuando cambia el nº de
        // elementos (el lado JS cachea por id de lista).
        // Responde por window.DSKBridge.__urisDuration(reqId, durSeg).
        @JavascriptInterface
        fun urisDuration(urisJson: String, reqId: String) {
            browsePool.execute {
                var durMs = 0L
                try {
                    val arr = org.json.JSONArray(urisJson)
                    for (i in 0 until arr.length()) {
                        val u = arr.optString(i, "")
                        if (u.isBlank()) continue
                        val mmr = android.media.MediaMetadataRetriever()
                        try {
                            mmr.setDataSource(this@MainActivity, Uri.parse(u))
                            val d = mmr.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)
                            durMs += d?.toLongOrNull() ?: 0L
                        } catch (e: Exception) {
                        } finally { try { mmr.release() } catch (e: Exception) {} }
                    }
                } catch (e: Exception) {}
                val durSec = durMs / 1000.0
                runJs("window.DSKBridge&&window.DSKBridge.__urisDuration&&window.DSKBridge.__urisDuration(${org.json.JSONObject.quote(reqId)},$durSec)")
            }
        }

        // Lee las etiquetas ID3 de un audio (título/artista/álbum/track + carátula).
        // Responde por window.DSKBridge.__tagsRead(reqId, json).
        @JavascriptInterface
        fun readTags(uriString: String, reqId: String) {
            val uri = Uri.parse(uriString)
            browsePool.execute {
                val obj = org.json.JSONObject()
                var tmp: File? = null
                try {
                    val name = queryDisplayName(uri)
                    val nameExt = name.substringAfterLast('.', "").lowercase()
                    // el contenedor real puede no coincidir con la extensión (p. ej.
                    // descargas M4A renombradas a .mp3): se detecta por el contenido
                    // y se nombra el temporal con la extensión real para que
                    // jaudiotagger use el lector/escritor correcto.
                    val raw = File(cacheDir, "tagrdraw_" + System.nanoTime())
                    contentResolver.openInputStream(uri)?.use { input -> raw.outputStream().use { input.copyTo(it) } }
                    val realExt = sniffAudioExt(raw).ifBlank { if (nameExt.isNotBlank()) nameExt else "mp3" }
                    tmp = File(cacheDir, "tagrd_" + System.nanoTime() + "." + realExt)
                    if (!raw.renameTo(tmp!!)) { raw.copyTo(tmp!!, overwrite = true); try { raw.delete() } catch (e: Exception) {} }
                    val af = org.jaudiotagger.audio.AudioFileIO.read(tmp)
                    val tag = af.tag
                    fun g(k: org.jaudiotagger.tag.FieldKey): String =
                        try { tag?.getFirst(k) ?: "" } catch (e: Exception) { "" }
                    obj.put("name", name)
                    obj.put("title", g(org.jaudiotagger.tag.FieldKey.TITLE))
                    obj.put("artist", g(org.jaudiotagger.tag.FieldKey.ARTIST))
                    obj.put("album", g(org.jaudiotagger.tag.FieldKey.ALBUM))
                    obj.put("track", g(org.jaudiotagger.tag.FieldKey.TRACK))
                    val art = try { tag?.firstArtwork } catch (e: Exception) { null }
                    val bin = art?.binaryData
                    if (bin != null && bin.isNotEmpty()) obj.put("cover", Base64.encodeToString(bin, Base64.NO_WRAP))
                } catch (e: Throwable) {
                } finally { try { tmp?.delete() } catch (e: Exception) {} }
                val payload = org.json.JSONObject.quote(obj.toString())
                runJs("window.DSKBridge&&window.DSKBridge.__tagsRead&&window.DSKBridge.__tagsRead(${org.json.JSONObject.quote(reqId)},$payload)")
            }
        }

        // Escribe etiquetas ID3 sobre el archivo (copia temporal → jaudiotagger →
        // se vuelca de vuelta al URI SAF con "wt"). coverB64 vacío = no tocar la
        // carátula; un solo espacio " " = borrar la carátula. Campos vacíos se
        // borran. Necesita permiso de ESCRITURA en la carpeta (las carpetas
        // nuevas ya lo piden; las antiguas hay que re-vincularlas).
        // Responde por window.DSKBridge.__tagsWritten(reqId, okBool).
        @JavascriptInterface
        fun writeTags(uriString: String, title: String, artist: String, album: String,
                      track: String, coverB64: String, reqId: String) {
            val uri = Uri.parse(uriString)
            browsePool.execute {
                var ok = false
                var tmp: File? = null
                try {
                    val name = queryDisplayName(uri)
                    val nameExt = name.substringAfterLast('.', "").lowercase()
                    // detectar el contenedor real (las descargas M4A pueden venir
                    // renombradas a .mp3): el temporal debe llevar la extensión real
                    // para que jaudiotagger escriba con el contenedor correcto.
                    val raw = File(cacheDir, "tagwrraw_" + System.nanoTime())
                    contentResolver.openInputStream(uri)?.use { input -> raw.outputStream().use { input.copyTo(it) } }
                    val realExt = sniffAudioExt(raw).ifBlank { if (nameExt.isNotBlank()) nameExt else "mp3" }
                    tmp = File(cacheDir, "tagwr_" + System.nanoTime() + "." + realExt)
                    if (!raw.renameTo(tmp!!)) { raw.copyTo(tmp!!, overwrite = true); try { raw.delete() } catch (e: Exception) {} }
                    val af = org.jaudiotagger.audio.AudioFileIO.read(tmp)
                    val tag = af.tagOrCreateAndSetDefault
                    fun setOrDel(k: org.jaudiotagger.tag.FieldKey, v: String) {
                        try { if (v.isBlank()) { try { tag.deleteField(k) } catch (e: Exception) {} } else tag.setField(k, v) } catch (e: Exception) {}
                    }
                    setOrDel(org.jaudiotagger.tag.FieldKey.TITLE, title)
                    setOrDel(org.jaudiotagger.tag.FieldKey.ARTIST, artist)
                    setOrDel(org.jaudiotagger.tag.FieldKey.ALBUM, album)
                    setOrDel(org.jaudiotagger.tag.FieldKey.TRACK, track)
                    if (coverB64 == " ") {
                        try { tag.deleteArtworkField() } catch (e: Exception) {}
                    } else if (coverB64.isNotBlank()) {
                        try {
                            val bytes = Base64.decode(coverB64, Base64.DEFAULT)
                            val pic = org.jaudiotagger.tag.images.AndroidArtwork()
                            pic.binaryData = bytes
                            pic.mimeType = "image/jpeg"
                            try { tag.deleteArtworkField() } catch (e: Exception) {}
                            tag.setField(pic)
                        } catch (e: Exception) {}
                    }
                    af.commit()
                    contentResolver.openOutputStream(uri, "wt")?.use { out -> tmp!!.inputStream().use { it.copyTo(out) } }
                        ?: throw java.io.IOException("no output stream")
                    ok = true
                } catch (e: Throwable) {
                } finally { try { tmp?.delete() } catch (e: Exception) {} }
                runJs("window.DSKBridge&&window.DSKBridge.__tagsWritten&&window.DSKBridge.__tagsWritten(${org.json.JSONObject.quote(reqId)},${if (ok) "true" else "false"})")
            }
        }

        // Lee un audio por URI estable como base64 (fallback si el stream fallara).
        @JavascriptInterface
        fun readUri(uriString: String): String {
            return try {
                contentResolver.openInputStream(Uri.parse(uriString))?.use { input ->
                    Base64.encodeToString(input.readBytes(), Base64.NO_WRAP)
                } ?: ""
            } catch (e: Exception) { "" }
        }

        // Nombre legible de un URI.
        @JavascriptInterface
        fun nameForUri(uriString: String): String = queryDisplayName(Uri.parse(uriString))

        // Re-registra una carpeta raíz a partir de su URI (al importar listas/config).
        // Devuelve true solo si la app tiene/obtiene permiso persistente de lectura.
        // Si no hay permiso (p.ej. tras restaurar en otra instalación), la carpeta
        // se guarda como "pendiente" para que aparezca en Archivos y el usuario
        // pueda re-vincularla con relinkRoot().
        @JavascriptInterface
        fun addRootByUri(uriString: String): Boolean {
            return try {
                val uri = Uri.parse(uriString)
                var has = contentResolver.persistedUriPermissions.any { it.uri == uri && it.isReadPermission }
                if (!has) {
                    try { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (e: Exception) {}
                    has = contentResolver.persistedUriPermissions.any { it.uri == uri && it.isReadPermission }
                }
                if (has) {
                    val cur = loadRoots().toMutableList()
                    if (cur.none { it.toString() == uri.toString() }) cur.add(uri)
                    saveRoots(cur)
                    savePendingRoots(loadPendingRoots().filter { it != uriString })
                    true
                } else {
                    val pend = loadPendingRoots().toMutableList()
                    if (pend.none { it == uriString } && loadRoots().none { it.toString() == uriString }) pend.add(uriString)
                    savePendingRoots(pend)
                    false
                }
            } catch (e: Exception) { false }
        }

        // Abre el selector de carpeta para re-vincular una raíz pendiente (sin
        // permiso). Al elegirla, se añade como raíz normal y se quita de pendientes.
        @JavascriptInterface
        fun relinkRoot(uriString: String) {
            relinkPendingUri = uriString
            runOnUiThread {
                try {
                    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                    intent.putExtra("android.content.extra.SHOW_ADVANCED", true)
                    startActivityForResult(intent, REQUEST_RELINK_ROOT)
                } catch (e: Exception) {
                    Toast.makeText(this@MainActivity, "No se puede abrir el selector de carpeta", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    // Resuelve la carpeta del audio elegido y lista todos los audios hermanos.
    // Estrategia A (preferida): SAF — derivar el árbol de la carpeta padre del
    //   documento elegido y listar sus hijos. Funciona aunque MediaStore no haya
    //   indexado la carpeta (descargas recientes, archivos movidos, etc.).
    // Estrategia B (fallback): MediaStore por BUCKET_ID.
    private fun handlePickedAudio(pickedUri: Uri) {
        try {
            try {
                contentResolver.takePersistableUriPermission(
                    pickedUri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (e: Exception) {}

            val audioExt = Regex("\\.(mp3|wav|ogg|opus|flac|m4a|aac|webm|mid|midi)$", RegexOption.IGNORE_CASE)

            // ---------- Estrategia A: SAF tree ----------
            var uris = ArrayList<Uri>()
            var names = ArrayList<String>()
            var startIndex = 0
            var pickedName = queryDisplayName(pickedUri)

            try {
                if (DocumentsContract.isDocumentUri(this, pickedUri)) {
                    val docId = DocumentsContract.getDocumentId(pickedUri)        // p.ej "primary:Music/mp3/song.mp3"
                    val authority = pickedUri.authority
                    val slash = docId.lastIndexOf('/')
                    if (slash > 0 && authority != null) {
                        val parentDocId = docId.substring(0, slash)              // "primary:Music/mp3"
                        // URI del árbol de la carpeta padre
                        val treeUri = DocumentsContract.buildTreeDocumentUri(authority, parentDocId)
                        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocId)

                        val pairs = ArrayList<Pair<String, Uri>>()
                        contentResolver.query(
                            childrenUri,
                            arrayOf(
                                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                                DocumentsContract.Document.COLUMN_MIME_TYPE
                            ),
                            null, null, null
                        )?.use { c ->
                            val di = c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
                            val ni = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
                            val mi = c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
                            while (c.moveToNext()) {
                                val cid = if (di >= 0) c.getString(di) else continue
                                val nm = if (ni >= 0) c.getString(ni) ?: "" else ""
                                val mime = if (mi >= 0) c.getString(mi) ?: "" else ""
                                val isAudio = mime.startsWith("audio") || audioExt.containsMatchIn(nm)
                                if (!isAudio) continue
                                val cu = DocumentsContract.buildDocumentUri(authority, cid)
                                pairs.add(Pair(nm, cu))
                            }
                        }
                        if (pairs.isNotEmpty()) {
                            pairs.sortWith(compareBy({ it.first.lowercase() }))
                            pairs.forEachIndexed { i, pr ->
                                names.add(pr.first); uris.add(pr.second)
                                if (pr.first == pickedName) startIndex = i
                            }
                        }
                    }
                }
            } catch (e: Exception) { /* sigue al fallback */ }

            // ---------- Estrategia B: MediaStore (bucket por mediaUri, nombre o ruta) ----------
            if (uris.isEmpty()) {
                val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                    android.provider.MediaStore.Audio.Media.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL)
                else
                    android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
                val proj = arrayOf(
                    android.provider.MediaStore.Audio.Media._ID,
                    android.provider.MediaStore.Audio.Media.DISPLAY_NAME,
                    android.provider.MediaStore.Audio.Media.BUCKET_ID,
                    android.provider.MediaStore.Audio.Media.DATA
                )
                var bucket: Long = -1
                var pickedId: Long = -1
                var pickedDir: String? = null   // carpeta del archivo (de DATA)

                // B1: intentar mediaUri directo
                var mediaUri: Uri? = null
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    try { mediaUri = android.provider.MediaStore.getMediaUri(this, pickedUri) } catch (e: Exception) {}
                }
                if (mediaUri != null) {
                    try {
                        contentResolver.query(mediaUri, proj, null, null, null)?.use { c ->
                            if (c.moveToFirst()) {
                                val bi = c.getColumnIndex(android.provider.MediaStore.Audio.Media.BUCKET_ID)
                                val ii = c.getColumnIndex(android.provider.MediaStore.Audio.Media._ID)
                                val da = c.getColumnIndex(android.provider.MediaStore.Audio.Media.DATA)
                                if (bi >= 0) bucket = c.getLong(bi)
                                if (ii >= 0) pickedId = c.getLong(ii)
                                if (da >= 0) c.getString(da)?.let { pickedDir = it.substringBeforeLast('/') }
                            }
                        }
                    } catch (e: Exception) {}
                }

                // B2: por nombre exacto
                if (bucket < 0 && pickedName.isNotEmpty()) {
                    try {
                        contentResolver.query(collection, proj,
                            android.provider.MediaStore.Audio.Media.DISPLAY_NAME + "=?",
                            arrayOf(pickedName), null
                        )?.use { c ->
                            val bi = c.getColumnIndex(android.provider.MediaStore.Audio.Media.BUCKET_ID)
                            val ii = c.getColumnIndex(android.provider.MediaStore.Audio.Media._ID)
                            val da = c.getColumnIndex(android.provider.MediaStore.Audio.Media.DATA)
                            if (c.moveToFirst()) {
                                if (bi >= 0) bucket = c.getLong(bi)
                                if (ii >= 0) pickedId = c.getLong(ii)
                                if (da >= 0) c.getString(da)?.let { pickedDir = it.substringBeforeLast('/') }
                            }
                        }
                    } catch (e: Exception) {}
                }

                // listar hermanos: preferir por carpeta (DATA LIKE), si no por bucket
                if (pickedDir != null) {
                    contentResolver.query(collection, proj,
                        android.provider.MediaStore.Audio.Media.DATA + " LIKE ?",
                        arrayOf(pickedDir + "/%"),
                        android.provider.MediaStore.Audio.Media.DISPLAY_NAME + " ASC"
                    )?.use { c ->
                        val idi = c.getColumnIndexOrThrow(android.provider.MediaStore.Audio.Media._ID)
                        val ni = c.getColumnIndexOrThrow(android.provider.MediaStore.Audio.Media.DISPLAY_NAME)
                        val da = c.getColumnIndex(android.provider.MediaStore.Audio.Media.DATA)
                        var i = 0
                        while (c.moveToNext()) {
                            // asegurar que está en ESA carpeta (no en subcarpetas)
                            if (da >= 0) {
                                val path = c.getString(da) ?: ""
                                if (path.substringBeforeLast('/') != pickedDir) continue
                            }
                            val id = c.getLong(idi)
                            val nm = c.getString(ni) ?: "track_$i"
                            uris.add(android.content.ContentUris.withAppendedId(collection, id)); names.add(nm)
                            if ((pickedId >= 0 && id == pickedId) || (pickedId < 0 && nm == pickedName)) startIndex = i
                            i++
                        }
                    }
                } else if (bucket >= 0) {
                    contentResolver.query(collection, proj,
                        android.provider.MediaStore.Audio.Media.BUCKET_ID + "=?",
                        arrayOf(bucket.toString()),
                        android.provider.MediaStore.Audio.Media.DISPLAY_NAME + " ASC"
                    )?.use { c ->
                        val idi = c.getColumnIndexOrThrow(android.provider.MediaStore.Audio.Media._ID)
                        val ni = c.getColumnIndexOrThrow(android.provider.MediaStore.Audio.Media.DISPLAY_NAME)
                        var i = 0
                        while (c.moveToNext()) {
                            val id = c.getLong(idi)
                            val nm = c.getString(ni) ?: "track_$i"
                            uris.add(android.content.ContentUris.withAppendedId(collection, id)); names.add(nm)
                            if ((pickedId >= 0 && id == pickedId) || (pickedId < 0 && nm == pickedName)) startIndex = i
                            i++
                        }
                    }
                }
            }

            // ---------- fallback final: solo el archivo elegido ----------
            if (uris.isEmpty()) {
                uris.add(pickedUri)
                names.add(if (pickedName.isNotEmpty()) pickedName else "audio")
                startIndex = 0
            }

            folderUris = uris
            persistFolderUris()

            val items = org.json.JSONArray()
            for (k in names.indices) items.put(org.json.JSONObject().put("name", names[k]).put("uri", uris[k].toString()))
            val itemsStr = items.toString()
            val arr = org.json.JSONArray()
            names.forEach { arr.put(it) }
            val payload = arr.toString()
            val si = startIndex
            val count = uris.size
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.DSKLoadFolderUris ? window.DSKLoadFolderUris(" + org.json.JSONObject.quote(itemsStr) + ", $si) : " +
                            "(window.DSKLoadFolder && window.DSKLoadFolder(" + org.json.JSONObject.quote(payload) + ", $si));", null
                )
            }
        } catch (e: Exception) {
            runOnUiThread { Toast.makeText(this@MainActivity, "Error al leer la carpeta: ${e.message}", Toast.LENGTH_LONG).show() }
        }
    }

    // ---- Explorador SAF: raíces persistentes + listado de hijos (Opción A) ----
    private val AUDIO_EXT = Regex("\\.(mp3|wav|ogg|opus|flac|m4a|aac|webm)$", RegexOption.IGNORE_CASE)

    private fun saveRoots(uris: List<Uri>) {
        try {
            val sp = getSharedPreferences("dsklofi", Context.MODE_PRIVATE)
            val arr = org.json.JSONArray(); uris.forEach { arr.put(it.toString()) }
            sp.edit().putString("explorerRoots", arr.toString()).apply()
        } catch (e: Exception) {}
    }

    private fun loadRoots(): List<Uri> = try {
        val raw = getSharedPreferences("dsklofi", Context.MODE_PRIVATE).getString("explorerRoots", null)
        if (raw == null) emptyList()
        else {
            val arr = org.json.JSONArray(raw)
            (0 until arr.length()).map { Uri.parse(arr.getString(it)) }
        }
    } catch (e: Exception) { emptyList() }

    // Carpetas raíz "pendientes": se conocían (vía import de config/listas) pero
    // la app no tiene permiso de lectura sobre ellas en esta instalación. Se
    // muestran en Archivos para que el usuario las re-vincule con relinkRoot().
    private fun savePendingRoots(uris: List<String>) {
        try {
            val sp = getSharedPreferences("dsklofi", Context.MODE_PRIVATE)
            val arr = org.json.JSONArray(); uris.forEach { arr.put(it) }
            sp.edit().putString("explorerPendingRoots", arr.toString()).apply()
        } catch (e: Exception) {}
    }

    private fun loadPendingRoots(): List<String> = try {
        val raw = getSharedPreferences("dsklofi", Context.MODE_PRIVATE).getString("explorerPendingRoots", null)
        if (raw == null) emptyList()
        else {
            val arr = org.json.JSONArray(raw)
            (0 until arr.length()).map { arr.getString(it) }
        }
    } catch (e: Exception) { emptyList() }

    private fun addRoot(treeUri: Uri) {
        try {
            contentResolver.takePersistableUriPermission(
                treeUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
        } catch (e: Exception) {
            try { contentResolver.takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (e2: Exception) {}
        }
        val cur = loadRoots().toMutableList()
        if (cur.none { it.toString() == treeUri.toString() }) cur.add(treeUri)
        saveRoots(cur)
    }

    private fun treeDisplayName(treeUri: Uri): String = try {
        val id = DocumentsContract.getTreeDocumentId(treeUri)
        id.substringAfterLast('/').substringAfterLast(':').ifEmpty { id }
    } catch (e: Exception) { treeUri.lastPathSegment ?: "Carpeta" }

    private fun rootsJson(): String {
        val arr = org.json.JSONArray()
        val granted = loadRoots()
        granted.forEach { uri ->
            arr.put(org.json.JSONObject().put("uri", uri.toString()).put("name", treeDisplayName(uri)).put("dir", true).put("pending", false))
        }
        val grantedSet = granted.map { it.toString() }.toSet()
        loadPendingRoots().forEach { uriStr ->
            if (uriStr !in grantedSet) {
                arr.put(org.json.JSONObject().put("uri", uriStr).put("name", treeDisplayName(Uri.parse(uriStr))).put("dir", true).put("pending", true))
            }
        }
        return arr.toString()
    }

    // Lista carpetas + audios de un nodo (raíz tree o subcarpeta) como JSON [{name,uri,dir}].
    // docId SAF ("primary:Music/x.mp3" / "XXXX-XXXX:...") → ruta real del sistema.
    private fun docIdToPath(docId: String): String {
        return try {
            val i = docId.indexOf(':')
            if (i < 0) return ""
            val vol = docId.substring(0, i)
            val rel = docId.substring(i + 1)
            if (vol.equals("primary", true)) "/storage/emulated/0/" + rel
            else "/storage/" + vol + "/" + rel
        } catch (e: Exception) { "" }
    }

    private fun mimeForName(name: String): String {
        val n = name.lowercase()
        return when {
            n.endsWith(".mp3") -> "audio/mpeg"
            n.endsWith(".m4a") || n.endsWith(".mp4") || n.endsWith(".aac") -> "audio/mp4"
            n.endsWith(".ogg") || n.endsWith(".opus") -> "audio/ogg"
            n.endsWith(".wav") -> "audio/wav"
            n.endsWith(".flac") -> "audio/flac"
            else -> "audio/*"
        }
    }

    private fun listChildrenJson(folderUri: Uri): String {
        val arr = org.json.JSONArray()
        try {
            val isTree = !folderUri.toString().contains("/document/")
            val parentId = if (isTree) DocumentsContract.getTreeDocumentId(folderUri)
            else DocumentsContract.getDocumentId(folderUri)
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(folderUri, parentId)
            val dirs = ArrayList<org.json.JSONObject>()
            val files = ArrayList<org.json.JSONObject>()
            contentResolver.query(
                childrenUri,
                arrayOf(
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE
                ), null, null, null
            )?.use { c ->
                val di = c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
                val ni = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
                val mi = c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
                while (c.moveToNext()) {
                    val cid = if (di >= 0) c.getString(di) else continue
                    val nm = if (ni >= 0) c.getString(ni) ?: "" else ""
                    val mime = if (mi >= 0) c.getString(mi) ?: "" else ""
                    val cu = DocumentsContract.buildDocumentUriUsingTree(folderUri, cid)
                    if (mime == DocumentsContract.Document.MIME_TYPE_DIR)
                        dirs.add(org.json.JSONObject().put("name", nm).put("uri", cu.toString()).put("dir", true))
                    else if (mime.startsWith("audio") || AUDIO_EXT.containsMatchIn(nm))
                        files.add(org.json.JSONObject().put("name", nm).put("uri", cu.toString()).put("dir", false).put("path", docIdToPath(cid)))
                }
            }
            dirs.sortBy { it.optString("name").lowercase() }
            files.sortBy { it.optString("name").lowercase() }
            dirs.forEach { arr.put(it) }
            files.forEach { arr.put(it) }
        } catch (e: Exception) {}
        return arr.toString()
    }

    // Persiste los URIs de la carpeta actual para restaurar la cola al reabrir.
    private fun persistFolderUris() {
        try {
            val sp = getSharedPreferences("dsklofi", Context.MODE_PRIVATE)
            val arr = org.json.JSONArray()
            folderUris.forEach { arr.put(it.toString()) }
            sp.edit().putString("folderUris", arr.toString()).apply()
        } catch (e: Exception) {}
    }

    private fun restoreFolderUris(): Boolean {
        return try {
            val sp = getSharedPreferences("dsklofi", Context.MODE_PRIVATE)
            val raw = sp.getString("folderUris", null) ?: return false
            val arr = org.json.JSONArray(raw)
            val list = ArrayList<Uri>()
            for (i in 0 until arr.length()) list.add(Uri.parse(arr.getString(i)))
            if (list.isEmpty()) return false
            folderUris = list
            true
        } catch (e: Exception) { false }
    }

    // Tras cargar la web: si no llegó audio por intent, intenta restaurar la
    // última cola (nombres + posición vienen de localStorage vía DSKGetSavedQueue).
    private fun tryRestoreQueue() {
        if (hasIncomingAudio) return
        if (!restoreFolderUris()) return
        webView.evaluateJavascript("window.DSKGetSavedQueue && window.DSKGetSavedQueue();") { result ->
            if (result == null || result == "null" || result == "\"\"" || result.length < 4) return@evaluateJavascript
            try {
                // result viene como string JSON escapado; desescapar
                val json = org.json.JSONTokener(result).nextValue()
                val obj = if (json is String) org.json.JSONObject(json) else json as org.json.JSONObject
                val names = obj.optJSONArray("names") ?: return@evaluateJavascript
                // si el nº de nombres no cuadra con los URIs guardados, abortar
                if (names.length() != folderUris.size) return@evaluateJavascript
                val index = obj.optInt("index", 0)
                val pos = obj.optDouble("pos", 0.0)
                val shuffle = obj.optBoolean("shuffle", false)
                val restore = org.json.JSONObject()
                restore.put("pos", pos); restore.put("autoplay", false); restore.put("shuffle", shuffle)
                runOnUiThread {
                    webView.evaluateJavascript(
                        "window.DSKLoadFolder && window.DSKLoadFolder(" +
                                org.json.JSONObject.quote(names.toString()) + ", $index, " +
                                restore.toString() + ");", null
                    )
                }
            } catch (e: Exception) {}
        }
    }

    private fun errorResponse(): WebResourceResponse {
        return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", HashMap(), java.io.ByteArrayInputStream(ByteArray(0)))
    }

    private fun queryDisplayName(uri: Uri): String {
        return try {
            var n = ""
            contentResolver.query(uri, null, null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val ni = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                    if (ni >= 0) n = c.getString(ni) ?: ""
                }
            }
            n
        } catch (e: Exception) { "" }
    }

    // Detecta el contenedor real de un audio por sus primeros bytes (no por la
    // extensión). Devuelve "mp3"/"m4a"/"flac"/"ogg"/"wav" o "" si no se reconoce.
    private fun sniffAudioExt(f: File): String {
        return try {
            f.inputStream().use { ins ->
                val b = ByteArray(16)
                val n = ins.read(b)
                if (n < 4) return ""
                fun c(i: Int, ch: Char) = i < n && b[i] == ch.code.toByte()
                // ID3 (mp3 con tag) o frame sync MPEG
                if (b[0] == 0x49.toByte() && b[1] == 0x44.toByte() && b[2] == 0x33.toByte()) return "mp3"
                if ((b[0].toInt() and 0xFF) == 0xFF && (b[1].toInt() and 0xE0) == 0xE0) return "mp3"
                // ....ftyp → contenedor MP4/M4A
                if (n >= 8 && c(4, 'f') && c(5, 't') && c(6, 'y') && c(7, 'p')) return "m4a"
                if (c(0, 'f') && c(1, 'L') && c(2, 'a') && c(3, 'C')) return "flac"
                if (c(0, 'O') && c(1, 'g') && c(2, 'g') && c(3, 'S')) return "ogg"
                if (c(0, 'R') && c(1, 'I') && c(2, 'F') && c(3, 'F')) return "wav"
            }
            ""
        } catch (e: Exception) { "" }
    }

    // Lista todos los audios de una carpeta elegida con ACTION_OPEN_DOCUMENT_TREE.
    private fun handlePickedTree(treeUri: Uri) {
        try {
            try {
                contentResolver.takePersistableUriPermission(
                    treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (e: Exception) {}

            val audioExt = Regex("\\.(mp3|wav|ogg|opus|flac|m4a|aac|webm|mid|midi)$", RegexOption.IGNORE_CASE)
            val docId = DocumentsContract.getTreeDocumentId(treeUri)
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId)

            val pairs = ArrayList<Pair<String, Uri>>()
            contentResolver.query(
                childrenUri,
                arrayOf(
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE
                ),
                null, null, null
            )?.use { c ->
                val di = c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
                val ni = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
                val mi = c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
                while (c.moveToNext()) {
                    val cid = if (di >= 0) c.getString(di) else continue
                    val nm = if (ni >= 0) c.getString(ni) ?: "" else ""
                    val mime = if (mi >= 0) c.getString(mi) ?: "" else ""
                    val isAudio = mime.startsWith("audio") || audioExt.containsMatchIn(nm)
                    if (!isAudio) continue
                    val cu = DocumentsContract.buildDocumentUriUsingTree(treeUri, cid)
                    pairs.add(Pair(nm, cu))
                }
            }

            if (pairs.isEmpty()) {
                runOnUiThread { Toast.makeText(this@MainActivity, "No hay audios en esa carpeta", Toast.LENGTH_LONG).show() }
                return
            }

            pairs.sortWith(compareBy({ it.first.lowercase() }))
            val uris = ArrayList<Uri>()
            val names = ArrayList<String>()
            pairs.forEach { names.add(it.first); uris.add(it.second) }
            folderUris = uris
            persistFolderUris()
            addRoot(treeUri)

            val items = org.json.JSONArray()
            for (k in names.indices) items.put(org.json.JSONObject().put("name", names[k]).put("uri", uris[k].toString()))
            val itemsStr = items.toString()
            val arr = org.json.JSONArray()
            names.forEach { arr.put(it) }
            val payload = arr.toString()
            val count = uris.size
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.DSKLoadFolderUris ? window.DSKLoadFolderUris(" + org.json.JSONObject.quote(itemsStr) + ", 0) : " +
                            "(window.DSKLoadFolder && window.DSKLoadFolder(" + org.json.JSONObject.quote(payload) + ", 0));", null
                )
            }
        } catch (e: Exception) {
            runOnUiThread { Toast.makeText(this@MainActivity, "Error al leer la carpeta: ${e.message}", Toast.LENGTH_LONG).show() }
        }
    }

    override fun onBackPressed() {
        if (!::webView.isInitialized) { super.onBackPressed(); return }
        // Pregunta a la app si hay algo que deshacer (modal abierto, pestaña no principal…)
        webView.evaluateJavascript(
            "(function(){try{return (typeof DSKHandleBack==='function')?DSKHandleBack():false;}catch(e){return false;}})()"
        ) { result ->
            if (result == "true") return@evaluateJavascript
            android.app.AlertDialog.Builder(this)
                .setTitle("Confirmación")
                .setMessage("¿Estás seguro de que quieres salir?")
                .setPositiveButton("Salir") { _, _ -> finish() }
                .setNegativeButton("Cancelar", null)
                .show()
        }
    }

    override fun onPause() {
        super.onPause()
        // Si la notificación de reproducción está activa, NO pausamos el WebView:
        // así el audio (Web Audio API) y los controles siguen vivos con la
        // pantalla apagada / la app en segundo plano.
        if (PlaybackService.instance == null) webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        // Si está sonando, NO paramos el servicio ni matamos el proceso:
        // el WebView (con el motor Web Audio) sigue vivo en segundo plano
        // y la notificación/MediaSession siguen controlando la reproducción.
        if (PlaybackService.instance?.isPlaying() != true) {
            try { stopService(Intent(this, PlaybackService::class.java)) } catch (e: Exception) {}
        }
        ref = null
        super.onDestroy()
    }
}