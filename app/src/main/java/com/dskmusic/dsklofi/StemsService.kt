package com.dskmusic.dsklofi

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Servicio en primer plano que mantiene viva la separación de stems mientras se
 * procesa (puede tardar minutos). No hace el trabajo: solo evita que el sistema
 * mate el proceso. El trabajo real corre en el hilo de StemsBridge.
 *
 * Manifest:
 *   <service android:name=".StemsService"
 *            android:exported="false"
 *            android:foregroundServiceType="dataSync" />
 *   <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
 *   <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />  <!-- API 34+ -->
 */
class StemsService : Service() {

    companion object {
        private const val CH_ID = "dsk_stems"
        private const val NOTIF_ID = 7321

        fun start(ctx: Context) {
            val i = Intent(ctx, StemsService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
        }

        fun stop(ctx: Context) {
            try { ctx.stopService(Intent(ctx, StemsService::class.java)) } catch (e: Exception) {}
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIF_ID, buildNotification())
        return START_NOT_STICKY
    }

    private fun buildNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CH_ID) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(CH_ID, "Stems", NotificationManager.IMPORTANCE_LOW)
                )
            }
        }
        return NotificationCompat.Builder(this, CH_ID)
            .setContentTitle("DSK·LoFi")
            .setContentText("Separando voz…")
            .setSmallIcon(android.R.drawable.ic_menu_manage)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
}
