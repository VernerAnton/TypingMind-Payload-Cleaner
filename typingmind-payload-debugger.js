/**
 * TypingMind Extension: Payload Debugger (TEMPORARY — remove after debugging)
 * ────────────────────────────────────────────────────────────────────────────
 * The reasoning_details error is thrown BEFORE fetch is called, meaning
 * TypingMind resolves attachments from IndexedDB first. This debugger patches
 * IndexedDB to log every read so we can see exactly what key TM looks up
 * for the reasoning attachment.
 *
 * HOW TO USE:
 *   1. Install this extension in TypingMind
 *   2. Open browser DevTools → Console tab
 *   3. Reproduce the problem (send a message after using the thinking feature)
 *   4. Look for lines starting with [idb-debugger] — especially any that
 *      mention "reasoning" or show a UUID matching the attachment filename
 *   5. Screenshot or copy those log lines and share them
 *
 * Remove this extension once debugging is done.
 */

(() => {
  if (window.__payloadDebuggerInstalled) {
    console.log("[payload-debugger] Already installed, skipping.");
    return;
  }
  window.__payloadDebuggerInstalled = true;

  // ── IndexedDB read interceptor ─────────────────────────────────────────────
  // Wraps IDBObjectStore.get to log every key TM reads from IDB.
  // This fires during attachment resolution, before fetch is ever called.
  const originalIDBGet = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (key) {
    const storeName = this.name;
    const request = originalIDBGet.call(this, key);

    const keyStr = typeof key === "string" ? key : JSON.stringify(key);

    // Log everything so nothing is missed, but highlight likely attachment reads
    const isInteresting =
      typeof keyStr === "string" &&
      (keyStr.includes("reasoning") ||
        keyStr.includes("attachment") ||
        keyStr.includes("file") ||
        // UUID pattern — TM uses UUIDs as attachment keys
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(keyStr));

    if (isInteresting) {
      console.warn(`[idb-debugger] ⚠️  IDB GET  store="${storeName}"  key=${keyStr}`);
    } else {
      console.log(`[idb-debugger] IDB GET  store="${storeName}"  key=${keyStr}`);
    }

    request.addEventListener("success", () => {
      if (isInteresting) {
        console.warn(`[idb-debugger] ⚠️  IDB RESULT  store="${storeName}"  key=${keyStr}  result=`, request.result);
      }
    });

    request.addEventListener("error", () => {
      console.error(`[idb-debugger] IDB ERROR  store="${storeName}"  key=${keyStr}`, request.error);
    });

    return request;
  };

  // ── Also patch IDBObjectStore.getAll for completeness ─────────────────────
  const originalGetAll = IDBObjectStore.prototype.getAll;
  IDBObjectStore.prototype.getAll = function (query) {
    const storeName = this.name;
    console.log(`[idb-debugger] IDB GETALL  store="${storeName}"  query=`, query ?? "(none)");
    return originalGetAll.apply(this, arguments);
  };

  // ── Fetch interceptor (kept as fallback) ───────────────────────────────────
  const OPENROUTER_ENDPOINT = "openrouter.ai/api/v1/chat/completions";
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    try {
      const url =
        input instanceof Request
          ? input.url
          : typeof input === "string"
          ? input
          : input?.toString?.() ?? "";

      if (url.includes(OPENROUTER_ENDPOINT)) {
        let bodyText;
        if (init && typeof init.body === "string") {
          bodyText = init.body;
        } else if (input instanceof Request) {
          bodyText = await input.clone().text();
        }
        if (bodyText) {
          try {
            const payload = JSON.parse(bodyText);
            console.group(`[payload-debugger] Outgoing fetch → model: ${payload?.model ?? "unknown"}`);
            console.log("Full payload:", JSON.parse(JSON.stringify(payload)));
            console.groupEnd();
          } catch {}
        }
      }
    } catch (err) {
      console.error("[payload-debugger] Fetch logging error:", err);
    }

    return originalFetch(input, init);
  };

  console.log("✅ [payload-debugger] IDB + fetch debugger installed. Reproduce the issue and share the [idb-debugger] ⚠️ lines.");
})();
