/* =============================================================================
   DSK•LoFi — bridge.js
   Abstraction over the Android/Kotlin WebView bridge.

   KOTLIN CONTRACT (see README.md for the full snippet):
     webView.addJavascriptInterface(DskBridge(context), "DSKBridge")

     class DskBridge {
       @JavascriptInterface fun saveFile(name: String, base64: String, mime: String)
       // writes the decoded bytes to  <public storage>/DSKlofi/<name>
       @JavascriptInterface fun appVersion(): String   // optional
     }

   When window.DSKBridge is absent (plain browser / PWA), saving falls back
   to a normal download — same API either way.
   ========================================================================== */
(function () {
  "use strict";

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = String(r.result);
        resolve(s.slice(s.indexOf(",") + 1));
      };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  window.Bridge = {
    get native() {
      return typeof window.DSKBridge !== "undefined" &&
             typeof window.DSKBridge.saveFile === "function";
    },

    /** Save a Blob. Returns "bridge" (saved to /DSKlofi) or "web" (download). */
    async save(filename, blob) {
      if (this.native) {
        const b64 = await blobToBase64(blob);
        window.DSKBridge.saveFile(filename, b64, blob.type || "application/octet-stream");
        return "bridge";
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return "web";
    }
  };
})();
