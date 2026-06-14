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
    up: '<svg class="ic" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"></path></svg>'
  };
  const stripExt = (s) => (s || "").replace(/\.[^.]+$/, "");

  /* ============================ AYUDA (bilingüe) ============================ */
  const HELP = {
    es:
      '<h4>Cargar música</h4>' +
      '<p>Toca la pantalla de inicio para abrir un <b>archivo</b> (se carga también el resto de su carpeta), o pulsa <b>Cargar carpeta</b> para elegir una carpeta entera.</p>' +
      '<h4>Reproducción</h4>' +
      '<p>Play/pausa, anterior/siguiente, <b>aleatorio</b> y velocidad. Toca el título de la lista para abrir la vista a pantalla completa.</p>' +
      '<h4>Lista, Archivos y Listas</h4>' +
      '<p>En esa vista hay tres pestañas: <b>En curso</b> (la cola actual), <b>Archivos</b> (explorador de carpetas) y <b>Listas</b> (crea y edita tus listas). El botón <b>⋮</b> de cada pista permite reproducir ahora, en siguiente, al final o añadir a una lista.</p>' +
      '<h4>Efectos LoFi</h4>' +
      '<p>Motor lofi, reverb, delay y chorus, cada uno con presets. Doble toque en el nombre de un control lo restablece. Usa <b>Presets</b> para guardar tus combinaciones.</p>' +
      '<h4>Visualizador</h4>' +
      '<p>Pulsa el ojo para elegir entre varios visualizadores y activar la <b>carátula de fondo</b> difuminada.</p>' +
      '<h4>Letras</h4>' +
      '<p>Pulsa <b>LETRA</b> (arriba a la izquierda del visualizador) para buscar la letra de la canción. Elige la fuente entre <b>LRCLIB</b>, <b>Genius</b> y <b>NetEase</b>. Si hay versión sincronizada, cambia entre <b>PLANA</b> y <b>SINCRO</b> (resaltado al ritmo). Desde el modal puedes <b>compartir</b> (toda la letra o una selección) y guardar en <b>PDF</b>. Tocar el título entre las bobinas lo copia al portapapeles.</p>' +
      '<h4>Online (YouTube)</h4>' +
      '<p>En la pestaña <b>Online</b> de la biblioteca puedes buscar música en YouTube y reproducir <b>solo el audio</b>, además de añadirla a tus listas. Las listas guardan la canción y se vuelve a obtener al reproducir.</p>' +
      '<h4>Anular voz (karaoke)</h4>' +
      '<p>En el modo reproductor aparece un botón de <b>micrófono</b> (también dentro del modal de letras) que atenúa la voz centrada de la canción. Es aproximado: funciona mejor en pistas en estéreo.</p>' +
      '<h4>Exportar</h4>' +
      '<p>Renderiza la pista con los efectos aplicados a WAV o MP3. En la app se guarda en la carpeta <b>/DSKlofi</b>.</p>' +
      '<h4>Identificar canción</h4>' +
      '<p>Pulsa el icono de <b>micrófono</b> (abajo a la derecha del visualizador) para identificar la canción que esté sonando alrededor, tipo Shazam. Escucha 6 segundos y muestra carátula, título y artista. Desde el resultado puedes <b>buscar online</b> esa canción o <b>compartirla</b>. Necesitas configurar un token gratuito de <b>AudD.io</b> en Opciones.</p>' +
      '<h4>Más</h4>' +
      '<p>Temporizador de apagado, temas claro/oscuro, idioma y <b>modo reproductor</b> (sin efectos, arranque instantáneo) en Opciones.</p>',
    en:
      '<h4>Load music</h4>' +
      '<p>Tap the start screen to open a <b>file</b> (the rest of its folder loads too), or tap <b>Load folder</b> to pick a whole folder.</p>' +
      '<h4>Playback</h4>' +
      '<p>Play/pause, previous/next, <b>shuffle</b> and speed. Tap the playlist title to open the full-screen view.</p>' +
      '<h4>Queue, Files and Playlists</h4>' +
      '<p>That view has three tabs: <b>Queue</b> (current list), <b>Files</b> (folder browser) and <b>Playlists</b> (create and edit your lists). Each track\'s <b>⋮</b> button lets you play now, play next, add to end or add to a playlist.</p>' +
      '<h4>LoFi effects</h4>' +
      '<p>LoFi engine, reverb, delay and chorus, each with presets. Double-tap a control name to reset it. Use <b>Presets</b> to save your combinations.</p>' +
      '<h4>Visualizer</h4>' +
      '<p>Tap the eye to pick a visualizer and turn on the blurred <b>cover backdrop</b>.</p>' +
      '<h4>Lyrics</h4>' +
      '<p>Tap <b>LYRIC</b> (top-left of the visualizer) to search a song\'s lyrics. Pick the source between <b>LRCLIB</b>, <b>Genius</b> and <b>NetEase</b>. When a synced version exists, switch between <b>PLAIN</b> and <b>SYNCED</b> (highlighted to the beat). From the modal you can <b>share</b> (the whole lyrics or a selection) and save a <b>PDF</b>. Tapping the title between the reels copies it to the clipboard.</p>' +
      '<h4>Online (YouTube)</h4>' +
      '<p>In the library\'s <b>Online</b> tab you can search YouTube and play <b>audio only</b>, and add tracks to your lists. Lists store the song and re-fetch it on play.</p>' +
      '<h4>Vocal removal (karaoke)</h4>' +
      '<p>In player-only mode a <b>microphone</b> button appears (also inside the lyrics modal) that attenuates the song\'s centered vocal. It\'s approximate and works best on stereo tracks.</p>' +
      '<h4>Export</h4>' +
      '<p>Render the track with the applied effects to WAV or MP3. In the app it is saved to the <b>/DSKlofi</b> folder.</p>' +
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
  let activeTab = "now";
  function setTab(tab) {
    activeTab = tab;
    $$(".lib-tab").forEach((b) => b.classList.toggle("lib-tab--active", b.getAttribute("data-tab") === tab));
    $$(".lib-panel").forEach((p) => p.classList.toggle("lib-panel--active", p.getAttribute("data-panel") === tab));
    if (tab === "explore") renderExplorer();
    if (tab === "lists") renderLists();
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
  }

  /* elegir lista destino (o crear nueva) */
  function openListPick(item) {
    if (!item) return;
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
      const l = { id: newId(), name: name, items: [normItem(item)] };
      const lists = loadLists(); lists.push(l); saveLists(lists);
      UI.toast(T("list_created"));
    }), true);
    loadLists().forEach((l) => mk(l.name + "  ·  " + countLabel(l.items.length), () => {
      const lists = loadLists(); const t = lists.find((x) => x.id === l.id);
      if (t) { t.items.push(normItem(item)); saveLists(lists); UI.toast(T("q_added_list")); if (activeTab === "lists") renderLists(); }
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

  /* ============================ EXPLORADOR ============================ */
  // pila de navegación: cada nivel { uri|null (null=raíces), name, entries:[] }
  let expStack = [];
  function explorerSupported() { return hasBridge("listRoots") && hasBridge("browse"); }

  function renderExplorer() {
    const list = $("#libExpItems");
    if (!explorerSupported()) {
      list.innerHTML = '<div class="lib-empty">' + T("ex_no_roots") + "</div>";
      $("#libUp").hidden = true; $("#libPath").textContent = ""; return;
    }
    if (!expStack.length) {
      // nivel raíces
      let roots = [];
      try { roots = JSON.parse(window.DSKBridge.listRoots() || "[]"); } catch (e) {}
      $("#libUp").hidden = true;
      $("#libPath").textContent = T("ex_roots");
      list.innerHTML = "";
      if (!roots.length) { list.innerHTML = '<div class="lib-empty">' + T("ex_no_roots") + "</div>"; return; }
      roots.forEach((r) => list.appendChild(rootRow(r)));
      return;
    }
    const lvl = expStack[expStack.length - 1];
    $("#libUp").hidden = false;
    $("#libPath").textContent = lvl.name;
    list.innerHTML = "";
    if (!lvl.entries.length) { list.innerHTML = '<div class="lib-empty">' + T("ex_empty") + "</div>"; return; }
    lvl.entries.forEach((e, i) => list.appendChild(e.dir ? folderRow(e) : audioRow(e, i)));
  }

  function rootRow(r) {
    const row = document.createElement("div");
    row.className = "lib-row lib-row--folder";
    row.innerHTML = '<span class="lib-row__ic">' + IC.folder + '</span><span class="lib-row__name"></span>' +
      '<button class="lib-row__act" type="button" aria-label="' + T("ex_remove_root") + '">&times;</button>';
    row.querySelector(".lib-row__name").textContent = r.name;
    row.addEventListener("click", () => enterFolder(r.uri, r.name));
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
      '<button class="lib-row__act" type="button" aria-label="' + T("ex_play_folder") + '">' + IC.play + '</button>';
    row.querySelector(".lib-row__name").textContent = e.name;
    row.addEventListener("click", () => enterFolder(e.uri, e.name));
    row.querySelector(".lib-row__act").addEventListener("click", (ev) => { ev.stopPropagation(); playFolderUri(e.uri, e.name); });
    return row;
  }
  function audioRow(e, i) {
    const row = document.createElement("div");
    row.className = "lib-row lib-row--audio";
    row.innerHTML = '<span class="lib-row__ic">' + IC.audio + '</span><span class="lib-row__name"></span>' +
      '<button class="lib-row__act" type="button" aria-label="…">' + IC.dots + '</button>';
    row.querySelector(".lib-row__name").textContent = stripExt(e.name);
    row.addEventListener("click", () => playExplorerAudio(i));
    row.querySelector(".lib-row__act").addEventListener("click", (ev) => {
      ev.stopPropagation();
      openTrackMenu({ kind: "explorer", index: i, item: { name: e.name, uri: e.uri, path: e.path || null } });
    });
    return row;
  }

  function enterFolder(uri, name) {
    let entries = [];
    try { entries = JSON.parse(window.DSKBridge.browse(uri) || "[]"); } catch (e) {}
    expStack.push({ uri: uri, name: name, entries: entries });
    renderExplorer();
  }
  function explorerUp() {
    if (!expStack.length) return false;
    expStack.pop();
    renderExplorer();
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
  function showListsIndex() { detailId = null; $("#libListsIndex").hidden = false; $("#libListDetail").hidden = true; }
  function showListDetail(id) { detailId = id; $("#libListsIndex").hidden = true; $("#libListDetail").hidden = false; renderListDetail(); }

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
      row.querySelector(".lib-row__sub").textContent = countLabel(l.items.length);
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
    if (!l.items.length) { host.innerHTML = '<div class="lib-empty">' + T("list_empty") + "</div>"; return; }
    // ¿qué pista de ESTA lista está sonando ahora?
    const snap = DSKQueue.snapshot();
    const activeUri = (snap.source && snap.source.type === "list" && snap.source.id === detailId &&
                       snap.index >= 0 && snap.items[snap.index]) ? snap.items[snap.index].uri : null;
    l.items.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "lib-row lib-row--audio" + (activeUri && it.uri === activeUri ? " lib-row--active" : "");
      row.innerHTML = '<span class="lib-row__ord"></span><span class="lib-row__name"></span>' +
        '<button class="lib-row__mv" data-d="-1" type="button" aria-label="▲">▲</button>' +
        '<button class="lib-row__mv" data-d="1" type="button" aria-label="▼">▼</button>' +
        '<button class="lib-row__act" type="button" aria-label="…">' + IC.dots + '</button>';
      row.querySelector(".lib-row__ord").textContent = (i + 1);
      row.querySelector(".lib-row__name").textContent = stripExt(it.name);
      row.addEventListener("click", () => playList(detailId, i));
      row.querySelectorAll(".lib-row__mv").forEach((mb) => mb.addEventListener("click", (e) => {
        e.stopPropagation(); listMove(detailId, i, parseInt(mb.getAttribute("data-d"), 10));
      }));
      row.querySelector(".lib-row__act").addEventListener("click", (e) => {
        e.stopPropagation();
        openTrackMenu({ kind: "list", index: i, listId: detailId, item: { name: it.name, uri: it.uri, ytId: it.ytId || null, uploader: it.uploader || null, thumb: it.thumb || null } });
      });
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

  /* ============================ MINI-LISTA: etiqueta de fuente ============================ */
  function sourceLabel(src) {
    if (!src || src.type === "none") return T("playlist");
    if (src.name) return src.name;
    if (src.type === "folder") return T("src_folder");
    if (src.type === "list") return T("src_list");
    if (src.type === "file") return T("src_file");
    return T("playlist");
  }
  function applySource(detail) {
    const label = sourceLabel(detail && detail.source);
    const btn = $("#plTitleBtn");
    if (btn) { const txt = btn.querySelector(".playlist__title-txt"); if (txt) txt.textContent = label; else btn.textContent = label; }
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
      if (!d || !Array.isArray(d.uris) || !d.uris.some((u) => u)) return;
      const items = (d.names || []).map((n, i) => ({ name: n, uri: d.uris[i] })).filter((x) => x.uri);
      if (!items.length) return;
      DSKQueue.load(items, d.index || 0, d.source || { type: "folder", name: T("src_folder") }, false);
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
    const sq = $("#libSaveQueue"); if (sq) sq.addEventListener("click", saveQueueAsList);
    const btnLibrary = $("#btnLibrary"); if (btnLibrary) btnLibrary.addEventListener("click", (e) => { e.stopPropagation(); DSKQueue.open(); setTab("lists"); });
    const nl = $("#libNewList"); if (nl) nl.addEventListener("click", () => askListName(null, (name) => { const lists = loadLists(); lists.push({ id: newId(), name: name, items: [] }); saveLists(lists); UI.toast(T("list_created")); renderLists(); }));
    const lb = $("#libListBack"); if (lb) lb.addEventListener("click", () => { showListsIndex(); renderLists(); });
    const lp = $("#libListPlay"); if (lp) lp.addEventListener("click", () => { if (detailId) playList(detailId, 0); });
    const ex = $("#libExport"); if (ex) ex.addEventListener("click", exportLists);
    const im = $("#libImport"); if (im) im.addEventListener("click", () => $("#libImportInput").click());
    const imi = $("#libImportInput"); if (imi) imi.addEventListener("change", (e) => { if (e.target.files[0]) importLists(e.target.files[0]); e.target.value = ""; });

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

    // Refresca la vista abierta al volver a la app (barato): re-escanea la carpeta
    // del explorador (refleja archivos añadidos/borrados) y re-dibuja listas.
    function refreshActive() {
      if (!DSKQueue.isOpen()) return;
      if (activeTab === "explore") {
        if (expStack.length) {
          const lvl = expStack[expStack.length - 1];
          let entries = [];
          try { entries = JSON.parse(window.DSKBridge.browse(lvl.uri) || "[]"); } catch (e) {}
          lvl.entries = entries;
        }
        renderExplorer();
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