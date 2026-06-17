/* =============================================================================
   DSK•LoFi — library.js
   Pestañas dentro de #plFs (En curso · Archivos · Listas), explorador SAF
   navegable, CRUD de listas, menú de acciones (⋮), restauración de cola por
   URI y botón atrás jerárquico. Depende de: window.DSKQueue (app.js),
   window.DSKBridge (Android), window.I18n, window.UI.
   ========================================================================== */
(function () {
  "use strict";
  if (!window.UI) return;
  const $ = UI.$, $$ = UI.$$;
  const T = (k) => (window.I18n ? I18n.t(k) : k);
  const hasBridge = (m) => typeof window.DSKBridge !== "undefined" && typeof window.DSKBridge[m] === "function";

  const LISTS_KEY = "dsklofi.playlists";
  const QUEUE_KEY = "dsklofi.queue";

  /* ----------------------------------------------------------- almacenamiento */
  function loadLists() {
    try { const r = localStorage.getItem(LISTS_KEY); const a = r ? JSON.parse(r) : []; return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function saveLists(lists) {
    try { localStorage.setItem(LISTS_KEY, JSON.stringify(lists)); } catch (e) {}
  }
  function newId() { return "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function findList(id) { return loadLists().find((l) => l.id === id) || null; }
  function countLabel(n) { return n === 1 ? T("list_count_one") : T("list_count_n").replace("{n}", n); }

  /* ----------------------------------------------------------- iconos svg */
  const IC = {
    folder: '<svg class="ic" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>',
    audio: '<svg class="ic" viewBox="0 0 24 24"><path d="M9 18V5l10-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="16" cy="16" r="3"></circle></svg>',
    list: '<svg class="ic" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>',
    play: '<svg class="ic" viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20"></polygon></svg>',
    dots: '<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="12" cy="19" r="1.6"></circle></svg>',
    up: '<svg class="ic" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"></path></svg>',
    relink: '<svg class="ic" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 3v6h-6"></path></svg>',
    check: '<svg class="ic" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"></path></svg>'
  };
  const stripExt = (s) => (s || "").replace(/\.[^.]+$/, "");

  /* -------- estadísticas de carpeta (nº de pistas + duración total) --------
     El conteo es barato; la duración exige leer metadatos de cada audio (coste
     real). Para no malgastar recursos: se guardan {count,dur} por URI en
     IndexedDB y, al volver a entrar, el nativo SOLO recalcula la duración si el
     número de archivos cambió. Si el conteo es igual, se reutiliza lo guardado. */
  const folderStatsCache = {};          // memoria de sesión
  const folderStatsPending = {};
  let statsSeq = 0;

  // --- IndexedDB mínima (persiste entre sesiones) ---
  const STATS_STORE = "folderStats";
  let _statsDbPromise = null;
  function statsDB() {
    if (_statsDbPromise) return _statsDbPromise;
    _statsDbPromise = new Promise((res) => {
      try {
        if (typeof indexedDB === "undefined") return res(null);
        const r = indexedDB.open("dsklofi", 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains(STATS_STORE)) db.createObjectStore(STATS_STORE);
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
      } catch (e) { res(null); }
    });
    return _statsDbPromise;
  }
  function idbGet(key) {
    return statsDB().then((db) => new Promise((res) => {
      if (!db) return res(null);
      try {
        const rq = db.transaction(STATS_STORE, "readonly").objectStore(STATS_STORE).get(key);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => res(null);
      } catch (e) { res(null); }
    }));
  }
  function idbSet(key, val) {
    return statsDB().then((db) => new Promise((res) => {
      if (!db) return res(false);
      try {
        const tx = db.transaction(STATS_STORE, "readwrite");
        tx.objectStore(STATS_STORE).put(val, key);
        tx.oncomplete = () => res(true);
        tx.onerror = () => res(false);
      } catch (e) { res(false); }
    }));
  }

  function fmtDurShort(sec) {
    sec = Math.round(sec || 0); if (sec <= 0) return "";
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    return m + ":" + String(s).padStart(2, "0");
  }
  function statsLabel(st) {
    if (!st || !st.count) return "";
    const n = st.count === 1 ? T("ex_track_one") : T("ex_track_n").replace("{n}", st.count);
    const d = st.dur > 0 ? "  ·  " + fmtDurShort(st.dur) : "";
    return n + d;
  }
  function installFolderStatsCb() {
    if (typeof window.DSKBridge === "undefined" || window.DSKBridge.__folderStats) return;
    window.DSKBridge.__folderStats = function (reqId, json) {
      const p = folderStatsPending[reqId]; if (!p) return; delete folderStatsPending[reqId];
      let st = null; try { st = JSON.parse(json); } catch (e) {}
      if (!st) { if (!p.stored) { try { p.cb(null); } catch (e) {} } return; }
      // dur < 0 → el nativo indica "conteo sin cambios": reusar la guardada
      if (st.dur < 0) st = { count: st.count, dur: p.stored ? p.stored.dur : 0 };
      folderStatsCache[p.uri] = st;
      idbSet(p.uri, st);
      try { p.cb(st); } catch (e) {}
    };
  }
  async function fetchFolderStats(uri, cb) {
    if (folderStatsCache[uri]) { cb(folderStatsCache[uri]); return; }   // ya verificado esta sesión
    if (!hasBridge("folderStats")) { cb(null); return; }
    installFolderStatsCb();
    const stored = await idbGet(uri);          // {count,dur} guardado o null
    if (stored) cb(stored);                    // pintado optimista inmediato
    const reqId = "fs" + (++statsSeq) + "_" + Date.now();
    folderStatsPending[reqId] = { uri: uri, cb: cb, stored: stored };
    try { window.DSKBridge.folderStats(uri, stored ? stored.count : -1, reqId); }
    catch (e) { delete folderStatsPending[reqId]; if (!stored) cb(null); }
  }

  /* -------- estadísticas de LISTA (nº de pistas + duración total) --------
     Misma idea que en carpetas: se guardan {count,dur} por id de lista en
     IndexedDB y NO se recalcula la duración si el nº de elementos no cambia.
     La duración suma metadatos de los items locales (con URI); los items solo
     de YouTube sin descargar no aportan duración. */
  function listLabel(st) {
    if (!st) return "";
    const base = countLabel(st.count);
    const d = st.dur > 0 ? "  ·  " + fmtDurShort(st.dur) : "";
    return base + d;
  }
  function installListStatsCb() {
    if (typeof window.DSKBridge === "undefined" || window.DSKBridge.__urisDuration) return;
    window.DSKBridge.__urisDuration = function (reqId, durSec) {
      const p = folderStatsPending[reqId]; if (!p) return; delete folderStatsPending[reqId];
      const st = { count: p.count, dur: (typeof durSec === "number" ? durSec : parseFloat(durSec) || 0) };
      folderStatsCache[p.uri] = st; idbSet(p.uri, st);
      try { p.cb(st); } catch (e) {}
    };
  }
  async function fetchListStats(l, cb) {
    const key = "list:" + l.id;
    const count = l.items.length;
    if (folderStatsCache[key] && folderStatsCache[key].count === count) { cb(folderStatsCache[key]); return; }
    const stored = await idbGet(key);
    if (stored && stored.count === count) {           // mismo nº de elementos → reutilizar (no recalcular)
      folderStatsCache[key] = stored; cb(stored); return;
    }
    if (stored) cb(stored);                            // optimista mientras recalcula
    const localUris = l.items.filter((it) => it.uri).map((it) => it.uri);
    if (!hasBridge("urisDuration") || !localUris.length) {
      const st = { count: count, dur: 0 };
      folderStatsCache[key] = st; idbSet(key, st); cb(st); return;
    }
    installListStatsCb();
    const reqId = "ls" + (++statsSeq) + "_" + Date.now();
    folderStatsPending[reqId] = { uri: key, cb: cb, stored: stored, count: count };
    try { window.DSKBridge.urisDuration(JSON.stringify(localUris), reqId); }
    catch (e) { delete folderStatsPending[reqId]; const st = { count: count, dur: 0 }; idbSet(key, st); cb(st); }
  }

  /* ============================ AYUDA (bilingüe) ============================ */
  const HELP = {
    es:
      '<h4>Cargar música</h4>' +
      '<p>Toca la pantalla de inicio para abrir un <b>archivo</b> (se carga también el resto de su carpeta), o pulsa <b>Cargar carpeta</b> para elegir una carpeta entera.</p>' +
      '<h4>Reproducción</h4>' +
      '<p>Play/pausa, anterior/siguiente, <b>aleatorio</b> y velocidad. Toca el título de la lista para abrir la vista a pantalla completa.</p>' +
      '<h4>Repetir, avance rápido y A–B</h4>' +
      '<p>En la cabecera de la minilista, el botón de <b>repetición</b> cicla entre <b>desactivado</b>, <b>repetir actual</b> (un "1") y <b>repetir todo</b>. <b>Manteniendo pulsados</b> los botones ◀/▶ retrocedes o avanzas dentro de la pista (tipo &lt;&lt;/&gt;&gt;, con aceleración); un toque corto cambia de pista. Y <b>manteniendo pulsado Play/Pausa</b> se abre <b>Repetir A–B</b>: marca <b>A</b> y <b>B</b> (botones FIJAR), ajústalos al detalle con −/+ y la app repetirá ese tramo en bucle. Sobre la <b>forma de onda</b> (disponible en ambos modos; en modo reproductor se decodifica al abrir): <b>toca</b> para mover la reproducción a ese punto, <b>pellizca con dos dedos</b> para hacer zoom y, una vez fijados A/B con FIJAR, <b>arrástralos con el dedo</b>. El paso de −/+ se elige entre <b>0,01 / 0,1 / 0,5 s</b>. Puedes ajustar el <b>crossfade del salto del loop</b> (Off/25/50/100 ms) para suavizar los clicks, y <b>exportar el loop</b> repetido <b>2/4/8×</b> o un número propio: en modo completo se exporta <b>con los efectos aplicados</b> y en modo reproductor sin efectos. Para fijar mejor en directo: <b>Reacción</b> (0/80/150/250 ms) resta tu tiempo de reacción + la latencia de audio, dejando A y B un poco <b>antes</b> de tu toque (marcas lo que acabas de oír); <b>Ajustar al pico</b> imanta el punto al golpe de sonido cercano solo si destaca con claridad. Bajo la onda tienes controles tipo DJ: <b>◀ / ▶</b> mueven la selección entera (misma duración) por la pista para navegar entre compases, y <b>½ / ×2</b> reducen o amplían la duración del loop a la mitad o al doble (chops); funcionan en directo. Puedes abrir el loop con el botón <b>A/B</b> (junto a la velocidad) o manteniendo Play. En la onda: un dedo <b>arrastra</b> el punto si tocas cerca de A/B o <b>panea</b> si tocas lejos, <b>pellizca</b> para zoom y <b>doble toque</b> restaura el zoom al 100%. <b>LIMPIAR</b> lo desactiva (también se borra al cambiar de pista).</p>' +
      '<h4>Lista, Archivos y Listas</h4>' +
      '<p>En esa vista hay tres pestañas: <b>En curso</b> (la cola actual), <b>Archivos</b> (explorador de carpetas) y <b>Listas</b> (crea y edita tus listas). El botón <b>⋮</b> de cada pista permite reproducir ahora, en siguiente, al final, añadir a una lista o <b>editar etiquetas</b>; en pistas de YouTube también <b>Descargar</b>. La app <b>recuerda</b> la última pestaña, carpeta o lista que tenías abierta.</p>' +
      '<h4>Añadir todo y selección múltiple</h4>' +
      '<p>Dentro de una carpeta, el botón <b>añadir todo</b> mete todas sus pistas en una lista de una vez. La selección múltiple se activa con el botón <b>seleccionar</b> (✓) o <b>manteniendo pulsada</b> una pista (en Archivos, en el detalle de una lista y en Online). Marca varias pistas y usa la barra inferior para reproducir <b>siguiente</b>, <b>al final</b>, <b>añadir a lista</b>, <b>reproducir</b>/<b>descargar</b> (en Online) o <b>eliminar</b> (en listas). Al cambiar de pestaña o salir, la selección se desactiva sola.</p>' +
      '<h4>Pistas y duración</h4>' +
      '<p>En <b>Archivos</b>, cada carpeta muestra su <b>nº de pistas</b> y la <b>duración total</b>; las <b>Listas</b> muestran lo mismo. El dato se guarda y solo se <b>recalcula la duración cuando cambia el número de elementos</b>, para no gastar recursos en balde.</p>' +
      '<h4>Carpetas y permisos</h4>' +
      '<p>Si al importar la configuración una carpeta queda <b>sin permiso</b>, aparece marcada en Archivos: tócala para volver a vincularla sin perder tus listas.</p>' +
      '<h4>Efectos LoFi</h4>' +
      '<p>Motor lofi, reverb, delay, chorus y <b>realce espacial</b> (anchura estéreo), cada uno con presets y activable de forma independiente. Doble toque en el nombre de un control lo restablece. Usa <b>Presets</b> para guardar tus combinaciones.</p>' +
      '<h4>Realce espacial y ganancia</h4>' +
      '<p>El efecto <b>Espacio</b> ensancha la imagen estéreo (parámetros <i>Anchura</i> e <i>Intensidad</i>); está desactivado por defecto. En <b>Opciones</b> tienes un control de <b>Ganancia de salida</b> (de −6 a +6 dB, centro 0 = sin cambio) para subir o bajar un poco el volumen; lleva un limitador que evita la distorsión al subirla.</p>' +
      '<h4>Visualizador</h4>' +
      '<p>Pulsa el ojo para elegir entre varios visualizadores y activar la <b>carátula de fondo</b> difuminada.</p>' +
      '<h4>Carátula a pantalla completa</h4>' +
      '<p>El icono de <b>imagen</b> (abajo a la izquierda del visualizador) abre la carátula a pantalla completa —la del archivo (ID3) o la miniatura de YouTube— con opciones de <b>guardar</b> en el dispositivo y <b>compartir</b>.</p>' +
      '<h4>Editar etiquetas (ID3)</h4>' +
      '<p>En el menú <b>⋮</b> de una pista local elige <b>Editar etiquetas</b> para cambiar <b>título, artista, álbum, nº de pista</b> y <b>carátula</b>. Puedes <b>guardar/descargar</b> la carátula actual (botón sobre la imagen) antes de sustituirla, y al <b>quitarla</b> se pide confirmación. Necesita permiso de <b>escritura</b> en la carpeta: las añadidas recientemente ya lo tienen; las antiguas hay que <b>re-vincularlas</b>.</p>' +
      '<h4>Letras y karaoke</h4>' +
      '<p>Pulsa <b>LETRA</b> (arriba a la izquierda del visualizador) para buscar la letra. Elige la fuente entre <b>LRCLIB</b>, <b>Genius</b> y <b>NetEase</b> y, si hay versión sincronizada, cambia entre <b>PLANA</b> y <b>SINCRO</b>. La barra inferior de iconos es: <b>reproducir/pausa</b>, <b>quitar voz</b> (atenúa la voz centrada), <b>modo karaoke</b> (icono de maximizar), <b>compartir</b> y <b>PDF</b>. El <b>modo karaoke</b> abre la letra sincronizada a pantalla completa resaltando la frase/palabra que suena; se cierra con la <b>X</b> o con el botón <b>Atrás</b>. Mientras no cambies de canción, al reabrir LETRA se muestra la que ya tenías elegida sin volver a buscar. Tocar el título entre las bobinas lo copia al portapapeles.</p>' +
      '<h4>Online (YouTube)</h4>' +
      '<p>En la pestaña <b>Online</b> buscas música en YouTube y la reproduces <b>solo audio</b>, la añades a listas o la descargas. Si pegas un <b>enlace de vídeo</b> abre ese resultado directamente; si pegas el enlace de una <b>lista de reproducción</b> carga todos sus vídeos en los resultados. Con la barra inferior puedes <b>añadir todo</b> a una lista o <b>descargar todo</b> (en lote), y con la <b>selección múltiple</b> (pulsación larga o botón Seleccionar) reproducir, añadir o descargar solo los marcados. Las descargas guardan también la <b>carátula</b> (miniatura del vídeo).</p>' +
      '<h4>Supresión de voz (karaoke)</h4>' +
      '<p>En el modo reproductor aparece un botón de <b>micrófono</b> que atenúa la voz centrada de la canción. Un <b>toque</b> la activa/desactiva; <b>mantén pulsado</b> para abrir los ajustes: <b>intensidad</b>, rango de <b>frecuencias</b> (grave/agudo de la voz) y presets rápidos (suave/medio/fuerte). Es aproximado: funciona mejor en pistas en estéreo.</p>' +
      '<p>Dentro de esos ajustes, <b>Supresión avanzada (IA)</b> abre la separación real de stems: al pulsar avisa de que procesará la pista (tarda y consume CPU/RAM) y, al aceptar, abre un modal donde eliges <b>qué guardar</b> (instrumental, voz o ambos) y <b>qué abrir al terminar</b>. El proceso es offline y se <b>cachea</b> por pista; luego puedes <b>cargar el instrumental</b> (karaoke de verdad) o la <b>voz</b>, y tus efectos lofi se siguen aplicando encima. Requiere la app de Android con el modelo instalado.</p>' +
      '<h4>Exportar</h4>' +
      '<p>Renderiza la pista con los efectos aplicados a WAV o MP3. El MP3 incluye la <b>carátula</b> (la del archivo original o la miniatura de YouTube) y el título/artista. En la app se guarda en la carpeta <b>/DSKlofi</b>.</p>' +
      '<h4>Identificar canción</h4>' +
      '<p>Pulsa el icono de <b>micrófono</b> (abajo a la derecha del visualizador) para identificar la canción que esté sonando alrededor, tipo Shazam. Escucha 6 segundos y muestra carátula, título y artista. Desde el resultado puedes <b>buscar online</b> esa canción o <b>compartirla</b>. Necesitas configurar un token gratuito de <b>AudD.io</b> en Opciones.</p>' +
      '<h4>Más</h4>' +
      '<p>Temporizador de apagado, temas claro/oscuro, idioma y <b>modo reproductor</b> (sin efectos, arranque instantáneo) en Opciones.</p>',
    en:
      '<h4>Load music</h4>' +
      '<p>Tap the start screen to open a <b>file</b> (the rest of its folder loads too), or tap <b>Load folder</b> to pick a whole folder.</p>' +
      '<h4>Playback</h4>' +
      '<p>Play/pause, previous/next, <b>shuffle</b> and speed. Tap the playlist title to open the full-screen view.</p>' +
      '<h4>Repeat, fast-seek and A–B</h4>' +
      '<p>In the mini-list header, the <b>repeat</b> button cycles through <b>off</b>, <b>repeat current</b> (a "1") and <b>repeat all</b>. <b>Press and hold</b> the ◀/▶ buttons to rewind or fast-forward within the track (&lt;&lt;/&gt;&gt;, with acceleration); a short tap changes track. And <b>holding Play/Pause</b> opens <b>A–B repeat</b>: mark <b>A</b> and <b>B</b> (SET buttons), fine-tune them with −/+, and the app loops that section. On the <b>waveform</b> (available in both modes; decoded on open in player mode): <b>tap</b> to move playback to that point, <b>pinch</b> to zoom, and once A/B are set with SET you can <b>drag them with your finger</b>. The −/+ step is selectable: <b>0.01 / 0.1 / 0.5 s</b>. You can set the <b>loop crossfade</b> (Off/25/50/100 ms) to smooth clicks, and <b>export the loop</b> repeated <b>2/4/8×</b> or a custom count: in full mode it exports <b>with effects applied</b>, in player mode without effects. To set points better while playing: <b>Reaction</b> (0/80/150/250 ms) subtracts your reaction time + audio latency, placing A and B a bit <b>earlier</b> than your tap (you mark what you just heard); <b>Snap to peak</b> magnetizes the point to a nearby sound hit only if it clearly stands out. Below the wave there are DJ-style controls: <b>◀ / ▶</b> move the whole selection (same length) along the track to hop between bars, and <b>½ / ×2</b> halve or double the loop length (chops); they work live. Open the loop with the <b>A/B</b> button (next to speed) or by holding Play. On the wave: one finger <b>drags</b> the point if you touch near A/B or <b>pans</b> if you touch elsewhere, <b>pinch</b> to zoom and <b>double-tap</b> restores 100% zoom. <b>CLEAR</b> turns it off (it also clears when the track changes).</p>' +
      '<h4>Queue, Files and Playlists</h4>' +
      '<p>That view has three tabs: <b>Queue</b> (current list), <b>Files</b> (folder browser) and <b>Playlists</b> (create and edit your lists). Each track\'s <b>⋮</b> button lets you play now, play next, add to end, add to a playlist or <b>edit tags</b>; for YouTube tracks also <b>Download</b>. The app <b>remembers</b> the last tab, folder or playlist you had open.</p>' +
      '<h4>Add all and multi-select</h4>' +
      '<p>Inside a folder, the <b>add all</b> button drops every track into a playlist at once. Multi-select turns on with the <b>select</b> (✓) button or by <b>long-pressing</b> a track (in Files, inside a playlist and in Online). Tick several tracks and use the bottom bar to play <b>next</b>, <b>at the end</b>, <b>add to playlist</b>, <b>play</b>/<b>download</b> (in Online) or <b>remove</b> (in playlists). Switching tabs or leaving turns selection off.</p>' +
      '<h4>Track count and duration</h4>' +
      '<p>In <b>Files</b>, each folder shows its <b>track count</b> and <b>total duration</b>; <b>Playlists</b> show the same. The value is cached and the <b>duration is only recomputed when the number of items changes</b>, to avoid wasting resources.</p>' +
      '<h4>Folders and permissions</h4>' +
      '<p>If a folder ends up <b>without permission</b> after importing settings, it shows up flagged in Files: tap it to relink it without losing your playlists.</p>' +
      '<h4>LoFi effects</h4>' +
      '<p>LoFi engine, reverb, delay, chorus and <b>spatial enhance</b> (stereo width), each with presets and independently switchable. Double-tap a control name to reset it. Use <b>Presets</b> to save your combinations.</p>' +
      '<h4>Spatial enhance and gain</h4>' +
      '<p>The <b>Space</b> effect widens the stereo image (<i>Width</i> and <i>Amount</i> params); it\'s off by default. In <b>Options</b> there\'s an <b>Output gain</b> control (−6 to +6 dB, center 0 = no change) to nudge the volume up or down; a limiter keeps it from distorting when boosted.</p>' +
      '<h4>Visualizer</h4>' +
      '<p>Tap the eye to pick a visualizer and turn on the blurred <b>cover backdrop</b>.</p>' +
      '<h4>Full-screen artwork</h4>' +
      '<p>The <b>image</b> icon (bottom-left of the visualizer) opens the cover full-screen —the file\'s (ID3) or the YouTube thumbnail— with options to <b>save</b> to the device and <b>share</b>.</p>' +
      '<h4>Edit tags (ID3)</h4>' +
      '<p>From a local track\'s <b>⋮</b> menu pick <b>Edit tags</b> to change <b>title, artist, album, track number</b> and <b>cover</b>. You can <b>save/download</b> the current cover (button over the image) before replacing it, and <b>removing</b> it asks for confirmation. It needs <b>write</b> permission on the folder: recently added ones already have it; older ones must be <b>relinked</b>.</p>' +
      '<h4>Lyrics and karaoke</h4>' +
      '<p>Tap <b>LYRIC</b> (top-left of the visualizer) to search lyrics. Pick the source between <b>LRCLIB</b>, <b>Genius</b> and <b>NetEase</b> and, when a synced version exists, switch between <b>PLAIN</b> and <b>SYNCED</b>. The bottom icon bar is: <b>play/pause</b>, <b>remove vocals</b> (attenuates the centered voice), <b>karaoke mode</b> (maximize icon), <b>share</b> and <b>PDF</b>. <b>Karaoke mode</b> opens the synced lyrics full-screen, highlighting the line/word being sung; close it with the <b>X</b> or the <b>Back</b> button. As long as the song does not change, reopening LYRIC shows the one you already picked without searching again. Tapping the title between the reels copies it to the clipboard.</p>' +
      '<h4>Online (YouTube)</h4>' +
      '<p>In the <b>Online</b> tab you search YouTube and play <b>audio only</b>, add tracks to playlists or download them. Paste a <b>video link</b> and it opens that result directly; paste a <b>playlist link</b> and it loads all its videos into the results. The bottom bar lets you <b>add all</b> to a playlist or <b>download all</b> (batch), and with <b>multi-select</b> (long-press or the Select button) you can play, add or download only the ticked ones. Downloads also embed the <b>cover art</b> (video thumbnail).</p>' +
      '<h4>Vocal removal (karaoke)</h4>' +
      '<p>In player-only mode a <b>microphone</b> button appears that attenuates the song\'s centered vocal. A <b>tap</b> toggles it; <b>press and hold</b> to open the settings: <b>intensity</b>, vocal <b>frequency</b> range (low/high) and quick presets (soft/medium/strong). It\'s approximate and works best on stereo tracks.</p>' +
      '<p>Inside those settings, <b>Advanced AI removal</b> opens real stem separation: tapping it warns that it will process the track (takes time and uses CPU/RAM) and, on accept, opens a modal where you choose <b>what to save</b> (instrumental, vocals or both) and <b>what to open when done</b>. It runs offline and is <b>cached</b> per track; then you can <b>load the instrumental</b> (real karaoke) or the <b>vocals</b>, and your lo-fi effects still apply on top. Requires the Android app with the model installed.</p>' +
      '<h4>Export</h4>' +
      '<p>Render the track with the applied effects to WAV or MP3. The MP3 embeds the <b>cover art</b> (from the original file or the YouTube thumbnail) plus title/artist. In the app it is saved to the <b>/DSKlofi</b> folder.</p>' +
      '<h4>Identify song</h4>' +
      '<p>Tap the <b>microphone</b> icon (bottom-right of the visualizer) to identify whatever song is playing nearby, Shazam-style. It listens for 6 seconds and shows the cover art, title and artist. From the result you can <b>search online</b> for that song or <b>share</b> it. You\'ll need to set a free <b>AudD.io</b> token in Options.</p>' +
      '<h4>More</h4>' +
      '<p>Sleep timer, light/dark themes, language and <b>player-only mode</b> (no effects, instant start) in Options.</p>'
  };
  function renderHelp() {
    const body = $("#helpBody"); if (!body) return;
    const lang = (window.I18n && I18n.lang) ? I18n.lang : "en";
    body.innerHTML = HELP[lang] || HELP.en;
  }

  /* ============================ PESTAÑAS ============================ */
  const VIEW_KEY = "dsklofi.lastview";
  let activeTab = "now";
  function saveViewState() {
    try {
      const st = { tab: activeTab };
      if (activeTab === "explore") st.path = expStack.map((l) => ({ uri: l.uri, name: l.name }));
      if (activeTab === "lists" && detailId) st.listId = detailId;
      localStorage.setItem(VIEW_KEY, JSON.stringify(st));
    } catch (e) {}
  }
  function loadViewState() {
    try { return JSON.parse(localStorage.getItem(VIEW_KEY)) || null; } catch (e) { return null; }
  }
  function setTab(tab) {
    // salir del modo de selección si cambiamos de pestaña
    if (Sel.active && ((Sel.kind === "explorer" && tab !== "explore") || (Sel.kind === "list" && tab !== "lists"))) {
      Sel.active = false; Sel.kind = null; Sel.ids.clear(); selUpdateUI();
    }
    // salir de la selección múltiple del online al dejar esa pestaña
    if (tab !== "online" && window.DSKYoutubeUI && window.DSKYoutubeUI.exitSelect) {
      try { window.DSKYoutubeUI.exitSelect(); } catch (e) {}
    }
    activeTab = tab;
    $$(".lib-tab").forEach((b) => b.classList.toggle("lib-tab--active", b.getAttribute("data-tab") === tab));
    $$(".lib-panel").forEach((p) => p.classList.toggle("lib-panel--active", p.getAttribute("data-panel") === tab));
    if (tab === "explore") {
      if (explorerSearchActive()) runExplorerSearch(expSearchQuery);
      else renderExplorer();
    } else {
      expSearchToken++; // detiene una búsqueda en curso al salir de la pestaña
    }
    if (tab === "lists") renderLists();
    saveViewState();
  }
  /* re-navega el explorador hasta la carpeta recordada (sin tocar Sel) */
  function restoreExplorerPath(path) {
    expStack = [];
    (path || []).forEach((lvl) => {
      if (!lvl || !lvl.uri) return;
      let entries = [];
      try { entries = JSON.parse(window.DSKBridge.browse(lvl.uri) || "[]"); } catch (e) {}
      expStack.push({ uri: lvl.uri, name: lvl.name, entries: entries });
    });
  }
  /* abre la biblioteca recordando la última pestaña/carpeta/lista visitada */
  function openLibraryRemembered() {
    // al volver a abrir, nunca arrancar con selección múltiple activa
    if (Sel.active) { Sel.active = false; Sel.kind = null; Sel.ids.clear(); selUpdateUI(); }
    if (window.DSKYoutubeUI && window.DSKYoutubeUI.exitSelect) { try { window.DSKYoutubeUI.exitSelect(); } catch (e) {} }
    DSKQueue.open();
    const st = loadViewState();
    if (st && st.tab === "explore" && Array.isArray(st.path) && st.path.length && explorerSupported()) {
      restoreExplorerPath(st.path);
      setTab("explore");
    } else if (st && st.tab === "lists" && st.listId && findList(st.listId)) {
      showListDetail(st.listId);
      setTab("lists");
    } else if (st && ["now", "explore", "lists", "online"].indexOf(st.tab) !== -1) {
      setTab(st.tab);
    } else {
      setTab("lists");
    }
  }

  // Abre la biblioteca en la pestaña Online y busca el enlace de YouTube recibido
  // (compartido a la app). El shim temprano de index.html encola la URL si llega
  // antes de que esto exista; aquí registramos la implementación real.
  function realOpenYouTubeUrl(url) {
    if (!url) return;
    const hold = typeof window.__dskSplashHold === "function";
    if (hold) window.__dskSplashHold();
    try { DSKQueue.open(); } catch (e) {}
    setTab("online");
    setTimeout(() => {
      if (window.DSKYoutubeUI && DSKYoutubeUI.openQuery) DSKYoutubeUI.openQuery(url);
      if (hold) requestAnimationFrame(() => window.__dskSplashRelease());
    }, 120);
  }
  window.__dskRealOpenYT = realOpenYouTubeUrl;
  window.DSKOpenYouTubeUrl = realOpenYouTubeUrl;
  // procesar un enlace que hubiera llegado antes de estar listos
  if (window.__dskPendingYTUrl) {
    const pend = window.__dskPendingYTUrl; window.__dskPendingYTUrl = null;
    // liberamos el hold puesto por el shim; realOpenYouTubeUrl pondrá el suyo
    if (typeof window.__dskSplashRelease === "function") window.__dskSplashRelease();
    realOpenYouTubeUrl(pend);
  }

  /* ============================ MENÚ ⋮ ============================ */
  // ctx: { kind:'queue'|'explorer'|'list', index?, item?, listId? }
  let menuCtx = null;
  function openTrackMenu(ctx) {
    menuCtx = ctx;
    const host = $("#trackMenuList");
    host.innerHTML = "";
    const add = (key, fn, danger) => {
      const b = document.createElement("button");
      b.className = "menu-item" + (danger ? " menu-item--danger" : "");
      b.type = "button";
      b.textContent = T(key);
      b.addEventListener("click", () => { UI.closeModal("trackMenuModal"); fn(); });
      host.appendChild(b);
    };
    add("m_play", () => menuPlay(ctx));
    add("m_play_next", () => { DSKQueue.enqueueNext([menuItem(ctx)]); UI.toast(T("q_added_next")); });
    add("m_play_last", () => { DSKQueue.enqueueLast([menuItem(ctx)]); UI.toast(T("q_added_last")); });
    add("m_add_list", () => openListPick(menuItem(ctx)));
    // editar etiquetas ID3: solo archivos locales (URI), no pistas de YouTube
    const mi = menuItem(ctx);
    if (mi && mi.uri && !mi.ytId && window.DSKTagEditor) add("m_edit_tags", () => DSKTagEditor.open(mi));
    // descargar: solo para pistas de YouTube (en streaming, sin archivo local)
    if (mi && mi.ytId && !mi.uri && window.DSKDownloads && DSKDownloads.enqueue) {
      add("m_download", () => {
        try { DSKDownloads.enqueue(mi.ytId, mi.name || "", mi.thumb || ""); UI.toast(T("on_queued")); }
        catch (e) { UI.toast(T("on_dl_error")); }
      });
    }
    if (ctx.kind === "queue") add("m_remove", () => { DSKQueue.remove(ctx.index); UI.toast(T("q_removed")); }, true);
    if (ctx.kind === "list") add("m_remove", () => { listRemoveTrack(ctx.listId, ctx.index); }, true);
    UI.openModal("trackMenuModal");
  }
  // item {name,uri} a partir del contexto
  function menuItem(ctx) {
    if (ctx.item) return { name: ctx.item.name, uri: ctx.item.uri, ytId: ctx.item.ytId || null, uploader: ctx.item.uploader || null, thumb: ctx.item.thumb || null };
    const snap = DSKQueue.snapshot();
    const it = snap.items[ctx.index];
    return it ? { name: it.name, uri: it.uri, nativeIndex: it.nativeIndex, ytId: it.ytId || null, uploader: it.uploader || null, thumb: it.thumb || null } : null;
  }
  function menuPlay(ctx) {
    if (ctx.kind === "queue") { DSKQueue.playAt(ctx.index); }
    else if (ctx.kind === "explorer") { playExplorerAudio(ctx.index); }
    else if (ctx.kind === "list") { playList(ctx.listId, ctx.index); }
    else if (ctx.kind === "search") { if (ctx.onPlay) ctx.onPlay(); else DSKQueue.load([menuItem(ctx)], 0, { type: "folder", name: ctx.item.name }); }
  }

  /* elegir lista destino (o crear nueva). itemOrItems: {name,uri,...} | array de esos */
  function openListPick(itemOrItems) {
    const items = (Array.isArray(itemOrItems) ? itemOrItems : [itemOrItems]).filter(Boolean);
    if (!items.length) return;
    const addedToast = items.length > 1 ? T("q_added_list_n").replace("{n}", items.length) : T("q_added_list");
    const host = $("#listPickList");
    host.innerHTML = "";
    const mk = (label, fn, accent) => {
      const b = document.createElement("button");
      b.className = "menu-item" + (accent ? " menu-item--accent" : "");
      b.type = "button"; b.textContent = label;
      b.addEventListener("click", () => { UI.closeModal("listPickModal"); fn(); });
      host.appendChild(b);
    };
    mk(T("m_new_list"), () => askListName(null, (name) => {
      const l = { id: newId(), name: name, items: items.map(normItem) };
      const lists = loadLists(); lists.push(l); saveLists(lists);
      UI.toast(T("list_created"));
    }), true);
    loadLists().forEach((l) => mk(l.name + "  ·  " + countLabel(l.items.length), () => {
      const lists = loadLists(); const t = lists.find((x) => x.id === l.id);
      if (t) { t.items.push(...items.map(normItem)); saveLists(lists); UI.toast(addedToast); if (activeTab === "lists") renderLists(); }
    }));
    UI.openModal("listPickModal");
  }
  function normItem(it) { return { name: it.name, uri: it.uri || null, path: it.path || null, ytId: it.ytId || null, uploader: it.uploader || null, thumb: it.thumb || null }; }

  /* nombre de lista (crear/renombrar) — resuelve con callback */
  function askListName(initial, cb) {
    $("#listNameTitle").textContent = initial == null ? T("lists_new") : T("list_rename");
    const inp = $("#listNameInput");
    inp.value = initial || "";
    $("#listNameOk").textContent = initial == null ? T("list_create") : T("list_rename");
    const ok = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } cleanup(); UI.closeModal("listNameModal"); cb(v); };
    const cancel = () => { cleanup(); UI.closeModal("listNameModal"); };
    function cleanup() { $("#listNameOk").onclick = null; $("#listNameCancel").onclick = null; inp.onkeydown = null; }
    $("#listNameOk").onclick = ok;
    $("#listNameCancel").onclick = cancel;
    inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); ok(); } };
    UI.openModal("listNameModal");
    setTimeout(() => inp.focus(), 60);
  }

  /* ============================ SELECCIÓN MÚLTIPLE ============================ */
  // kind: 'explorer' (ids = uri de audio) | 'list' (ids = índice en l.items)
  const Sel = { active: false, kind: null, ids: new Set() };

  function selUpdateUI() {
    const expBtn = $("#libExpSelect");
    if (expBtn) expBtn.classList.toggle("lib-sel--active", Sel.active && Sel.kind === "explorer");
    const listBtn = $("#libListSelect");
    if (listBtn) listBtn.classList.toggle("lib-sel--active", Sel.active && Sel.kind === "list");
    const bar = $("#selBar");
    if (!bar) return;
    bar.hidden = !Sel.active;
    const cnt = $("#selBarCount"); if (cnt) cnt.textContent = countLabel(Sel.ids.size);
    const removeBtn = $("#selRemove"); if (removeBtn) removeBtn.hidden = Sel.kind !== "list";
    const disabled = Sel.ids.size === 0;
    ["selPlayNext", "selPlayLast", "selAddList", "selRemove"].forEach((id) => {
      const b = $("#" + id); if (b) b.disabled = disabled;
    });
  }
  function selToggleMode(kind) {
    if (Sel.active && Sel.kind === kind) { selExit(); return; }
    Sel.active = true; Sel.kind = kind; Sel.ids.clear();
    selUpdateUI();
    if (kind === "explorer") renderExplorer(); else renderListDetail();
  }
  function selExit() {
    if (!Sel.active) return;
    const kind = Sel.kind;
    Sel.active = false; Sel.kind = null; Sel.ids.clear();
    selUpdateUI();
    if (kind === "explorer") renderExplorer(); else if (kind === "list") renderListDetail();
  }
  function selToggleItem(key, row) {
    if (Sel.ids.has(key)) Sel.ids.delete(key); else Sel.ids.add(key);
    if (row) row.classList.toggle("lib-row--checked", Sel.ids.has(key));
    selUpdateUI();
  }
  // entra en selección y marca de una vez el elemento de la pulsación larga
  function selEnterWith(kind, key) {
    Sel.active = true; Sel.kind = kind; Sel.ids.clear();
    if (key !== null && key !== undefined) Sel.ids.add(key);
    selUpdateUI();
    if (kind === "explorer") renderExplorer(); else if (kind === "list") renderListDetail();
  }
  // pulsación larga sobre una fila → ejecuta onLong (activar selección)
  let lpGuard = 0;
  function attachLongPress(row, onLong) {
    let timer = 0, x = 0, y = 0;
    const clear = () => { if (timer) { clearTimeout(timer); timer = 0; } };
    row.addEventListener("pointerdown", (e) => {
      x = e.clientX; y = e.clientY; clear();
      timer = setTimeout(() => { timer = 0; lpGuard = Date.now(); onLong(); try { if (navigator.vibrate) navigator.vibrate(15); } catch (_) {} }, 450);
    });
    row.addEventListener("pointermove", (e) => { if (timer && (Math.abs(e.clientX - x) > 10 || Math.abs(e.clientY - y) > 10)) clear(); });
    row.addEventListener("pointerup", clear);
    row.addEventListener("pointercancel", clear);
    row.addEventListener("pointerleave", clear);
  }
  /* items {name,uri,...} en el orden mostrado, según el modo activo */
  function selGatherItems() {
    if (Sel.kind === "explorer") {
      const lvl = expStack[expStack.length - 1]; if (!lvl) return [];
      return lvl.entries.filter((e) => !e.dir && Sel.ids.has(e.uri))
        .map((e) => ({ name: e.name, uri: e.uri, path: e.path || null }));
    }
    if (Sel.kind === "list") {
      const l = findList(detailId); if (!l) return [];
      return l.items.filter((it, i) => Sel.ids.has(i))
        .map((it) => ({ name: it.name, uri: it.uri, ytId: it.ytId || null, uploader: it.uploader || null, thumb: it.thumb || null }));
    }
    return [];
  }

  /* ============================ EXPLORADOR ============================ */
  // pila de navegación: cada nivel { uri|null (null=raíces), name, entries:[] }
  let expStack = [];
  let rootScroll = 0;   // scroll guardado del nivel raíz del explorador
  // guarda la posición de scroll actual del explorador en su nivel
  function saveExpScroll() {
    const list = document.getElementById("libExpItems");
    if (!list) return;
    if (expStack.length) expStack[expStack.length - 1].scroll = list.scrollTop;
    else rootScroll = list.scrollTop;
  }
  function explorerSupported() { return hasBridge("listRoots") && hasBridge("browse"); }

  function updateExplorerToolbar() {
    const atRoot = !expStack.length;
    const hasAudios = !atRoot && currentAudios().length > 0;
    const selecting = Sel.active && Sel.kind === "explorer";
    const addAllBtn = $("#libExpAddAll"); if (addAllBtn) addAllBtn.hidden = !hasAudios || selecting;
    const selBtn = $("#libExpSelect"); if (selBtn) selBtn.hidden = !hasAudios;
    const addRootBtn = $("#libAddRoot"); if (addRootBtn) addRootBtn.hidden = !atRoot;
  }

  function renderExplorer(scrollTarget) {
    const list = $("#libExpItems");
    // por defecto conserva el scroll actual (re-render por selección, etc.);
    // enterFolder pasa 0 (ir al inicio) y explorerUp pasa el scroll guardado.
    const keep = (scrollTarget != null) ? scrollTarget : (list ? list.scrollTop : 0);
    if (!explorerSupported()) {
      list.innerHTML = '<div class="lib-empty">' + T("ex_no_roots") + "</div>";
      $("#libUp").hidden = true; $("#libPath").textContent = ""; updateExplorerToolbar(); return;
    }
    if (!expStack.length) {
      // nivel raíces
      let roots = [];
      try { roots = JSON.parse(window.DSKBridge.listRoots() || "[]"); } catch (e) {}
      $("#libUp").hidden = true;
      $("#libPath").textContent = T("ex_roots");
      list.innerHTML = "";
      updateExplorerToolbar();
      if (!roots.length) { list.innerHTML = '<div class="lib-empty">' + T("ex_no_roots") + "</div>"; return; }
      roots.forEach((r) => list.appendChild(rootRow(r)));
      list.scrollTop = keep;
      return;
    }
    const lvl = expStack[expStack.length - 1];
    $("#libUp").hidden = false;
    $("#libPath").textContent = lvl.name;
    list.innerHTML = "";
    updateExplorerToolbar();
    if (!lvl.entries.length) { list.innerHTML = '<div class="lib-empty">' + T("ex_empty") + "</div>"; list.scrollTop = keep; return; }
    renderEntriesChunked(list, lvl.entries, keep);
  }

  /* Inserta filas en lotes vía requestAnimationFrame para no bloquear el hilo
     principal cuando hay muchos archivos (evita el "congelado" al refrescar).
     targetScroll se reaplica en cada lote hasta que hay altura suficiente. */
  function renderEntriesChunked(list, entries, targetScroll) {
    const CHUNK = 40;
    const token = {};
    list.__renderToken = token;
    let idx = 0;
    function step() {
      if (list.__renderToken !== token) return; // se reemplazó la vista, abortar
      const frag = document.createDocumentFragment();
      const end = Math.min(idx + CHUNK, entries.length);
      for (; idx < end; idx++) {
        const e = entries[idx];
        frag.appendChild(e.dir ? folderRow(e) : audioRow(e, idx));
      }
      list.appendChild(frag);
      if (targetScroll != null) list.scrollTop = targetScroll;
      if (idx < entries.length) requestAnimationFrame(step);
    }
    step();
  }

  /* ===================== BÚSQUEDA EN EXPLORADOR ===================== */
  // Busca por nombre (carpetas y audios) en TODAS las raíces, recorriendo el
  // árbol de forma incremental (una carpeta por "tick") para no bloquear el
  // hilo de UI con árboles grandes. Resultados se pintan a medida que llegan.
  let expSearchQuery = "";
  let expSearchToken = 0;

  function norm(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // quita acentos
  }

  function explorerSearchActive() { return expSearchQuery.trim().length > 0; }

  function runExplorerSearch(query) {
    expSearchQuery = query;
    const list = $("#libExpItems");
    const q = norm(query.trim());
    if (!q) { renderExplorer(); return; }

    const token = ++expSearchToken;
    $("#libUp").hidden = true;
    $("#libPath").textContent = T("ex_search_results");
    list.innerHTML = "";
    list.__renderToken = token;

    let roots = [];
    try { roots = JSON.parse(window.DSKBridge.listRoots() || "[]"); } catch (e) {}
    if (!roots.length) { list.innerHTML = '<div class="lib-empty">' + T("ex_no_roots") + "</div>"; return; }

    // cola BFS de carpetas pendientes: { uri, name }
    const queue = roots.filter((r) => !r.pending).map((r) => ({ uri: r.uri, name: r.name }));
    let found = 0;
    const MAX_RESULTS = 200;
    let firstBatch = true;

    function step() {
      if (expSearchToken !== token) return;          // cancelado (nueva búsqueda / cambio de vista)
      if (!queue.length || found >= MAX_RESULTS) {
        if (found === 0) {
          list.innerHTML = '<div class="lib-empty">' + T("ex_search_empty") + "</div>";
        }
        return;
      }
      const folder = queue.shift();
      let entries = [];
      try { entries = JSON.parse(window.DSKBridge.browse(folder.uri) || "[]"); } catch (e) {}

      const frag = document.createDocumentFragment();
      entries.forEach((e) => {
        if (e.dir) {
          queue.push({ uri: e.uri, name: e.name });
          if (norm(e.name).indexOf(q) !== -1 && found < MAX_RESULTS) {
            found++;
            frag.appendChild(searchFolderRow(e));
          }
        } else {
          if (norm(e.name).indexOf(q) !== -1 && found < MAX_RESULTS) {
            found++;
            frag.appendChild(searchAudioRow(e, entries, folder.name));
          }
        }
      });
      if (frag.childNodes.length) {
        if (firstBatch && list.querySelector(".lib-empty")) list.innerHTML = "";
        firstBatch = false;
        list.appendChild(frag);
      }
      if (queue.length && found < MAX_RESULTS) requestAnimationFrame(step);
      else if (found === 0) list.innerHTML = '<div class="lib-empty">' + T("ex_search_empty") + "</div>";
    }
    step();
  }

  /* fila de carpeta encontrada: al tocarla, entra en esa carpeta y limpia la búsqueda */
  function searchFolderRow(e) {
    const row = document.createElement("div");
    row.className = "lib-row lib-row--folder";
    row.innerHTML = '<span class="lib-row__ic">' + IC.folder + '</span><span class="lib-row__name"></span>' +
      '<button class="lib-row__act" type="button" aria-label="' + T("ex_play_folder") + '">' + IC.play + '</button>';
    row.querySelector(".lib-row__name").textContent = e.name;
    row.addEventListener("click", () => { clearExplorerSearch(); enterFolder(e.uri, e.name); });
    row.querySelector(".lib-row__act").addEventListener("click", (ev) => { ev.stopPropagation(); clearExplorerSearch(); playFolderUri(e.uri, e.name); });
    return row;
  }
  /* fila de audio encontrado: reproduce TODA la carpeta donde está, dejando la
     cola posicionada en este archivo (igual que al abrir esa carpeta y tocarlo). */
  function searchAudioRow(e, folderEntries, folderName) {
    const row = document.createElement("div");
    row.className = "lib-row lib-row--audio";
    row.innerHTML = '<span class="lib-row__ic">' + IC.audio + '</span><span class="lib-row__name"></span>' +
      '<button class="lib-row__act" type="button" aria-label="…">' + IC.dots + '</button>';
    row.querySelector(".lib-row__name").textContent = stripExt(e.name);
    const item = { name: e.name, uri: e.uri, path: e.path || null };
    function playFolderFromHere() {
      const audios = folderEntries.filter((x) => !x.dir);
      const start = Math.max(0, audios.findIndex((a) => a.uri === e.uri));
      const name = folderName || T("ex_search_results");
      DSKQueue.load(audios.map((a) => ({ name: a.name, uri: a.uri, path: a.path || null })), start, { type: "folder", name: name });
    }
    row.addEventListener("click", playFolderFromHere);
    row.querySelector(".lib-row__act").addEventListener("click", (ev) => {
      ev.stopPropagation();
      openTrackMenu({ kind: "search", item: item, onPlay: playFolderFromHere });
    });
    return row;
  }

  function clearExplorerSearch() {
    expSearchQuery = "";
    expSearchToken++;
    const inp = $("#libExpSearch"); if (inp) inp.value = "";
    const clr = $("#libExpSearchClear"); if (clr) clr.hidden = true;
  }

  function trimRootName(name, max = 9) {
    if (!name) return name;
    return name.length > max ? name.slice(0, max) + "…" : name;
  }
  function rootRow(r) {
    const row = document.createElement("div");
    row.className = "lib-row lib-row--folder" + (r.pending ? " lib-row--pending" : "");
    row.innerHTML = '<span class="lib-row__ic">' + (r.pending ? IC.relink : IC.folder) + '</span>' +
      '<span class="lib-row__name"></span>' +
      (r.pending ? '<span class="lib-row__sub lib-row__sub--pending">' + T("ex_pending") + '</span>' : '') +
      '<button class="lib-row__act" type="button" aria-label="' + T("ex_remove_root") + '">&times;</button>';
    const nameEl = row.querySelector(".lib-row__name");
    nameEl.textContent = r.name;
    nameEl.title = r.pending ? (r.name + " — " + T("ex_pending_hint")) : r.name;
    if (r.pending) {
      row.title = T("ex_pending_hint");
      row.addEventListener("click", () => { if (hasBridge("relinkRoot")) window.DSKBridge.relinkRoot(r.uri); });
    } else {
      row.addEventListener("click", () => enterFolder(r.uri, r.name));
    }
    row.querySelector(".lib-row__act").addEventListener("click", (e) => {
      e.stopPropagation();
      if (hasBridge("removeRoot")) { window.DSKBridge.removeRoot(r.uri); UI.toast(T("ex_root_removed")); renderExplorer(); }
    });
    return row;
  }
  function folderRow(e) {
    const row = document.createElement("div");
    row.className = "lib-row lib-row--folder";
    row.innerHTML = '<span class="lib-row__ic">' + IC.folder + '</span><span class="lib-row__name"></span>' +
      '<span class="lib-row__sub lib-row__stats"></span>' +
      '<button class="lib-row__act" type="button" aria-label="' + T("ex_play_folder") + '">' + IC.play + '</button>';
    row.querySelector(".lib-row__name").textContent = e.name;
    // nº de pistas + duración total (carga diferida + caché)
    const statsEl = row.querySelector(".lib-row__stats");
    fetchFolderStats(e.uri, (st) => { if (statsEl) statsEl.textContent = statsLabel(st); });
    row.addEventListener("click", () => enterFolder(e.uri, e.name));
    row.querySelector(".lib-row__act").addEventListener("click", (ev) => { ev.stopPropagation(); playFolderUri(e.uri, e.name); });
    return row;
  }
  function audioRow(e, i) {
    const row = document.createElement("div");
    const selecting = Sel.active && Sel.kind === "explorer";
    row.className = "lib-row lib-row--audio" + (selecting && Sel.ids.has(e.uri) ? " lib-row--checked" : "");
    row.innerHTML = (selecting ? '<span class="lib-row__chk">' + IC.check + '</span>' : '<span class="lib-row__ic">' + IC.audio + '</span>') +
      '<span class="lib-row__name"></span>' +
      (selecting ? '' : '<button class="lib-row__act" type="button" aria-label="…">' + IC.dots + '</button>');
    row.querySelector(".lib-row__name").textContent = stripExt(e.name);
    if (selecting) {
      row.addEventListener("click", () => { if (Date.now() - lpGuard < 500) return; selToggleItem(e.uri, row); });
    } else {
      row.addEventListener("click", () => playExplorerAudio(i));
      attachLongPress(row, () => selEnterWith("explorer", e.uri));
      row.querySelector(".lib-row__act").addEventListener("click", (ev) => {
        ev.stopPropagation();
        openTrackMenu({ kind: "explorer", index: i, item: { name: e.name, uri: e.uri, path: e.path || null } });
      });
    }
    return row;
  }

  function enterFolder(uri, name) {
    expSearchToken++; // cancela cualquier búsqueda en curso
    saveExpScroll();  // recuerda dónde estabas antes de entrar
    let entries = [];
    try { entries = JSON.parse(window.DSKBridge.browse(uri) || "[]"); } catch (e) {}
    expStack.push({ uri: uri, name: name, entries: entries });
    renderExplorer(0);   // la carpeta nueva empieza arriba
    saveViewState();
  }
  function explorerUp() {
    if (!expStack.length) return false;
    expSearchToken++;
    expStack.pop();
    const target = expStack.length ? (expStack[expStack.length - 1].scroll || 0) : rootScroll;
    renderExplorer(target);   // vuelve a donde estabas antes de entrar
    saveViewState();
    return true;
  }
  function currentAudios() {
    if (!expStack.length) return [];
    return expStack[expStack.length - 1].entries.filter((e) => !e.dir);
  }
  function playExplorerAudio(entryIndex) {
    const lvl = expStack[expStack.length - 1]; if (!lvl) return;
    const audios = lvl.entries.filter((e) => !e.dir);
    const tapped = lvl.entries[entryIndex];
    const start = audios.findIndex((a) => a.uri === tapped.uri);
    DSKQueue.load(audios.map((a) => ({ name: a.name, uri: a.uri, path: a.path || null })), Math.max(0, start), { type: "folder", name: lvl.name });
  }
  function playFolderUri(uri, name) {
    let entries = [];
    try { entries = JSON.parse(window.DSKBridge.browse(uri) || "[]"); } catch (e) {}
    const audios = entries.filter((e) => !e.dir);
    if (!audios.length) { UI.toast(T("ex_empty")); return; }
    DSKQueue.load(audios.map((a) => ({ name: a.name, uri: a.uri })), 0, { type: "folder", name: name });
  }

  /* ============================ LISTAS ============================ */
  let detailId = null;
  function showListsIndex() {
    if (Sel.active && Sel.kind === "list") { Sel.active = false; Sel.kind = null; Sel.ids.clear(); selUpdateUI(); }
    detailId = null; $("#libListsIndex").hidden = false; $("#libListDetail").hidden = true;
    if (activeTab === "lists") saveViewState();
  }
  function showListDetail(id) {
    detailId = id; $("#libListsIndex").hidden = true; $("#libListDetail").hidden = false; renderListDetail();
    if (activeTab === "lists") saveViewState();
  }

  function renderLists() {
    if (detailId && findList(detailId)) { renderListDetail(); return; }
    showListsIndex();
    const host = $("#libListsItems");
    const lists = loadLists();
    host.innerHTML = "";
    if (!lists.length) { host.innerHTML = '<div class="lib-empty">' + T("lists_empty") + "</div>"; return; }
    lists.forEach((l) => {
      const row = document.createElement("div");
      row.className = "lib-row lib-row--list";
      row.innerHTML = '<button class="lib-row__ic lib-row__play" type="button" aria-label="' + T("list_play") + '">' + IC.play + '</button>' +
        '<span class="lib-row__name"></span><span class="lib-row__sub"></span>' +
        '<button class="lib-row__act" type="button" aria-label="…">' + IC.dots + '</button>';
      row.querySelector(".lib-row__name").textContent = l.name;
      const subEl = row.querySelector(".lib-row__sub");
      subEl.textContent = countLabel(l.items.length);                 // conteo inmediato
      fetchListStats(l, (st) => { if (subEl) subEl.textContent = listLabel(st); });
      row.addEventListener("click", () => showListDetail(l.id));
      row.querySelector(".lib-row__play").addEventListener("click", (e) => { e.stopPropagation(); playList(l.id, 0); });
      row.querySelector(".lib-row__act").addEventListener("click", (e) => { e.stopPropagation(); openListMenu(l.id); });
      host.appendChild(row);
    });
  }

  function openListMenu(id) {
    const host = $("#trackMenuList");
    host.innerHTML = "";
    const add = (label, fn, mod) => {
      const b = document.createElement("button");
      b.className = "menu-item" + (mod ? " menu-item--" + mod : "");
      b.type = "button"; b.textContent = label;
      b.addEventListener("click", () => { UI.closeModal("trackMenuModal"); fn(); });
      host.appendChild(b);
    };
    add(T("list_play"), () => playList(id, 0));
    add(T("list_rename"), () => { const l = findList(id); askListName(l.name, (name) => { const lists = loadLists(); const t = lists.find((x) => x.id === id); if (t) { t.name = name; saveLists(lists); UI.toast(T("list_renamed")); renderLists(); } }); });
    add(T("list_delete"), async () => {
      const okd = await UI.confirm({ title: T("list_del_title"), message: T("list_del_msg"), danger: true, confirmLabel: T("list_delete") });
      if (!okd) return;
      saveLists(loadLists().filter((x) => x.id !== id));
      UI.toast(T("list_deleted")); showListsIndex(); renderLists();
    }, "danger");
    $("#trackMenuModalTitle") && ($("#trackMenuModalTitle").textContent = T("m_title"));
    UI.openModal("trackMenuModal");
  }

  function renderListDetail() {
    const l = findList(detailId); if (!l) { showListsIndex(); renderLists(); return; }
    $("#libListTitle").textContent = l.name;
    const host = $("#libListTracks");
    host.innerHTML = "";
    const selBtn = $("#libListSelect"); if (selBtn) selBtn.hidden = !l.items.length;
    if (!l.items.length) { host.innerHTML = '<div class="lib-empty">' + T("list_empty") + "</div>"; return; }
    // ¿qué pista de ESTA lista está sonando ahora?
    const snap = DSKQueue.snapshot();
    const activeUri = (snap.source && snap.source.type === "list" && snap.source.id === detailId &&
                       snap.index >= 0 && snap.items[snap.index]) ? snap.items[snap.index].uri : null;
    const selecting = Sel.active && Sel.kind === "list";
    l.items.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "lib-row lib-row--audio" + (activeUri && it.uri === activeUri ? " lib-row--active" : "") +
        (selecting && Sel.ids.has(i) ? " lib-row--checked" : "");
      if (selecting) {
        row.innerHTML = '<span class="lib-row__chk">' + IC.check + '</span><span class="lib-row__name"></span>';
        row.querySelector(".lib-row__name").textContent = stripExt(it.name);
        row.addEventListener("click", () => { if (Date.now() - lpGuard < 500) return; selToggleItem(i, row); });
      } else {
        row.innerHTML = '<span class="lib-row__ord"></span><span class="lib-row__name"></span>' +
          '<button class="lib-row__mv" data-d="-1" type="button" aria-label="▲">▲</button>' +
          '<button class="lib-row__mv" data-d="1" type="button" aria-label="▼">▼</button>' +
          '<button class="lib-row__act" type="button" aria-label="…">' + IC.dots + '</button>';
        row.querySelector(".lib-row__ord").textContent = (i + 1);
        row.querySelector(".lib-row__name").textContent = stripExt(it.name);
        row.addEventListener("click", () => playList(detailId, i));
        attachLongPress(row, () => selEnterWith("list", i));
        row.querySelectorAll(".lib-row__mv").forEach((mb) => mb.addEventListener("click", (e) => {
          e.stopPropagation(); listMove(detailId, i, parseInt(mb.getAttribute("data-d"), 10));
        }));
        row.querySelector(".lib-row__act").addEventListener("click", (e) => {
          e.stopPropagation();
          openTrackMenu({ kind: "list", index: i, listId: detailId, item: { name: it.name, uri: it.uri, ytId: it.ytId || null, uploader: it.uploader || null, thumb: it.thumb || null } });
        });
      }
      host.appendChild(row);
    });
    const act = host.querySelector(".lib-row--active");
    if (act) requestAnimationFrame(() => { try { act.scrollIntoView({ block: "center" }); } catch (e) {} });
  }
  function listMove(id, i, dir) {
    const lists = loadLists(); const l = lists.find((x) => x.id === id); if (!l) return;
    const j = i + dir; if (j < 0 || j >= l.items.length) return;
    const t = l.items.splice(i, 1)[0]; l.items.splice(j, 0, t); saveLists(lists); renderListDetail();
  }
  function listRemoveTrack(id, i) {
    const lists = loadLists(); const l = lists.find((x) => x.id === id); if (!l) return;
    l.items.splice(i, 1); saveLists(lists); UI.toast(T("q_removed"));
    if (detailId === id) renderListDetail(); else renderLists();
  }
  function playList(id, startIndex) {
    const l = findList(id); if (!l || !l.items.length) { UI.toast(T("list_empty")); return; }
    DSKQueue.load(l.items.map((it) => ({ name: it.name, uri: it.uri, ytId: it.ytId || null, uploader: it.uploader || null, thumb: it.thumb || null })), startIndex || 0, { type: "list", name: l.name, id: id });
  }

  /* guardar cola actual como lista */
  function saveQueueAsList() {
    const items = DSKQueue.stableItems();
    if (!items.length) { UI.toast(T("list_empty")); return; }
    askListName(null, (name) => {
      const lists = loadLists(); lists.push({ id: newId(), name: name, items: items }); saveLists(lists);
      UI.toast(T("list_created"));
    });
  }

  /* export / import */
  /* deriva el URI de la carpeta raíz (árbol SAF) a partir del URI de una pista */
  function rootOf(uri) {
    if (!uri || uri.indexOf("/tree/") < 0) return null;
    const i = uri.indexOf("/document/");
    return i >= 0 ? uri.slice(0, i) : uri;
  }
  function treeName(rootUri) {
    try { const id = decodeURIComponent((rootUri.split("/tree/")[1] || "")); return id.split(":").pop() || id; }
    catch (e) { return "Carpeta"; }
  }

  function exportLists() {
    const lists = loadLists();
    if (!lists.length) { UI.toast(T("lists_empty")); return; }
    // carpetas (raíces) a las que pertenecen las pistas, con sus nombres
    const names = {};
    try { (JSON.parse(hasBridge("listRoots") ? window.DSKBridge.listRoots() : "[]") || []).forEach((r) => { names[r.uri] = r.name; }); } catch (e) {}
    const rootSet = {};
    lists.forEach((l) => l.items.forEach((it) => { const r = rootOf(it.uri); if (r) rootSet[r] = names[r] || treeName(r); }));
    const roots = Object.keys(rootSet).map((uri) => ({ uri: uri, name: rootSet[uri] }));
    const payload = { schema: "dsklofi-playlists", version: 2, roots: roots, playlists: lists.map((l) => ({ name: l.name, items: l.items })) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    if (hasBridge("saveFile")) {
      const r = new FileReader();
      r.onloadend = () => { try { window.DSKBridge.saveFile("DSKLoFi_playlists.json", String(r.result).split(",")[1], "application/json"); UI.toast(T("list_exported")); } catch (e) {} };
      r.readAsDataURL(blob);
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "DSKLoFi_playlists.json";
      document.body.appendChild(a); a.click(); a.remove();
      UI.toast(T("list_exported"));
    }
  }

  function importLists(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        let lists, roots = [];
        if (Array.isArray(data)) { lists = data; }                                   // formato antiguo (v1)
        else if (data && Array.isArray(data.playlists)) { lists = data.playlists; roots = Array.isArray(data.roots) ? data.roots : []; }
        else throw 0;
        // re-añadir las carpetas (permiso SAF). missing = sin permiso re-otorgable.
        let missing = 0;
        if (roots.length && hasBridge("addRootByUri")) {
          roots.forEach((rt) => { if (rt && rt.uri) { try { if (!window.DSKBridge.addRootByUri(rt.uri)) missing++; } catch (e) { missing++; } } });
        } else if (roots.length) { missing = roots.length; }
        // importar listas
        const cur = loadLists();
        lists.forEach((l) => { if (l && l.name && Array.isArray(l.items)) cur.push({ id: newId(), name: String(l.name), items: l.items.filter((x) => x && x.uri).map((x) => ({ name: x.name || "", uri: x.uri })) }); });
        saveLists(cur); renderLists();
        if (DSKQueue.isOpen() && activeTab === "explore" && !expStack.length) renderExplorer();
        UI.toast(missing ? (T("list_imported") + " · " + T("imp_missing_roots").replace("{n}", missing)) : T("list_imported"));
      } catch (e) { UI.toast(T("list_import_fail"), "danger"); }
    };
    r.readAsText(file);
  }

  /* ============================ CONFIGURACIÓN COMPLETA (backup/restore) ============================ */
  const SETTINGS_KEYS = [
    "dsklofi.theme", "dsklofi.lang", "dsklofi.params", "dsklofi.collapsed",
    "dsklofi.speed", "dsklofi.viz", "dsklofi.vizcover", "dsklofi.splash",
    "dsklofi.norm", "dsklofi.normlevel", "dsklofi.playeronly",
    "dsklofi.genpresets", "dsklofi.lyrsrc", "dsklofi.audd_token", LISTS_KEY
  ];

  function exportSettings() {
    const settings = {};
    SETTINGS_KEYS.forEach((k) => {
      const v = localStorage.getItem(k);
      if (v !== null) settings[k] = v;
    });
    let roots = [];
    try { roots = JSON.parse(hasBridge("listRoots") ? window.DSKBridge.listRoots() : "[]") || []; } catch (e) {}
    const payload = { schema: "dsklofi-settings", version: 1, settings: settings, roots: roots };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    if (hasBridge("saveFile")) {
      const r = new FileReader();
      r.onloadend = () => { try { window.DSKBridge.saveFile("DSKLoFi_config.json", String(r.result).split(",")[1], "application/json"); UI.toast(T("cfg_exported")); } catch (e) {} };
      r.readAsDataURL(blob);
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "DSKLoFi_config.json";
      document.body.appendChild(a); a.click(); a.remove();
      UI.toast(T("cfg_exported"));
    }
  }

  function importSettings(file) {
    const r = new FileReader();
    r.onload = async () => {
      try {
        const data = JSON.parse(r.result);
        if (!data || data.schema !== "dsklofi-settings" || !data.settings) throw 0;
        const ok = await UI.confirm({ title: T("cfg_import_title"), message: T("cfg_import_msg"), danger: true, confirmLabel: T("list_import") });
        if (!ok) return;
        SETTINGS_KEYS.forEach((k) => {
          if (Object.prototype.hasOwnProperty.call(data.settings, k)) {
            try { localStorage.setItem(k, data.settings[k]); } catch (e) {}
          }
        });
        let missing = 0;
        const roots = Array.isArray(data.roots) ? data.roots : [];
        if (roots.length && hasBridge("addRootByUri")) {
          roots.forEach((rt) => { if (rt && rt.uri) { try { if (!window.DSKBridge.addRootByUri(rt.uri)) missing++; } catch (e) { missing++; } } });
        } else if (roots.length) { missing = roots.length; }
        UI.toast(missing ? (T("cfg_imported") + " · " + T("imp_missing_roots").replace("{n}", missing)) : T("cfg_imported"));
        setTimeout(() => { try { location.reload(); } catch (e) {} }, 700);
      } catch (e) { UI.toast(T("cfg_import_fail"), "danger"); }
    };
    r.readAsText(file);
  }


  /* ============================ MINI-LISTA: etiqueta de fuente ============================ */
  function sourceLabel(src) {
    if (!src || src.type === "none") return T("playlist");
    if (src.name) return trimRootName(src.name);
    if (src.type === "folder") return T("src_folder");
    if (src.type === "list") return T("src_list");
    if (src.type === "file") return T("src_file");
    return T("playlist");
  }
  function applySource(detail) {
    const label = sourceLabel(detail && detail.source);
    const btn = $("#plTitleBtn");
    if (btn) {
      const txt = btn.querySelector(".playlist__title-txt");
      if (txt) txt.textContent = label; else btn.textContent = label;
      const full = (detail && detail.source && detail.source.name) || label;
      btn.title = full;
    }
    // El título del modal de biblioteca queda fijo (BIBLIOTECA/LIBRARY); solo
    // la cabecera de la mini-cola muestra el nombre de la fuente.
  }

  /* al abrir la vista completa: si suena una lista del usuario, ir directos a
     esa lista con su pista activa; si no, a "En curso". */
  function openToCurrent() {
    const src = DSKQueue.snapshot().source;
    if (src && src.type === "list" && src.id && findList(src.id)) {
      setTab("lists");
      showListDetail(src.id);
    } else {
      setTab("now");
    }
  }

  /* ============================ RESTAURAR COLA POR URI ============================ */
  function restoreUriQueue() {
    try {
      if (document.body.classList.contains("has-track")) return;     // ya hay algo cargado
      const raw = localStorage.getItem(QUEUE_KEY); if (!raw) return;
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.names) || !d.names.length) return;
      if (Array.isArray(d.uris) && d.uris.some((u) => u)) {
        const items = d.names.map((n, i) => ({ name: n, uri: d.uris[i] })).filter((x) => x.uri);
        if (!items.length) return;
        DSKQueue.load(items, d.index || 0, d.source || { type: "folder", name: T("src_folder") }, false, d.pos || 0);
        return;
      }
      if (Array.isArray(d.ytIds) && d.ytIds.some((v) => v)) {
        const items = d.names.map((n, i) => ({
          name: n,
          ytId: d.ytIds[i],
          uploader: (d.uploaders && d.uploaders[i]) || "",
          thumb: (d.thumbs && d.thumbs[i]) || ""
        })).filter((x) => x.ytId);
        if (!items.length) return;
        // prepareOnly=true: no resolver el stream de YouTube ahora (la URL caduca);
        // se resuelve al pulsar play.
        DSKQueue.load(items, d.index || 0, d.source || { type: "online", name: "YouTube" }, false, d.pos || 0, true);
      }
    } catch (e) {}
  }

  /* ============================ ATRÁS JERÁRQUICO ============================ */
  function backHandler() {
    // 1) modales abiertos
    const modals = ["listNameModal", "listPickModal", "trackMenuModal"];
    for (const id of modals) { const m = $("#" + id); if (m && m.classList.contains("modal--open")) { UI.closeModal(id); return true; } }
    if (DSKQueue.isOpen()) {
      // 2) detalle de lista → índice
      if (activeTab === "lists" && detailId) { showListsIndex(); renderLists(); return true; }
      // 3) subcarpeta del explorador → subir
      if (activeTab === "explore" && expStack.length) { explorerUp(); return true; }
    }
    return false;   // deja que app.js cierre la lista (→ pantalla principal)
  }

  /* ============================ INIT ============================ */
  function bind() {
    $$(".lib-tab").forEach((b) => b.addEventListener("click", () => setTab(b.getAttribute("data-tab"))));
    const up = $("#libUp"); if (up) up.addEventListener("click", explorerUp);
    const addRoot = $("#libAddRoot"); if (addRoot) addRoot.addEventListener("click", () => { if (hasBridge("addExplorerRoot")) window.DSKBridge.addExplorerRoot(); });

    // "añadir todo" (carpeta actual del explorador → lista)
    const addAllBtn = $("#libExpAddAll");
    if (addAllBtn) addAllBtn.addEventListener("click", () => {
      const audios = currentAudios();
      if (!audios.length) { UI.toast(T("ex_empty")); return; }
      openListPick(audios.map((a) => ({ name: a.name, uri: a.uri, path: a.path || null })));
    });

    // selección múltiple: explorador y detalle de lista
    const expSelBtn = $("#libExpSelect"); if (expSelBtn) expSelBtn.addEventListener("click", () => selToggleMode("explorer"));
    const listSelBtn = $("#libListSelect"); if (listSelBtn) listSelBtn.addEventListener("click", () => selToggleMode("list"));

    // barra de acciones de selección múltiple
    const selPlayNext = $("#selPlayNext");
    if (selPlayNext) selPlayNext.addEventListener("click", () => {
      const items = selGatherItems(); if (!items.length) return;
      DSKQueue.enqueueNext(items); UI.toast(T("q_added_next")); selExit();
    });
    const selPlayLast = $("#selPlayLast");
    if (selPlayLast) selPlayLast.addEventListener("click", () => {
      const items = selGatherItems(); if (!items.length) return;
      DSKQueue.enqueueLast(items); UI.toast(T("q_added_last")); selExit();
    });
    const selAddList = $("#selAddList");
    if (selAddList) selAddList.addEventListener("click", () => {
      const items = selGatherItems(); if (!items.length) return;
      openListPick(items); selExit();
    });
    const selRemove = $("#selRemove");
    if (selRemove) selRemove.addEventListener("click", () => {
      if (Sel.kind !== "list" || !Sel.ids.size) return;
      const lists = loadLists(); const l = lists.find((x) => x.id === detailId); if (!l) return;
      Array.from(Sel.ids).sort((a, b) => b - a).forEach((i) => l.items.splice(i, 1));
      saveLists(lists);
      UI.toast(T("q_removed"));
      selExit();
    });
    const selCancel = $("#selCancel"); if (selCancel) selCancel.addEventListener("click", selExit);

    // buscador de archivos/carpetas (pestaña Archivos)
    const expSearch = $("#libExpSearch"), expSearchClear = $("#libExpSearchClear");
    if (expSearch) {
      let debounceT = null;
      expSearch.addEventListener("input", () => {
        const v = expSearch.value || "";
        if (expSearchClear) expSearchClear.hidden = !v;
        clearTimeout(debounceT);
        debounceT = setTimeout(() => runExplorerSearch(v), 180);
      });
      expSearch.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); expSearch.blur(); }
      });
    }
    if (expSearchClear) {
      expSearchClear.addEventListener("click", () => {
        clearExplorerSearch();
        renderExplorer();
        if (expSearch) expSearch.focus();
      });
    }
    const sq = $("#libSaveQueue"); if (sq) sq.addEventListener("click", saveQueueAsList);
    const btnLibrary = $("#btnLibrary"); if (btnLibrary) btnLibrary.addEventListener("click", (e) => { e.stopPropagation(); openLibraryRemembered(); });
    const nl = $("#libNewList"); if (nl) nl.addEventListener("click", () => askListName(null, (name) => { const lists = loadLists(); lists.push({ id: newId(), name: name, items: [] }); saveLists(lists); UI.toast(T("list_created")); renderLists(); }));
    const lb = $("#libListBack"); if (lb) lb.addEventListener("click", () => { showListsIndex(); renderLists(); });
    const lp = $("#libListPlay"); if (lp) lp.addEventListener("click", () => { if (detailId) playList(detailId, 0); });
    const ex = $("#libExport"); if (ex) ex.addEventListener("click", exportLists);
    const im = $("#libImport"); if (im) im.addEventListener("click", () => $("#libImportInput").click());
    const imi = $("#libImportInput"); if (imi) imi.addEventListener("change", (e) => { if (e.target.files[0]) importLists(e.target.files[0]); e.target.value = ""; });

    // copia de seguridad completa (ajustes/efectos/carpetas/listas)
    const expCfg = $("#optExportCfg"); if (expCfg) expCfg.addEventListener("click", exportSettings);
    const impCfgInput = $("#optImportCfgInput");
    const impCfg = $("#optImportCfg"); if (impCfg) impCfg.addEventListener("click", () => { if (impCfgInput) impCfgInput.click(); });
    if (impCfgInput) impCfgInput.addEventListener("change", (e) => { if (e.target.files[0]) importSettings(e.target.files[0]); e.target.value = ""; });

    // enlace discreto "importar configuración": solo en la primera ejecución
    const firstRunBtn = $("#btnImportCfgFirstRun");
    if (firstRunBtn) {
      try {
        if (!localStorage.getItem("dsklofi.setupdone")) firstRunBtn.hidden = false;
        localStorage.setItem("dsklofi.setupdone", "1");
      } catch (e) {}
      firstRunBtn.addEventListener("click", (e) => { e.stopPropagation(); if (impCfgInput) impCfgInput.click(); });
    }

    // si no hay explorador nativo, ocultar su pestaña
    if (!explorerSupported()) { const t = $("#libTabExp"); if (t) t.hidden = true; }

    // menú ⋮ de las pistas de la cola (lo emite app.js)
    document.addEventListener("dsk:trackmenu", (e) => openTrackMenu({ kind: "queue", index: e.detail.index }));
    // cambios de cola → etiqueta de fuente dinámica
    document.addEventListener("dsk:queue", (e) => {
      applySource(e.detail);
      // si está abierto el detalle de la lista que suena, refrescar la pista activa
      if (DSKQueue.isOpen() && activeTab === "lists" && detailId &&
          e.detail && e.detail.source && e.detail.source.type === "list" && e.detail.source.id === detailId) {
        renderListDetail();
      }
    });
    // idioma → re-render de lo visible
    document.addEventListener("dsk:lang", () => { applySource({ source: DSKQueue.snapshot().source }); if (DSKQueue.isOpen()) setTab(activeTab); const hm = $("#helpModal"); if (hm && hm.classList.contains("modal--open")) renderHelp(); });

    // botón de ayuda en el modal de opciones: cierra opciones y abre la ayuda
    const optHelp = $("#optHelp");
    if (optHelp) optHelp.addEventListener("click", () => { UI.closeModal("optionsModal"); renderHelp(); UI.openModal("helpModal"); });
    // el Kotlin avisa al añadir/quitar carpeta raíz
    window.DSKRootsChanged = function () { UI.toast(T("ex_root_added")); if (DSKQueue.isOpen() && activeTab === "explore" && !expStack.length) renderExplorer(); };
    // API mínima para que la pestaña Online añada resultados a una lista
    window.DSKLists = { add: openListPick };

    // Refresca la vista abierta al volver a la app: solo repinta con los datos
    // que ya tenemos (sin re-escanear la carpeta, eso es lo que congelaba la
    // UI con carpetas grandes). Las pistas que ya no existen se eliminan solas
    // al intentarse reproducir (ver skipMissingTrack en app.js).
    function refreshActive() {
      if (!DSKQueue.isOpen()) return;
      if (activeTab === "explore") {
        if (explorerSearchActive()) runExplorerSearch(expSearchQuery);
        else renderExplorer();
      } else if (activeTab === "lists") {
        renderLists();
      }
      // la cola ("Ahora") la repinta app.js con renderPlaylist()
    }
    window.DSKLib = { refresh: refreshActive };

    // al abrir la lista a pantalla completa, refrescar pestaña activa
    const plTitle = $("#plTitleBtn");
    if (plTitle) plTitle.addEventListener("click", () => setTimeout(() => { if (DSKQueue.isOpen()) openToCurrent(); }, 0));

    // registrar atrás jerárquico
    window.__dskBackStack = window.__dskBackStack || [];
    window.__dskBackStack.push(backHandler);

    // estado inicial de etiqueta + restauración de cola por URI
    applySource({ source: DSKQueue.snapshot().source });
    setTimeout(restoreUriQueue, 850);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();