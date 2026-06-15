package com.dskmusic.dsklofi

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Base64
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Notificación persistente + MediaSession de DSK•LoFi.
 * - Servicio en primer plano: sobrevive en segundo plano y pantalla bloqueada.
 * - Controles: Anterior · Play/Pausa · Siguiente · Cerrar.
 * - MediaSession activa: los botones multimedia de auriculares / Bluetooth /
 *   pantalla bloqueada se enrutan a los callbacks (play/pause/next/prev).
 * - El audio vive en el WebView; el servicio refleja el estado y reenvía las
 *   órdenes a la web vía window.DSKControls.
 */
class PlaybackService : Service() {

    companion object {
        const val CHANNEL_ID = "dsklofi_playback"
        const val NOTIF_ID = 4101
        const val ACTION_UPDATE = "com.dskmusic.dsklofi.UPDATE"
        const val ACTION_TOGGLE = "com.dskmusic.dsklofi.TOGGLE"
        const val ACTION_NEXT   = "com.dskmusic.dsklofi.NEXT"
        const val ACTION_PREV   = "com.dskmusic.dsklofi.PREV"
        const val ACTION_STOP   = "com.dskmusic.dsklofi.STOP"

        @Volatile
        var instance: PlaybackService? = null

        // Carátula pendiente (base64 jpeg). null = sin cambio, "" = quitar carátula.
        @Volatile
        var pendingCover: String? = null
        @Volatile
        var pendingCoverSet = false

        /** Punto de entrada desde MainActivity.AndroidMedia.update(). */
        fun pushState(ctx: Context, playing: Boolean, title: String, artist: String, cover: String? = null, durationSec: Int = 0, positionSec: Int = 0) {
            if (cover != null) { pendingCover = cover; pendingCoverSet = true }
            val svc = instance
            if (svc != null) {
                svc.postState(playing, title, artist, durationSec, positionSec)
            } else {
                // Arranque en frío (también en pausa, para mantener controles visibles)
                val i = Intent(ctx, PlaybackService::class.java).apply {
                    action = ACTION_UPDATE
                    putExtra("playing", playing)
                    putExtra("title", title)
                    putExtra("artist", artist)
                    putExtra("duration", durationSec)
                    putExtra("position", positionSec)
                }
                ContextCompat.startForegroundService(ctx, i)
            }
        }
    }

    private var playing = false
    private var title = "DSK•LoFi"
    private var artist = "lofi tape machine"
    private var durationMs = 0L
    private var positionMs = 0L
    private var coverBitmap: Bitmap? = null     // carátula de la pista (null = usar logo)
    private var launcherIcon: Bitmap? = null     // logo de la app, cacheado

    private lateinit var session: MediaSessionCompat
    private val handler = Handler(Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        createChannel()
        session = MediaSessionCompat(this, "DSKLoFi").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay()          { jsSetPlaying(true) }
                override fun onPause()         { jsSetPlaying(false) }
                override fun onSkipToNext()    { js("window.DSKControls&&window.DSKControls.next()") }
                override fun onSkipToPrevious(){ js("window.DSKControls&&window.DSKControls.prev()") }
                override fun onStop()          { stopFromAction() }
                override fun onSeekTo(pos: Long) {
                    js("window.DSKControls&&window.DSKControls.seek&&window.DSKControls.seek(${pos / 1000.0})")
                }
                // Botones físicos de auriculares / Bluetooth (play/pause, next, prev)
                override fun onMediaButtonEvent(intent: Intent): Boolean {
                    val ke = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
                    if (ke != null && ke.action == KeyEvent.ACTION_DOWN) {
                        when (ke.keyCode) {
                            KeyEvent.KEYCODE_MEDIA_PLAY -> { jsSetPlaying(true); return true }
                            KeyEvent.KEYCODE_MEDIA_PAUSE -> { jsSetPlaying(false); return true }
                            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
                            KeyEvent.KEYCODE_HEADSETHOOK -> { jsToggle(); return true }
                            KeyEvent.KEYCODE_MEDIA_NEXT -> { js("window.DSKControls&&window.DSKControls.next()"); return true }
                            KeyEvent.KEYCODE_MEDIA_PREVIOUS -> { js("window.DSKControls&&window.DSKControls.prev()"); return true }
                            KeyEvent.KEYCODE_MEDIA_STOP -> { stopFromAction(); return true }
                        }
                    }
                    return super.onMediaButtonEvent(intent)
                }
            })
            isActive = true
        }
    }

    private var stopping = false

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // SIEMPRE entrar en foreground primero: si el servicio se inició y no llama
        // a startForeground en ~5s, Android mata la app. Esto evita el crash.
        startForegroundCompat()

        if (::session.isInitialized) {
            try { MediaButtonReceiverCompat.handleIntent(session, intent) } catch (e: Exception) {}
        }
        when (intent?.action) {
            ACTION_UPDATE -> applyState(
                intent.getBooleanExtra("playing", false),
                intent.getStringExtra("title") ?: title,
                intent.getStringExtra("artist") ?: artist,
                intent.getIntExtra("duration", 0),
                intent.getIntExtra("position", 0)
            )
            ACTION_TOGGLE -> jsToggle()
            ACTION_NEXT -> js("window.DSKControls&&window.DSKControls.next()")
            ACTION_PREV -> js("window.DSKControls&&window.DSKControls.prev()")
            ACTION_STOP -> { stopFromAction(); return START_NOT_STICKY }
            else -> { /* foreground ya activo arriba */ }
        }
        return START_STICKY
    }

    private var wantTarget: Boolean? = null
    private var wantTries = 0

    // Orden DETERMINISTA e idempotente: play o pause según el destino, nunca un
    // toggle ciego. Si la notificación + la MediaSession disparan a la vez, dos
    // setPlaying(true) NO se anulan (un toggle x2 sí → era el bug del play/pausa).
    private fun jsSetPlaying(want: Boolean) {
        wantTarget = want
        wantTries = 0
        js("window.DSKControls&&window.DSKControls.setPlaying($want)")
        scheduleReconcile()
    }

    private fun jsToggle() = jsSetPlaying(!playing)

    // Red de seguridad: si el estado real no cambia (WebView descongelándose en
    // segundo plano), reenvía la misma orden idempotente.
    private fun scheduleReconcile() {
        if (wantTarget == null) return
        handler.postDelayed({
            val target = wantTarget ?: return@postDelayed
            if (playing == target) { wantTarget = null; return@postDelayed }
            if (wantTries++ < 3) {
                js("window.DSKControls&&window.DSKControls.setPlaying($target)")
                scheduleReconcile()
            } else wantTarget = null
        }, 800)
    }
    private fun js(code: String) = MainActivity.runJs(code)

    fun postState(playing: Boolean, title: String, artist: String, durationSec: Int = 0, positionSec: Int = 0) {
        handler.post { applyState(playing, title, artist, durationSec, positionSec) }
    }

    private fun applyState(playing: Boolean, title: String, artist: String, durationSec: Int = 0, positionSec: Int = 0) {
        this.playing = playing
        this.title = title
        this.artist = artist
        this.durationMs = (durationSec.toLong()).coerceAtLeast(0L) * 1000L
        this.positionMs = (positionSec.toLong()).coerceAtLeast(0L) * 1000L
        consumeCover()
        updateSession()
        startForegroundCompat()
    }

    /** Aplica la carátula pendiente enviada por la web (si la hay). */
    private fun consumeCover() {
        if (!pendingCoverSet) return
        val c = pendingCover
        pendingCover = null
        pendingCoverSet = false
        coverBitmap = if (c.isNullOrEmpty()) null else try {
            val bytes = Base64.decode(c, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (e: Exception) { null }
    }

    /** Logo de la app como bitmap (respaldo cuando la pista no tiene carátula). */
    private fun launcherBitmap(): Bitmap? {
        launcherIcon?.let { return it }
        launcherIcon = try {
            val d = ContextCompat.getDrawable(this, R.mipmap.ic_launcher)
            when {
                d == null -> null
                d is BitmapDrawable -> d.bitmap
                else -> {
                    val w = if (d.intrinsicWidth > 0) d.intrinsicWidth else 192
                    val h = if (d.intrinsicHeight > 0) d.intrinsicHeight else 192
                    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                    val cv = Canvas(bmp)
                    d.setBounds(0, 0, w, h)
                    d.draw(cv)
                    bmp
                }
            }
        } catch (e: Exception) { null }
        return launcherIcon
    }

    private fun buildNotification(): Notification {
        val toggleIcon = if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val toggleLabel = if (playing) "Pausar" else "Reproducir"

        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            piFlags()
        )

        val style = androidx.media.app.NotificationCompat.MediaStyle()
            .setMediaSession(session.sessionToken)
            .setShowActionsInCompactView(0, 1, 2)   // prev, play/pause, next en vista compacta
            .setShowCancelButton(true)
            .setCancelButtonIntent(action(ACTION_STOP))

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setLargeIcon(coverBitmap ?: launcherBitmap())
            .setContentTitle(title)
            .setContentText(artist)
            .setContentIntent(open)
            .setOngoing(playing)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .addAction(android.R.drawable.ic_media_previous, "Anterior", action(ACTION_PREV))
            .addAction(toggleIcon, toggleLabel, action(ACTION_TOGGLE))
            .addAction(android.R.drawable.ic_media_next, "Siguiente", action(ACTION_NEXT))
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Cerrar", action(ACTION_STOP))
            .setStyle(style)
            .build()
    }

    private fun startForegroundCompat() {
        val n = buildNotification()
        if (Build.VERSION.SDK_INT >= 29) {
            ServiceCompat.startForeground(this, NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIF_ID, n)
        }
    }

    private fun updateNotification() {
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIF_ID, buildNotification())
    }

    private fun updateSession() {
        session.setMetadata(
            MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, if (durationMs > 0) durationMs else -1L)
                .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, coverBitmap ?: launcherBitmap())
                .build()
        )
        val state = if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        val pos = if (positionMs >= 0) positionMs else PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN
        session.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(
                    PlaybackStateCompat.ACTION_PLAY or
                            PlaybackStateCompat.ACTION_PAUSE or
                            PlaybackStateCompat.ACTION_PLAY_PAUSE or
                            PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                            PlaybackStateCompat.ACTION_SEEK_TO or
                            PlaybackStateCompat.ACTION_STOP
                )
                .setState(state, pos, if (playing) 1f else 0f, android.os.SystemClock.elapsedRealtime())
                .build()
        )
        updateNotification()
    }

    private fun stopFromAction() {
        if (stopping) return
        stopping = true
        try { if (playing) jsToggle() } catch (e: Exception) {}
        try { if (::session.isInitialized) session.isActive = false } catch (e: Exception) {}
        try { ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE) } catch (e: Exception) {}
        stopSelf()
    }

    private fun action(a: String): PendingIntent =
        PendingIntent.getService(
            this, a.hashCode(),
            Intent(this, PlaybackService::class.java).setAction(a),
            piFlags()
        )

    private fun piFlags(): Int =
        if (Build.VERSION.SDK_INT >= 23)
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        else
            PendingIntent.FLAG_UPDATE_CURRENT

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val ch = NotificationChannel(CHANNEL_ID, "Reproducción", NotificationManager.IMPORTANCE_LOW)
            ch.setSound(null, null)
            ch.enableVibration(false)
            ch.setShowBadge(false)
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
    }

    override fun onDestroy() {
        try { session.release() } catch (e: Exception) {}
        instance = null
        super.onDestroy()
    }
}

/** Helper mínimo para enrutar el media-button intent a la sesión sin depender
 *  de MediaButtonReceiver (que requeriría declararlo en el manifiesto). */
object MediaButtonReceiverCompat {
    fun handleIntent(session: MediaSessionCompat, intent: Intent?) {
        if (intent?.action == Intent.ACTION_MEDIA_BUTTON) {
            try { androidx.media.session.MediaButtonReceiver.handleIntent(session, intent) } catch (e: Exception) {}
        }
    }
}