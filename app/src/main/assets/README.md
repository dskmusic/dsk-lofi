# DSK•LoFi

**Local lofi FX studio** — convierte cualquier canción al estilo LoFi. 100% local: sin CDN, sin red, sin rastreo. Funciona como **PWA** en cualquier servidor web y como **WebView** dentro de una APK de Android Studio.

```
DSK-LoFi/
├── index.html              ← entrada única
├── manifest.json           ← PWA file 
├── sw.js                   ← service worker offline-first
├── css/  tokens.css, app.css
├── js/   i18n.js, bridge.js, encoder.js, engine.js, ui.js, app.js, lofi-worklet.js
├── icons/ icon-192/512 + maskable
└── libs/  lame.min.js → exportación MP3 (incluida, 100% local)
```

---

## 1 · Despliegue web (PWA)

Copia la carpeta `DSK-LoFi/` a tu servidor y sirve por **HTTPS** (o `localhost`). Requisito de la plataforma: Service Worker y AudioWorklet no funcionan sobre `file://`.

- Carga de audio: MP3, WAV, OGG, OPUS, FLAC, M4A (lo que soporte el decodificador del navegador).
- Exporta **MP3 (192 kbps, por defecto)** con la build local de [lamejs] incluida en `libs/lame.min.js`, o **WAV** sin pérdida. Nunca se descarga nada de un CDN.

## 2 · Android Studio (WebView + puente Kotlin)

Copia `DSK-LoFi/` a `app/src/main/assets/DSK-LoFi/` y carga `file:///android_asset/DSK-LoFi/index.html` — o mejor, usa `WebViewAssetLoader` (https virtual, habilita el worklet):

```kotlin
val assetLoader = WebViewAssetLoader.Builder()
    .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
    .build()

webView.webViewClient = object : WebViewClientCompat() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
        assetLoader.shouldInterceptRequest(request.url)
}
webView.settings.apply {
    javaScriptEnabled = true
    domStorageEnabled = true
    allowFileAccess = false
    mediaPlaybackRequiresUserGesture = false
}
webView.addJavascriptInterface(DskBridge(this), "DSKBridge")
webView.loadUrl("https://appassets.androidplatform.net/assets/DSK-LoFi/index.html")
```

### Puente de guardado → carpeta /DSKlofi

La app llama `DSKBridge.saveFile(name, base64, mime)` al exportar. Implementación con MediaStore (sin permisos en API 29+), guarda en `Music/DSKlofi`:

```kotlin
class DskBridge(private val ctx: Context) {
    @JavascriptInterface
    fun saveFile(name: String, base64: String, mime: String) {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        val values = ContentValues().apply {
            put(MediaStore.Audio.Media.DISPLAY_NAME, name)
            put(MediaStore.Audio.Media.MIME_TYPE, mime)
            put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/DSKlofi")
        }
        val uri = ctx.contentResolver.insert(
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values
        ) ?: return
        ctx.contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
    }

    @JavascriptInterface
    fun appVersion(): String = BuildConfig.VERSION_NAME   // opcional
}
```

### Selector de archivos (`<input type="file">`)

```kotlin
webView.webChromeClient = object : WebChromeClient() {
    override fun onShowFileChooser(
        view: WebView, callback: ValueCallback<Array<Uri>>,
        params: FileChooserParams
    ): Boolean {
        filePathCallback = callback
        fileChooserLauncher.launch(params.createIntent())  // ActivityResult API
        return true
    }
}
```

Si `window.DSKBridge` existe, la app guarda en `/DSKlofi` y lo indica en OPCIONES (`ANDROID · /DSKlofi`). En navegador hace descarga normal (`WEB · PWA`).

## 3 · Añadir un idioma

Edita `js/i18n.js`: duplica el bloque `es`, cámbiale el código (p. ej. `fr`), traduce las cadenas. El idioma aparece automáticamente en OPCIONES. Detección automática por `navigator.language` con fallback a inglés.

## 4 · Notas técnicas

- **Motor**: Web Audio. Cadena LoFi = wow/flutter (delay modulado) → bitcrush + reducción de sample-rate + siseo + crujido (AudioWorklet) → filtro de tono → saturación. FX: reverb por convolución (IR generada), delay con realimentación filtrada, chorus de 2 voces.
- **Exportación**: render con `OfflineAudioContext` — lo que oyes es exactamente lo que se guarda (incluida la cola de reverb/delay).
- **Persistencia**: parámetros, tema e idioma en `localStorage`. "Restaurar valores" (con confirmación) vuelve todo a fábrica.
- **A/B**: mantén pulsado el botón A/B para oír la señal original.
- Doble toque sobre la etiqueta de un slider = reset de ese parámetro.

[lamejs]: https://github.com/zhuker/lamejs
