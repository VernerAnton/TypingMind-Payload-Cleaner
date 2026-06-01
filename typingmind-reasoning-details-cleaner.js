/**
 * TypingMind Extension: Reasoning Details Cleaner
 * ────────────────────────────────────────────────
 * When TypingMind's "thinking" feature is used, extended reasoning output
 * gets stored in chat history as file attachments (reasoning_details_*.txt)
 * or as thinking content blocks. On subsequent messages these are included
 * in the outgoing payload, but the files are no longer resolvable, causing:
 *   "Unable to access the attachment reasoning_details_*.txt"
 *
 * This extension intercepts ALL outgoing OpenRouter requests and removes:
 *   - File/attachment content parts referencing reasoning_details_*.txt files
 *   - Content blocks of type "thinking" or "redacted_thinking"
 *   - Any assistant message that becomes empty after stripping
 *
 * Applies to every model — reasoning artifacts are never valid in follow-up
 * requests regardless of which model is being used.
 *
 * Recovery: if this extension causes problems, append ?safe_mode=1 to
 * your TypingMind URL to load without extensions, then remove it from
 * Settings → Advanced Settings → Extensions.
 */

(() => {
  // ── Guard against double-installation ──────────────────────────────────────
  if (window.__reasoningDetailsCleanerInstalled) {
    console.log("[reasoning-cleaner] Already installed, skipping.");
    return;
  }
  window.__reasoningDetailsCleanerInstalled = true;

  // ── Constants ──────────────────────────────────────────────────────────────
  const OPENROUTER_ENDPOINT = "openrouter.ai/api/v1/chat/completions";
  const REASONING_FILE_RE = /reasoning_details_/i;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function isReasoningFilePart(part) {
    if (!part || typeof part !== "object") return false;
    // type: "file" with a filename matching the pattern
    if (part.type === "file") {
      const name =
        part.file?.filename ?? part.file?.name ?? part.filename ?? part.name ?? "";
      return REASONING_FILE_RE.test(name);
    }
    // Some formats embed it as an attachment object directly
    if (part.type === "attachment" || part.type === "document") {
      const name = part.filename ?? part.name ?? part.title ?? "";
      return REASONING_FILE_RE.test(name);
    }
    return false;
  }

  function isThinkingPart(part) {
    if (!part || typeof part !== "object") return false;
    return part.type === "thinking" || part.type === "redacted_thinking";
  }

  // ── Core sanitizer ─────────────────────────────────────────────────────────
  function cleanPayload(payload) {
    const messages = payload.messages;
    if (!Array.isArray(messages) || messages.length === 0) return payload;

    let changed = false;
    const sanitized = [];

    for (const msg of messages) {
      // Only process messages with array content — plain strings are fine
      if (!Array.isArray(msg.content)) {
        sanitized.push(msg);
        continue;
      }

      const filtered = msg.content.filter((part) => {
        if (isThinkingPart(part)) {
          console.log(`[reasoning-cleaner] Removed ${part.type} block from ${msg.role} message`);
          changed = true;
          return false;
        }
        if (isReasoningFilePart(part)) {
          console.log("[reasoning-cleaner] Removed reasoning_details attachment from message");
          changed = true;
          return false;
        }
        return true;
      });

      // Drop message entirely if nothing meaningful remains
      if (filtered.length === 0) {
        console.log(`[reasoning-cleaner] Dropped ${msg.role} message that was reasoning-only`);
        changed = true;
        continue;
      }

      // Unwrap single text part to a plain string
      if (filtered.length === 1 && filtered[0]?.type === "text") {
        sanitized.push({ ...msg, content: filtered[0].text });
      } else {
        sanitized.push({ ...msg, content: filtered });
      }
    }

    if (!changed) return payload;

    console.log(
      `[reasoning-cleaner] Sanitized payload: ${messages.length} → ${sanitized.length} messages`
    );

    return { ...payload, messages: sanitized };
  }

  // ── Fetch interceptor ──────────────────────────────────────────────────────
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

      const cleaned = cleanPayload(payload);

      if (cleaned === payload) {
        return originalFetch(input, init);
      }

      const newInit = {
        ...(init ?? {}),
        body: JSON.stringify(cleaned),
      };

      const target = input instanceof Request ? input.url : input;
      return originalFetch(target, newInit);
    } catch (err) {
      console.error("[reasoning-cleaner] Error, passing through:", err);
      return originalFetch(input, init);
    }
  };

  console.log("✅ [reasoning-cleaner] Reasoning details cleaner installed.");
})();
