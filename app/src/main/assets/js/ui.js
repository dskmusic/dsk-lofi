/* =============================================================================
   DSK•LoFi — ui.js
   UI primitives: modals, confirm dialog, toasts, custom sliders, collapsible
   sections, segmented controls. No native dialogs anywhere.
   ========================================================================== */
(function () {
  "use strict";
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ============================ MODALS ============================ */
  let openCount = 0;

  function openModal(id) {
    const m = $("#" + id);
    if (!m) return;
    m.classList.add("modal--open");
    m.setAttribute("aria-hidden", "false");
    openCount++;
    document.body.classList.add("has-modal");
  }

  function closeModal(id) {
    const m = $("#" + id);
    if (!m || !m.classList.contains("modal--open")) return;
    m.classList.remove("modal--open");
    m.setAttribute("aria-hidden", "true");
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) document.body.classList.remove("has-modal");
  }

  /* scrim + [data-close] wiring */
  document.addEventListener("click", (e) => {
    const closer = e.target.closest("[data-close]");
    if (closer) { closeModal(closer.getAttribute("data-close")); return; }
    if (e.target.classList && e.target.classList.contains("modal__scrim")) {
      const m = e.target.closest(".modal");
      if (m && !m.hasAttribute("data-static")) closeModal(m.id);
    }
  });

  /* ---- promise-based confirm ---- */
  function confirmDialog(opts) {
    return new Promise((resolve) => {
      $("#confirmTitle").textContent = opts.title;
      $("#confirmMsg").textContent = opts.message;
      const okBtn = $("#confirmOk");
      okBtn.textContent = opts.confirmLabel || I18n.t("confirm");
      okBtn.classList.toggle("btn--danger", !!opts.danger);
      $("#confirmCancel").textContent = opts.cancelLabel || I18n.t("cancel");

      const done = (val) => {
        okBtn.onclick = null;
        $("#confirmCancel").onclick = null;
        closeModal("confirmModal");
        resolve(val);
      };
      okBtn.onclick = () => done(true);
      $("#confirmCancel").onclick = () => done(false);
      openModal("confirmModal");
    });
  }

  function errorDialog(message) {
    $("#errorMsg").textContent = message;
    openModal("errorModal");
  }

  /* ============================ TOASTS ============================ */
  function toast(msg, kind, duration) {
    const host = $("#toasts");
    const el = document.createElement("div");
    el.className = "toast" + (kind ? " toast--" + kind : "");
    el.innerHTML = '<span class="toast__dot"></span><span class="toast__msg"></span>';
    el.querySelector(".toast__msg").textContent = msg;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("toast--in"));
    setTimeout(() => {
      el.classList.remove("toast--in");
      setTimeout(() => el.remove(), 350);
    }, duration || 2400);
  }

  /* ============================ SLIDERS ============================ */
  /**
   * cfg: { key, labelKey, value (0..1), format(v)->string, onInput(v) }
   * Returns { el, set(v), key }
   */
  function slider(cfg) {
    const wrap = document.createElement("div");
    wrap.className = "param";
    wrap.innerHTML =
      '<div class="param__head">' +
      '  <span class="param__label" data-i18n="' + cfg.labelKey + '"></span>' +
      '  <span class="param__val"></span>' +
      "</div>" +
      '<input class="param__range" type="range" min="0" max="1000" step="1">';

    const range = wrap.querySelector(".param__range");
    const val = wrap.querySelector(".param__val");
    const fmt = cfg.format || ((v) => Math.round(v * 100) + "%");

    function paint(v) {
      val.textContent = fmt(v);
      range.style.setProperty("--fill", (v * 100).toFixed(1) + "%");
    }

    range.addEventListener("input", () => {
      const v = range.value / 1000;
      paint(v);
      if (cfg.onInput) cfg.onInput(v);
    });

    /* double-tap the label row resets just this param */
    let lastTap = 0;
    wrap.querySelector(".param__head").addEventListener("click", () => {
      const now = Date.now();
      if (now - lastTap < 350 && cfg.onReset) cfg.onReset();
      lastTap = now;
    });

    const api = {
      el: wrap,
      key: cfg.key,
      set(v) {
        range.value = Math.round(v * 1000);
        paint(v);
      }
    };
    api.set(cfg.value || 0);
    return api;
  }

  /* ============================ COLLAPSIBLE SECTIONS ============================ */
  function initCollapsibles() {
    $$(".fx").forEach((sec) => {
      const head = $(".fx__head", sec);
      head.addEventListener("click", (e) => {
        if (e.target.closest(".switch") || e.target.closest(".fx__reset")) return;
        sec.classList.toggle("fx--collapsed");
      });
    });
  }

  /* ============================ SEGMENTED ============================ */
  /**
   * host element with .seg__item children carrying data-val.
   * onChange(val). Returns { set(val) }.
   */
  function segmented(host, onChange) {
    function set(val) {
      $$(".seg__item", host).forEach((b) =>
        b.classList.toggle("seg__item--active", b.getAttribute("data-val") === String(val))
      );
    }
    host.addEventListener("click", (e) => {
      const b = e.target.closest(".seg__item");
      if (!b) return;
      set(b.getAttribute("data-val"));
      onChange(b.getAttribute("data-val"));
    });
    return { set };
  }

  /* ============================ PRESET CHIPS ============================ */
  /**
   * cfg: { host, presets: [{id, labelKey, values}], onApply(preset) }
   */
  function presetRow(cfg) {
    cfg.host.innerHTML = "";
    cfg.presets.forEach((p) => {
      const b = document.createElement("button");
      b.className = "chip";
      b.setAttribute("data-preset", p.id);
      b.setAttribute("data-i18n", p.labelKey);
      b.textContent = I18n.t(p.labelKey);
      b.addEventListener("click", () => {
        mark(p.id);
        cfg.onApply(p);
      });
      cfg.host.appendChild(b);
    });
    function mark(id) {
      $$(".chip", cfg.host).forEach((c) =>
        c.classList.toggle("chip--active", c.getAttribute("data-preset") === id)
      );
    }
    return { mark, clear: () => mark("__none__") };
  }

  window.UI = {
    $, $$,
    openModal, closeModal,
    confirm: confirmDialog,
    error: errorDialog,
    toast,
    slider,
    segmented,
    presetRow,
    initCollapsibles
  };
})();