/**
 * TypingMind Extension: Payload Debugger (TEMPORARY — remove after debugging)
 * ────────────────────────────────────────────────────────────────────────────
 * Logs every outgoing OpenRouter payload to the browser console in full.
 * Does NOT modify anything — purely observational.
 *
 * HOW TO USE:
 *   1. Install this extension in TypingMind
 *   2. Open browser DevTools → Console tab
 *   3. Reproduce the problem (send a message after using the thinking feature)
 *   4. Look for the log lines starting with [payload-debugger]
 *   5. Expand the logged object and copy the full payload
 *   6. Share it so the cleaner rules can be fixed
 *
 * Remove this extension once debugging is done.
 */

(() => {
  if (window.__payloadDebuggerInstalled) {
    console.log("[payload-debugger] Already installed, skipping.");
    return;
  }
  window.__payloadDebuggerInstalled = true;

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

      if (!url.includes(OPENROUTER_ENDPOINT)) {
        return originalFetch(input, init);
      }

      let bodyText;
      if (init && typeof init.body === "string") {
        bodyText = init.body;
      } else if (input instanceof Request) {
        bodyText = await input.clone().text();
      } else {
        return originalFetch(input, init);
      }

      let payload;
      try {
        payload = JSON.parse(bodyText);
      } catch {
        return originalFetch(input, init);
      }

      console.group(`[payload-debugger] Outgoing request → model: ${payload?.model ?? "unknown"}`);
      console.log("Full payload:", JSON.parse(JSON.stringify(payload)));
      console.log("Messages count:", payload?.messages?.length ?? 0);

      if (Array.isArray(payload?.messages)) {
        payload.messages.forEach((msg, i) => {
          const contentSummary = Array.isArray(msg.content)
            ? msg.content.map((p) => p?.type ?? typeof p).join(", ")
            : typeof msg.content;
          console.log(`  [${i}] role=${msg.role} | content: ${contentSummary}`);

          // Highlight any part that might be a reasoning attachment
          if (Array.isArray(msg.content)) {
            msg.content.forEach((part, j) => {
              if (part && typeof part === "object" && part.type !== "text") {
                console.warn(`    ⚠️  Non-text part at messages[${i}].content[${j}]:`, JSON.parse(JSON.stringify(part)));
              }
            });
          }
        });
      }

      console.groupEnd();
    } catch (err) {
      console.error("[payload-debugger] Error during logging:", err);
    }

    // Always pass through unmodified
    return originalFetch(input, init);
  };

  console.log("✅ [payload-debugger] Payload debugger installed. Open DevTools Console and reproduce the issue.");
})();
