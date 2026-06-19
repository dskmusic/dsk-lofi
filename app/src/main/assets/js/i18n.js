/* =============================================================================
   DSK•LoFi — i18n.js
   Tiny local i18n. Auto-detects navigator.language, falls back to English.
   ADD A LANGUAGE: copy the "es" block, translate the strings, done — it will
   appear automatically in the Options menu.
   ========================================================================== */
(function () {
  "use strict";

  const LANGS = {
    /* ---------------------------------------------------------------- EN -- */
    en: {
      name: "English",
      strings: {
        tagline: "Retro Player",

        /* loader */
        load_title: "TAP TO LOAD AUDIO",
        load_sub: "or drop a file here",
        load_formats: "MP3 · WAV · OGG · OPUS · FLAC · M4A",
        load_change: "CHANGE TRACK",
        decoding: "REWINDING TAPE…",
        err_decode: "Could not read that file. Try MP3, WAV, OGG or OPUS.", need_all_files: "Grant \"All files access\" to play imported tracks.",
        file_missing_skipped: "File not found — removed from the list.",
        err_audio: "Audio engine failed to start. Reload and try again.",

        /* transport */
        play: "Play", pause: "Pause", stop: "Stop",
        loop: "Loop",
        mode_aria: "LoFi engine / player-only",
        rnd: "Randomize FX",
        prev: "Previous", next: "Next", stop: "Stop", shuffle: "Shuffle", timer: "Sleep timer", open_audio: "Open audio",
        load_dir: "LOAD FOLDER",
        playlist: "PLAYLIST", pl_search: "Search…", pl_no_results: "No matches", sp_title: "SPEED", sp_manual: "MANUAL", viz_pick: "VISUALIZER", viz_ok: "DONE",
        tm_title: "SLEEP TIMER",
        tm_custom: "CUSTOM (MIN)", tm_set: "SET", tm_cancel: "CANCEL TIMER",
        tm_hint: "Fades out gently over the last seconds, then pauses.",
        tm_on: "Timer set", tm_off: "Timer cancelled", tm_done: "Sleep timer ended", tm_endtrack: "WHEN TRACK ENDS", tm_endtrack_on: "Will stop when the track ends",
        gp_title: "PRESET", gp_select: "— Select preset —", gp_manage: "MANAGE PRESETS",
        gp_save_as: "SAVE CURRENT AS", gp_save: "SAVE", gp_name_ph: "My preset name",
        gp_export: "EXPORT", gp_import: "IMPORT",
        gp_saved: "Preset saved", gp_deleted: "Preset deleted", gp_applied: "Preset applied",
        gp_exported: "Presets exported", gp_imported: "Presets imported", gp_import_fail: "Could not import file",
        gp_empty: "No saved presets yet", gp_factory: "Built-in", gp_user: "Yours",
        gp_del_title: "DELETE PRESET?", gp_del_msg: "This user preset will be removed.",
        randomized: "FX randomized — volume untouched",
        no_file: "NO TAPE LOADED",

        /* sections */
        sec_lofi: "LOFI ENGINE",
        sec_reverb: "REVERB",
        sec_delay: "DELAY",
        sec_chorus: "CHORUS",
        sec_space: "SPACE",
        sec_output: "OUTPUT",
        sec_export: "EXPORT",
        presets: "PRESETS",
        reset_section: "Reset section",
        fx_on: "ON", fx_off: "OFF",

        /* lofi params */
        p_tone: "TONE", p_crush: "CRUSH", p_hiss: "TAPE HISS",
        p_crackle: "VINYL CRACKLE", p_wow: "WOW / FLUTTER",
        /* reverb */
        p_rv_mix: "MIX", p_rv_size: "SIZE", p_rv_damp: "DAMPING",
        /* delay */
        p_dl_time: "TIME", p_dl_fb: "FEEDBACK", p_dl_mix: "MIX",
        /* chorus */
        p_ch_rate: "RATE", p_ch_depth: "DEPTH", p_ch_mix: "MIX",
        /* space */
        p_sp_width: "WIDTH", p_sp_amount: "AMOUNT",
        /* output */
        p_volume: "VOLUME", p_gain: "GAIN",

        /* preset names */
        pr_custom: "CUSTOM",
        pr_lofi_vinyl: "VINYL", pr_lofi_tape: "TAPE", pr_lofi_radio: "RADIO",
        pr_lofi_dream: "DREAM", pr_lofi_clean: "SUBTLE",
        pr_rv_room: "ROOM", pr_rv_hall: "HALL", pr_rv_cave: "CAVE",
        pr_dl_slap: "SLAP", pr_dl_echo: "ECHO", pr_dl_dub: "DUB",
        pr_ch_soft: "SOFT", pr_ch_wide: "WIDE", pr_ch_wobble: "WOBBLE",
        pr_sp_subtle: "SUBTLE", pr_sp_wide: "WIDE", pr_sp_huge: "HUGE",

        /* export */
        ex_format: "FORMAT",
        ex_name: "FILE NAME",
        ex_render: "RENDER & SAVE",
        ex_rendering: "RENDERING…",
        ex_encoding: "ENCODING…",
        ex_done_bridge: "Saved to /DSKlofi",
        ex_done_web: "Download started",
        ex_fail: "Export failed. Try again.",
        ex_cancel: "CANCEL", ex_cancel_sure: "TAP AGAIN TO CANCEL", ex_cancelling: "CANCELLING…",
        ex_cancel_title: "Cancel export?",
        ex_cancel_confirm: "The current export will be discarded.",
        ex_cancelled: "Export cancelled",
        ex_hint_bridge: "Files are saved to the /DSKlofi folder.",
        ex_hint_web: "Browser mode: file downloads to your device. In the Android app it is saved to /DSKlofi.",
        ex_mp3_missing: "MP3 encoder not installed — see README. Exporting WAV instead.",

        /* options */
        opt_title: "OPTIONS",
        opt_lang: "LANGUAGE",
        opt_theme: "THEME",
        theme_dark: "DARK", theme_light: "LIGHT",
        opt_restore: "RESTORE DEFAULTS", opt_playeronly: "PLAYER-ONLY MODE", opt_playeronly_sub: "Instant playback, no effects. Hides FX, presets and export.",
        opt_splash: "LOADING SCREEN", opt_splash_sub: "Tape-reel spinner shown while the app loads.",
        opt_norm: "AUTO-GAIN", opt_norm_sub: "Evens out the volume between tracks.",
        opt_norm_level: "TARGET LEVEL", opt_norm_soft: "SOFT", opt_norm_normal: "NORMAL", opt_norm_loud: "LOUD",
        opt_gain: "OUTPUT GAIN", opt_gain_sub: "Boost or cut the volume (−6 to +6 dB). A limiter prevents distortion. Double-tap the label to reset.",
        opt_restore_sub: "All effects, theme, language and A–B loop options back to factory.",
        opt_check_update: "CHECK FOR UPDATES",
        opt_about: "DSK•LoFi — local lofi FX studio. No network, no tracking.",

        /* config backup/restore */
        cfg_title: "BACKUP & RESTORE",
        cfg_sub: "Save or load your settings, effects, folders and playlists as a file.",
        cfg_export: "EXPORT CONFIGURATION",
        cfg_import: "IMPORT CONFIGURATION",
        cfg_import_first: "Import configuration",
        cfg_exported: "Configuration exported",
        cfg_imported: "Configuration imported — restarting…",
        cfg_import_fail: "Could not import file",
        cfg_import_title: "IMPORT CONFIGURATION?",
        cfg_import_msg: "This will replace your current settings, effects, folders and playlists. The app will restart.",

        /* confirm */
        cf_restore_title: "RESTORE DEFAULTS?",
        cf_restore_msg: "Every effect, the theme, the language and the A–B loop options will return to factory values. Your loaded track is kept.",
        cancel: "CANCEL", confirm: "RESTORE", ok: "OK",
        restored: "Defaults restored",

        /* misc toasts */
        preset_applied: "Preset applied",
        section_reset: "Section reset",
        theme_changed: "Theme updated",
        lang_changed: "Language updated",

        /* artwork modal */
        aw_open: "View artwork", aw_save: "SAVE IMAGE", aw_share: "SHARE", aw_saved: "Image saved",

        /* voice removal modal */
        vox_title: "VOICE REMOVAL", vox_presets: "QUICK PRESET",
        vox_soft: "SOFT", vox_medium: "MEDIUM", vox_strong: "STRONG",
        vox_intensity: "INTENSITY", vox_low: "LOW FREQ (HP)", vox_high: "HIGH FREQ (LP)",
        vox_reset: "RESET",
        vox_advanced: "ADVANCED AI REMOVAL",
        stm_title: "AI VOICE SEPARATION", stm_model: "MODEL", stm_model_default: "Default (auto-download)", stm_tier_fast: "Fastest", stm_tier_mid: "Medium", stm_tier_yours: "Yours / others", stm_installed: "Downloaded", stm_tier_fav: "Favorites", stm_fav: "Favorite", stm_delete: "Delete", stm_deleted: "Model deleted", stm_recommended: "Recommended", stm_time_ph: "s", stm_time_hint: "Your benchmark time (seconds)", stm_swap: "Swap vocals/instrumental", stm_del_confirm: "Delete this model file?", stm_download: "Download", stm_dl_done: "Model downloaded", stm_dl_fail: "Download failed", stm_dl_busy: "A download is already running", stm_pick_model: "Download and pick a model first",
        stm_intro: "Splits the track into vocals and instrumental with an AI model. It runs once per track and is cached.",
        stm_cached: "Already separated",
        stm_save: "WHAT TO SAVE",
        stm_open: "OPEN WHEN DONE",
        stm_instrumental: "Vocals",
        stm_vocals: "Instrumental",
        stm_original: "Original",
        stm_keep: "Keep current",
        stm_run: "SEPARATE",
        stm_cancel: "CANCEL",
        stm_loadstem: "LOAD A STEM",
        stm_note: "Tip: load the instrumental for real karaoke. Your lo-fi effects still apply on top.",
        stm_done: "Separation complete", stm_done_time: "Done in",
        stm_fail: "Separation failed",
        stm_cancelled: "Cancelled",
        stm_unavailable: "Only available in the Android app",
        stm_notrack: "Load a track first",
        stm_pick_one: "Pick at least one stem to save",
        stm_warn_title: "AI voice separation",
        stm_warn_msg: "This processes the whole track with an AI model. It can take from several seconds to a few minutes and use significant CPU/RAM; the first run may download the model. The result is cached per track. Continue?",
        stm_warn_ok: "Continue",
        stm_stage_download: "Downloading model…", stm_stage_decode: "Decoding audio…",
        stm_stage_stft: "Analyzing…",
        stm_stage_infer: "Separating…",
        stm_stage_recon: "Rebuilding…",
        stm_stage_save: "Saving…", stm_stage_cancel: "Canceling…",
        stm_err_nomodel: "Model not available",
        stm_err_decode: "Could not decode the track",
        stm_err_oom: "Not enough memory for this track",

        /* ---- library: sources / tabs / explorer / lists / track menu ---- */
        src_file: "Now playing", src_files: "Selection", src_folder: "Folder", src_list: "Playlist",
        tab_now: "QUEUE", tab_explore: "FILES", tab_lists: "PLAYLISTS",
        ex_roots: "FOLDERS", ex_add_root: "ADD FOLDER", ex_remove_root: "Remove folder",
        ex_up: "Up", ex_move_up: "Move up", ex_move_down: "Move down", ex_empty: "Empty folder", ex_no_roots: "No folders yet — add one to browse.", ex_add_download: "Downloads", ex_add_music: "Music", ex_add_storage: "Storage", ex_add_fail: "Could not add folder", ex_add_this: "Add this folder",
        ex_play_folder: "Play folder", ex_root_added: "Folder added", ex_root_removed: "Folder removed",
        ex_track_one: "1 track", ex_track_n: "{n} tracks",
        ex_pending: "Needs access", ex_pending_hint: "Tap to relink this folder",
        ex_add_all: "Add all to a playlist",
        sel_select: "Select",
        ex_search: "Search files and folders…", ex_search_results: "SEARCH RESULTS", ex_search_empty: "No matches found.",
        lists_title: "PLAYLISTS", lists_new: "NEW PLAYLIST", lists_empty: "No playlists yet.",
        list_name_ph: "Playlist name", list_create: "CREATE",
        list_play: "Play", list_rename: "Rename", list_delete: "Delete",
        list_export: "EXPORT", list_import: "IMPORT", list_empty: "This playlist is empty.",
        list_del_title: "DELETE PLAYLIST?", list_del_msg: "This playlist will be removed.",
        list_created: "Playlist created", list_deleted: "Playlist deleted", list_renamed: "Playlist renamed",
        list_exported: "Playlists exported", list_imported: "Playlists imported", list_import_fail: "Could not import file",
        list_count_one: "1 track", list_count_n: "{n} tracks",
        m_title: "ACTIONS", m_play: "Play now", m_play_next: "Play next", m_play_last: "Add to end",
        m_add_list: "Add to playlist…", m_new_list: "New playlist…", m_remove: "Remove from queue",
        m_move_up: "Move up", m_move_down: "Move down",
        m_edit_tags: "Edit tags…",
        m_download: "Download",
        ab_title: "A–B REPEAT", ab_set: "SET", ab_clear: "CLEAR", ab_hint: "Tap the wave to seek · pinch to zoom · set A/B then drag them", ab_wave_na: "Waveform unavailable for streaming", ab_wave_load: "Decoding waveform…", ab_step: "Step", ab_xfade: "Loop crossfade", ab_off: "Off", ab_export: "Export loop", ab_export_btn: "EXPORT", ab_need_ab: "Set A and B first", ab_capture: "Capture", ab_react: "Reaction", ab_snap: "Snap to peak",
        tag_title: "EDIT TAGS", tag_f_title: "Title", tag_f_artist: "Artist", tag_f_album: "Album", tag_f_track: "Track",
        tag_cover_change: "Change cover", tag_cover_remove: "Remove cover", tag_no_cover: "No cover",
        tag_cover_save: "Save cover",
        tag_cover_remove_ask: "Remove the current cover? You can save it first with the download button.",
        tag_save: "SAVE", tag_saved: "Tags saved", tag_save_fail: "Could not save tags (folder may be read-only — re-add it to grant write access)",
        tag_local_only: "Tags can only be edited on local files", tag_app_only: "Editing tags is only available inside the app",
        q_save_as_list: "SAVE QUEUE AS PLAYLIST", q_added_next: "Added to play next", q_added_last: "Added to end",
        q_removed: "Removed from queue", q_added_list: "Added to playlist", q_pick_list: "CHOOSE PLAYLIST",
        q_added_list_n: "{n} tracks added to playlist",
        viz_cover: "COVER BACKDROP", help_title: "HOW TO USE", help_aria: "Help",
        imp_missing_roots: "{n} folders need access — add them in Files", lib_open: "LIBRARY",

        /* lyrics */
        copied: "Copied to clipboard",
        lyr_btn: "LYRIC", lyr_open: "Search lyrics", lyr_title: "LYRICS",
        lyr_search_ph: "Title and artist…", lyr_go: "GO",
        lyr_src_lrclib: "LRCLIB", lyr_src_genius: "Genius", lyr_src_netease: "NetEase",
        lyr_plain: "PLAIN", lyr_synced: "SYNCED",
        lyr_searching: "Searching lyrics…", lyr_notfound: "No lyrics found",
        lyr_results: "RESULTS", lyr_back: "Results",
        lyr_empty: "Type a song to search its lyrics",
        lyr_error_net: "Couldn't connect. Check your connection and try again.",
        lyr_genius_browser: "Genius is only available inside the app. Use LRCLIB here.",
        lyr_remote_browser: "This source is only available inside the app. Use LRCLIB here.",
        lyr_share: "SHARE", lyr_pdf: "PDF",
        lyr_share_ask: "What do you want to share?",
        lyr_share_sel: "Selection", lyr_share_full: "Full lyrics",
        lyr_karaoke: "Reduce vocals (karaoke)",
        lyr_shared_from: "Shared from",
        lyr_pdf_app_only: "Saving as PDF is only available inside the app",
        kar_open: "Karaoke mode", kar_need_sync: "Karaoke needs synced lyrics (LRC)",

        /* online (youtube) */
        tab_online: "ONLINE",
        on_search_ph: "Search on YouTube…", on_search: "SEARCH",
        on_searching: "Searching…", on_notfound: "No results",
        on_error: "Couldn't get the audio. Try again.",
        on_empty: "Search music to play (audio only)",
        on_browser: "Online playback only works inside the app",
        on_add_list: "Add to list",
        pl_repeat_off: "Repeat: off", pl_repeat_one: "Repeat: current track", pl_repeat_all: "Repeat: all",
        on_select: "Select",         on_add_all: "Add all to list", on_dl_all: "Download all", on_dl_all_started: "{n} downloads queued", on_playlist_loading: "Loading playlist…",
        yt_play_next: "Play next", yt_add_queue: "Add to queue", yt_add_playlist: "Add to playlist",
        yt_added_next: "Added — plays next", yt_added_queue: "Added to queue",

        /* shazam (song recognition) */
        sh_open: "Identify song",
        sh_listening: "LISTENING…",
        sh_searching: "SEARCHING…",
        sh_notfound: "NO MATCH FOUND",
        sh_retry: "TRY AGAIN",
        sh_youtube: "SEARCH ONLINE",
        sh_share: "SHARE",
        sh_share_text: "I just identified",
        sh_no_mic: "Microphone access denied or unavailable.",
        sh_no_token: "Set your AudD.io API token in Settings first.",
        sh_token_label: "AUDD.IO API TOKEN",
        sh_token_ph: "Paste your AudD token…",
        sh_token_save: "SAVE",
        sh_token_sub: "Get a free token at audd.io.",
        sh_token_link: "Get a token",
        sh_token_saved: "Token saved",
        sh_error_generic: "Recognition error. Try again.",
        on_download: "Download audio",
        on_downloading: "Downloading…",
        on_downloaded: "Saved to DSKlofi",
        on_dl_error: "Couldn't download. Try again.",
        on_encoding: "Converting to MP3…",
        on_ph_dl: "Downloading",
        on_ph_conv: "Converting",
        on_queued: "Added to download queue", on_lib_using: "Using NewPipe", on_lib_latest: "Latest online:", on_lib_update: "update available"
      }
    },

    /* ---------------------------------------------------------------- ES -- */
    es: {
      name: "Español",
      strings: {
        tagline: "Retro Player",

        load_title: "TOCA PARA CARGAR AUDIO",
        load_sub: "o suelta un archivo aquí",
        load_formats: "MP3 · WAV · OGG · OPUS · FLAC · M4A",
        load_change: "CAMBIAR PISTA",
        decoding: "REBOBINANDO LA CINTA…",
        err_decode: "No se pudo leer el archivo. Prueba MP3, WAV, OGG u OPUS.", need_all_files: "Concede \"Acceso a todos los archivos\" para reproducir las pistas importadas.",
        file_missing_skipped: "Archivo no encontrado: eliminado de la lista.",
        err_audio: "El motor de audio no arrancó. Recarga e inténtalo de nuevo.",

        play: "Reproducir", pause: "Pausa", stop: "Detener",
        loop: "Bucle",
        mode_aria: "Motor LoFi / solo reproductor",
        rnd: "FX aleatorios",
        prev: "Anterior", next: "Siguiente", stop: "Detener", shuffle: "Aleatorio", timer: "Temporizador", open_audio: "Abrir audio",
        load_dir: "CARGAR CARPETA",
        playlist: "LISTA", pl_search: "Buscar…", pl_no_results: "Sin coincidencias", sp_title: "VELOCIDAD", sp_manual: "MANUAL", viz_pick: "VISUALIZADOR", viz_ok: "LISTO",
        tm_title: "TEMPORIZADOR",
        tm_custom: "PERSONALIZADO (MIN)", tm_set: "FIJAR", tm_cancel: "CANCELAR TEMPORIZADOR",
        tm_hint: "Baja el volumen suavemente los últimos segundos y luego pausa.",
        tm_on: "Temporizador activo", tm_off: "Temporizador cancelado", tm_done: "Temporizador finalizado", tm_endtrack: "AL ACABAR LA PISTA", tm_endtrack_on: "Se detendrá al acabar la pista",
        gp_title: "PRESET", gp_select: "— Elegir preset —", gp_manage: "GESTIONAR PRESETS",
        gp_save_as: "GUARDAR ACTUAL COMO", gp_save: "GUARDAR", gp_name_ph: "Nombre de mi preset",
        gp_export: "EXPORTAR", gp_import: "IMPORTAR",
        gp_saved: "Preset guardado", gp_deleted: "Preset eliminado", gp_applied: "Preset aplicado",
        gp_exported: "Presets exportados", gp_imported: "Presets importados", gp_import_fail: "No se pudo importar el archivo",
        gp_empty: "Aún no hay presets guardados", gp_factory: "Predefinido", gp_user: "Tuyos",
        gp_del_title: "¿ELIMINAR PRESET?", gp_del_msg: "Este preset de usuario se eliminará.",
        randomized: "FX aleatorios — volumen intacto",
        no_file: "SIN CINTA CARGADA",

        sec_lofi: "MOTOR LOFI",
        sec_reverb: "REVERB",
        sec_delay: "DELAY",
        sec_chorus: "CHORUS",
        sec_space: "ESPACIO",
        sec_output: "SALIDA",
        sec_export: "EXPORTAR",
        presets: "PRESETS",
        reset_section: "Restaurar sección",
        fx_on: "ON", fx_off: "OFF",

        p_tone: "TONO", p_crush: "CRUSH", p_hiss: "SISEO DE CINTA",
        p_crackle: "CRUJIDO VINILO", p_wow: "WOW / FLUTTER",
        p_rv_mix: "MEZCLA", p_rv_size: "TAMAÑO", p_rv_damp: "AMORTIGUACIÓN",
        p_dl_time: "TIEMPO", p_dl_fb: "REALIMENT.", p_dl_mix: "MEZCLA",
        p_ch_rate: "VELOCIDAD", p_ch_depth: "PROFUNDIDAD", p_ch_mix: "MEZCLA",
        p_sp_width: "ANCHURA", p_sp_amount: "INTENSIDAD",
        p_volume: "VOLUMEN", p_gain: "GANANCIA",

        pr_custom: "CUSTOM",
        pr_lofi_vinyl: "VINILO", pr_lofi_tape: "CINTA", pr_lofi_radio: "RADIO",
        pr_lofi_dream: "SUEÑO", pr_lofi_clean: "SUTIL",
        pr_rv_room: "SALA", pr_rv_hall: "HALL", pr_rv_cave: "CUEVA",
        pr_dl_slap: "SLAP", pr_dl_echo: "ECO", pr_dl_dub: "DUB",
        pr_ch_soft: "SUAVE", pr_ch_wide: "AMPLIO", pr_ch_wobble: "WOBBLE",
        pr_sp_subtle: "SUTIL", pr_sp_wide: "AMPLIO", pr_sp_huge: "ENORME",

        ex_format: "FORMATO",
        ex_name: "NOMBRE DE ARCHIVO",
        ex_render: "RENDERIZAR Y GUARDAR",
        ex_rendering: "RENDERIZANDO…",
        ex_encoding: "CODIFICANDO…",
        ex_done_bridge: "Guardado en /DSKlofi",
        ex_done_web: "Descarga iniciada",
        ex_fail: "Falló la exportación. Inténtalo de nuevo.",
        ex_cancel: "CANCELAR", ex_cancel_sure: "PULSA OTRA VEZ PARA CANCELAR", ex_cancelling: "CANCELANDO…",
        ex_cancel_title: "¿Cancelar exportación?",
        ex_cancel_confirm: "Se descartará la exportación en curso.",
        ex_cancelled: "Exportación cancelada",
        ex_hint_bridge: "Los archivos se guardan en la carpeta /DSKlofi.",
        ex_hint_web: "Modo navegador: el archivo se descarga al dispositivo. En la app Android se guarda en /DSKlofi.",
        ex_mp3_missing: "Codificador MP3 no instalado — mira el README. Se exporta WAV.",

        opt_title: "OPCIONES",
        opt_lang: "IDIOMA",
        opt_theme: "TEMA",
        theme_dark: "OSCURO", theme_light: "CLARO",
        opt_restore: "RESTAURAR VALORES", opt_playeronly: "MODO REPRODUCTOR", opt_playeronly_sub: "Reproducción instantánea, sin efectos. Oculta FX y exportar.",
        opt_splash: "PANTALLA DE CARGA", opt_splash_sub: "Spinner de bobina de cinta mientras carga la app.",
        opt_norm: "AUTO-GANANCIA", opt_norm_sub: "Iguala el volumen entre pistas.",
        opt_norm_level: "NIVEL OBJETIVO", opt_norm_soft: "SUAVE", opt_norm_normal: "NORMAL", opt_norm_loud: "ALTO",
        opt_gain: "GANANCIA DE SALIDA", opt_gain_sub: "Sube o baja el volumen (−6 a +6 dB). Lleva un limitador que evita la distorsión. Doble toque en el título para restablecer.",
        opt_restore_sub: "Efectos, tema, idioma y opciones del loop A–B vuelven a fábrica.",
        opt_check_update: "BUSCAR ACTUALIZACIONES",
        opt_about: "DSK•LoFi — estudio de FX lofi local. Sin red, sin rastreo.",

        /* copia de seguridad / restauración de configuración */
        cfg_title: "COPIA DE SEGURIDAD",
        cfg_sub: "Guarda o carga tus ajustes, efectos, carpetas y listas en un archivo.",
        cfg_export: "EXPORTAR CONFIGURACIÓN",
        cfg_import: "IMPORTAR CONFIGURACIÓN",
        cfg_import_first: "Importar configuración",
        cfg_exported: "Configuración exportada",
        cfg_imported: "Configuración importada — reiniciando…",
        cfg_import_fail: "No se pudo importar el archivo",
        cfg_import_title: "¿IMPORTAR CONFIGURACIÓN?",
        cfg_import_msg: "Esto sustituirá tus ajustes, efectos, carpetas y listas actuales. La app se reiniciará.",

        cf_restore_title: "¿RESTAURAR VALORES?",
        cf_restore_msg: "Todos los efectos, el tema, el idioma y las opciones del loop A–B volverán a los valores de fábrica. Tu pista cargada se mantiene.",
        cancel: "CANCELAR", confirm: "RESTAURAR", ok: "OK",
        restored: "Valores restaurados",

        preset_applied: "Preset aplicado",
        section_reset: "Sección restaurada",
        theme_changed: "Tema actualizado",
        lang_changed: "Idioma actualizado",

        /* artwork modal */
        aw_open: "Ver carátula", aw_save: "GUARDAR IMAGEN", aw_share: "COMPARTIR", aw_saved: "Imagen guardada",

        /* voice removal modal */
        vox_title: "SUPRESIÓN DE VOZ", vox_presets: "AJUSTE RÁPIDO",
        vox_soft: "SUAVE", vox_medium: "MEDIO", vox_strong: "FUERTE",
        vox_intensity: "INTENSIDAD", vox_low: "FREC. GRAVE (HP)", vox_high: "FREC. AGUDA (LP)",
        vox_reset: "RESTABLECER",
        vox_advanced: "SUPRESIÓN AVANZADA (IA)",
        stm_title: "SEPARACIÓN DE VOZ (IA)", stm_model: "MODELO", stm_model_default: "Por defecto (se descarga)", stm_tier_fast: "Más rápidos", stm_tier_mid: "Medios", stm_tier_yours: "Tuyos / otros", stm_installed: "Descargado", stm_tier_fav: "Favoritos", stm_fav: "Favorito", stm_delete: "Eliminar", stm_deleted: "Modelo eliminado", stm_recommended: "Recomendado", stm_time_ph: "s", stm_time_hint: "Tu tiempo de prueba (segundos)", stm_swap: "Invertir voz/instrumental", stm_del_confirm: "¿Eliminar este archivo de modelo?", stm_download: "Descargar", stm_dl_done: "Modelo descargado", stm_dl_fail: "Fallo al descargar", stm_dl_busy: "Ya hay una descarga en curso", stm_pick_model: "Descarga y elige un modelo primero",
        stm_intro: "Separa la pista en voz e instrumental con un modelo de IA. Se procesa una vez por pista y se guarda en caché.",
        stm_cached: "Ya separada",
        stm_save: "QUÉ GUARDAR",
        stm_open: "ABRIR AL TERMINAR",
        stm_instrumental: "Voz",
        stm_vocals: "Instrumental",
        stm_original: "Original",
        stm_keep: "No cambiar",
        stm_run: "SEPARAR",
        stm_cancel: "CANCELAR",
        stm_loadstem: "CARGAR UN STEM",
        stm_note: "Consejo: carga el instrumental para un karaoke de verdad. Tus efectos lofi se siguen aplicando encima.",
        stm_done: "Separación completada", stm_done_time: "Hecho en",
        stm_fail: "Falló la separación",
        stm_cancelled: "Cancelado",
        stm_unavailable: "Solo disponible en la app de Android",
        stm_notrack: "Carga antes una pista",
        stm_pick_one: "Elige al menos un stem para guardar",
        stm_warn_title: "Separación de voz (IA)",
        stm_warn_msg: "Esto procesa la pista completa con un modelo de IA. Puede tardar desde unos segundos a varios minutos y usar bastante CPU/RAM; la primera vez puede descargar el modelo. El resultado se guarda en caché por pista. ¿Continuar?",
        stm_warn_ok: "Continuar",
        stm_stage_download: "Descargando modelo…", stm_stage_decode: "Decodificando audio…",
        stm_stage_stft: "Analizando…",
        stm_stage_infer: "Separando…",
        stm_stage_recon: "Reconstruyendo…",
        stm_stage_save: "Guardando…", stm_stage_cancel: "Cancelando…",
        stm_err_nomodel: "Modelo no disponible",
        stm_err_decode: "No se pudo decodificar la pista",
        stm_err_oom: "Memoria insuficiente para esta pista",

        /* ---- biblioteca: fuentes / pestañas / explorador / listas / menú ---- */
        src_file: "En curso", src_files: "Selección", src_folder: "Carpeta", src_list: "Lista",
        tab_now: "EN CURSO", tab_explore: "ARCHIVOS", tab_lists: "LISTAS",
        ex_roots: "CARPETAS", ex_add_root: "AÑADIR CARPETA", ex_remove_root: "Quitar carpeta",
        ex_up: "Subir", ex_move_up: "Subir", ex_move_down: "Bajar", ex_empty: "Carpeta vacía", ex_no_roots: "Aún no hay carpetas — añade una para explorar.", ex_add_download: "Descargas", ex_add_music: "Música", ex_add_storage: "Almacenamiento", ex_add_fail: "No se pudo añadir la carpeta", ex_add_this: "Añadir esta carpeta",
        ex_play_folder: "Reproducir carpeta", ex_root_added: "Carpeta añadida", ex_root_removed: "Carpeta quitada",
        ex_track_one: "1 pista", ex_track_n: "{n} pistas",
        ex_pending: "Sin permiso", ex_pending_hint: "Toca para volver a vincular esta carpeta",
        ex_add_all: "Añadir todo a una lista",
        sel_select: "Seleccionar",
        ex_search: "Buscar archivos y carpetas…", ex_search_results: "RESULTADOS DE BÚSQUEDA", ex_search_empty: "Sin resultados.",
        lists_title: "LISTAS", lists_new: "NUEVA LISTA", lists_empty: "Aún no hay listas.",
        list_name_ph: "Nombre de la lista", list_create: "CREAR",
        list_play: "Reproducir", list_rename: "Renombrar", list_delete: "Eliminar",
        list_export: "EXPORTAR", list_import: "IMPORTAR", list_empty: "Esta lista está vacía.",
        list_del_title: "¿ELIMINAR LISTA?", list_del_msg: "Esta lista se eliminará.",
        list_created: "Lista creada", list_deleted: "Lista eliminada", list_renamed: "Lista renombrada",
        list_exported: "Listas exportadas", list_imported: "Listas importadas", list_import_fail: "No se pudo importar el archivo",
        list_count_one: "1 pista", list_count_n: "{n} pistas",
        m_title: "ACCIONES", m_play: "Reproducir ahora", m_play_next: "Reproducir siguiente", m_play_last: "Añadir al final",
        m_add_list: "Añadir a lista…", m_new_list: "Nueva lista…", m_remove: "Quitar de la cola",
        m_move_up: "Mover arriba", m_move_down: "Mover abajo",
        m_edit_tags: "Editar etiquetas…",
        m_download: "Descargar",
        ab_title: "REPETIR A–B", ab_set: "FIJAR", ab_clear: "LIMPIAR", ab_hint: "Toca la onda para ir a un punto · pellizca para zoom · fija A/B y arrástralos", ab_wave_na: "Onda no disponible en streaming", ab_wave_load: "Decodificando onda…", ab_step: "Paso", ab_xfade: "Crossfade del loop", ab_off: "Off", ab_export: "Exportar loop", ab_export_btn: "EXPORTAR", ab_need_ab: "Fija antes A y B", ab_capture: "Captura", ab_react: "Reacción", ab_snap: "Ajustar al pico",
        tag_title: "EDITAR ETIQUETAS", tag_f_title: "Título", tag_f_artist: "Artista", tag_f_album: "Álbum", tag_f_track: "Pista",
        tag_cover_change: "Cambiar carátula", tag_cover_remove: "Quitar carátula", tag_no_cover: "Sin carátula",
        tag_cover_save: "Guardar carátula",
        tag_cover_remove_ask: "¿Quitar la carátula actual? Puedes guardarla antes con el botón de descarga.",
        tag_save: "GUARDAR", tag_saved: "Etiquetas guardadas", tag_save_fail: "No se pudieron guardar (la carpeta puede ser de solo lectura — re-vincúlala para dar permiso de escritura)",
        tag_local_only: "Las etiquetas solo se editan en archivos locales", tag_app_only: "Editar etiquetas solo está disponible dentro de la app",
        q_save_as_list: "GUARDAR COLA COMO LISTA", q_added_next: "Se reproducirá a continuación", q_added_last: "Añadido al final",
        q_removed: "Quitado de la cola", q_added_list: "Añadido a la lista", q_pick_list: "ELEGIR LISTA",
        q_added_list_n: "{n} pistas añadidas a la lista",
        viz_cover: "CARÁTULA DE FONDO", help_title: "CÓMO SE USA", help_aria: "Ayuda",
        imp_missing_roots: "{n} carpetas necesitan permiso — añádelas en Archivos", lib_open: "BIBLIOTECA",

        /* lyrics */
        copied: "Copiado al portapapeles",
        lyr_btn: "LETRA", lyr_open: "Buscar letra", lyr_title: "LETRAS",
        lyr_search_ph: "Título y artista…", lyr_go: "IR",
        lyr_src_lrclib: "LRCLIB", lyr_src_genius: "Genius", lyr_src_netease: "NetEase",
        lyr_plain: "PLANA", lyr_synced: "SINCRO",
        lyr_searching: "Buscando letra…", lyr_notfound: "No se encontró la letra",
        lyr_results: "RESULTADOS", lyr_back: "Resultados",
        lyr_empty: "Escribe una canción para buscar su letra",
        lyr_error_net: "No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.",
        lyr_genius_browser: "Genius solo está disponible dentro de la app. Aquí usa LRCLIB.",
        lyr_remote_browser: "Esta fuente solo está disponible dentro de la app. Aquí usa LRCLIB.",
        lyr_share: "COMPARTIR", lyr_pdf: "PDF",
        lyr_share_ask: "¿Qué quieres compartir?",
        lyr_share_sel: "Selección", lyr_share_full: "Letra entera",
        lyr_karaoke: "Reducir voz (karaoke)",
        lyr_shared_from: "Compartido desde",
        lyr_pdf_app_only: "Guardar como PDF solo está disponible dentro de la app",
        kar_open: "Modo karaoke", kar_need_sync: "El karaoke necesita letra sincronizada (LRC)",

        /* online (youtube) */
        tab_online: "ONLINE",
        on_search_ph: "Buscar en YouTube…", on_search: "BUSCAR",
        on_searching: "Buscando…", on_notfound: "Sin resultados",
        on_error: "No se pudo obtener el audio. Inténtalo de nuevo.",
        on_empty: "Busca música para reproducir (solo audio)",
        on_browser: "La reproducción online solo funciona dentro de la app",
        on_add_list: "Añadir a lista",
        pl_repeat_off: "Repetición: desactivada", pl_repeat_one: "Repetir: pista actual", pl_repeat_all: "Repetir: todo",
        on_select: "Seleccionar",         on_add_all: "Añadir todo a lista", on_dl_all: "Descargar todo", on_dl_all_started: "{n} descargas en cola", on_playlist_loading: "Cargando lista…",
        yt_play_next: "Reproducir a continuación", yt_add_queue: "Añadir a la cola", yt_add_playlist: "Añadir a lista",
        yt_added_next: "Añadida — sonará después", yt_added_queue: "Añadida a la cola",
        on_download: "Descargar audio",
        on_downloading: "Descargando…",
        on_downloaded: "Guardado en DSKlofi",
        on_dl_error: "No se pudo descargar. Inténtalo de nuevo.",

        /* shazam (reconocimiento de canciones) */
        sh_open: "Identificar canción",
        sh_listening: "ESCUCHANDO…",
        sh_searching: "BUSCANDO…",
        sh_notfound: "SIN COINCIDENCIAS",
        sh_retry: "REINTENTAR",
        sh_youtube: "BUSCAR ONLINE",
        sh_share: "COMPARTIR",
        sh_share_text: "Acabo de identificar",
        sh_no_mic: "Acceso al micrófono denegado o no disponible.",
        sh_no_token: "Configura tu token de AudD.io en Ajustes primero.",
        sh_token_label: "TOKEN API DE AUDD.IO",
        sh_token_ph: "Pega tu token de AudD…",
        sh_token_save: "GUARDAR",
        sh_token_sub: "Consigue un token gratis en audd.io.",
        sh_token_link: "Solicitar token",
        sh_token_saved: "Token guardado",
        sh_error_generic: "Error de reconocimiento. Inténtalo de nuevo.",

        on_encoding: "Convirtiendo a MP3…",
        on_ph_dl: "Descargando",
        on_ph_conv: "Convirtiendo",
        on_queued: "Añadido a la cola de descargas", on_lib_using: "Usando NewPipe", on_lib_latest: "Última online:", on_lib_update: "hay actualización"
      }
    }
  };

  const FALLBACK = "en";
  let current = FALLBACK;

  function detect() {
    const saved = localStorage.getItem("dsklofi.lang");
    if (saved && LANGS[saved]) return saved;
    const nav = (navigator.language || "").toLowerCase();
    for (const code of Object.keys(LANGS)) {
      if (nav === code || nav.startsWith(code + "-")) return code;
    }
    return FALLBACK;
  }

  function t(key) {
    const cur = LANGS[current] && LANGS[current].strings[key];
    if (cur !== undefined) return cur;
    const fb = LANGS[FALLBACK].strings[key];
    return fb !== undefined ? fb : key;
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    scope.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });
    scope.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
    });
    document.documentElement.lang = current;
  }

  function set(code, persist) {
    if (!LANGS[code]) code = FALLBACK;
    current = code;
    if (persist !== false) localStorage.setItem("dsklofi.lang", code);
    apply();
    document.dispatchEvent(new CustomEvent("dsk:lang", { detail: { lang: code } }));
  }

  window.I18n = {
    t, set, apply, detect,
    get lang() { return current; },
    get available() {
      return Object.keys(LANGS).map((c) => ({ code: c, name: LANGS[c].name }));
    },
    init() { current = detect(); apply(); document.documentElement.lang = current; }
  };
})();