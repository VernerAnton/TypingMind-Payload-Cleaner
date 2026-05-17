/**
 * TypingMind Extension: Image Stripper for Unsupported Chinese Models
 * ──────────────────────────────────────────────────────────────────
 * Most Chinese models served via OpenRouter do not support vision/image
 * inputs and will error if the payload contains image content. This
 * extension intercepts outgoing fetch requests to OpenRouter and removes
 * all image parts from the message history before they reach those models.
 *
 * What it removes:
 *   - Any content part with type "image_url" inside a user message
 *   - Any content part with type "image" inside a user message
 *   - If a user message's content array becomes empty after stripping,
 *     the message is dropped entirely
 *
 * What it leaves untouched:
 *   - Text content in all messages
 *   - System and assistant messages (they don't carry images)
 *   - Any request going to a model NOT in the blocklist below
 *   - Kimi and other Chinese models that DO support vision
 *
 * Recovery: if this extension causes problems, append ?safe_mode=1 to
 * your TypingMind URL to load without extensions, then remove it from
 * Settings → Advanced Settings → Extensions.
 */

(() => {
  // ── Guard against double-installation ──────────────────────────────────────
  if (window.__chineseModelImageStripperInstalled) {
    console.log("[chinese-image-stripper] Already installed, skipping.");
    return;
  }
  window.__chineseModelImageStripperInstalled = true;

  // ── Constants ──────────────────────────────────────────────────────────────
  const OPENROUTER_ENDPOINT = "openrouter.ai/api/v1/chat/completions";

  // Models that do NOT support images — add/remove as needed.
  // Use the exact OpenRouter model ID prefix or full ID (case-insensitive).
  // Kimi (moonshot/*) and vision-capable Xiaomi models are intentionally excluded.
  const IMAGE_UNSUPPORTED_MODELS = [
    "deepseek/",
    "minimax/",
  ];

  // Build a fast lookup set (lower-cased)
  const blocklist = new Set(IMAGE_UNSUPPORTED_MODELS.map((m) => m.toLowerCase()));

  function isBlocklisted(model) {
    if (!model) return false;
    const m = model.toLowerCase();
    // Match exact ID or any entry that is a prefix of the model ID
    for (const entry of blocklist) {
      if (m === entry || m.startsWith(entry + "/") || m.startsWith(entry + ":")) {
        return true;
      }
    }
    return false;
  }

  // ── Core sanitizer ─────────────────────────────────────────────────────────
  function stripImages(payload) {
    const messages = payload.messages;
    if (!Array.isArray(messages) || messages.length === 0) return payload;

    let changed = false;
    const sanitized = [];

    for (const msg of messages) {
      // Only user messages can carry image content
      if (msg.role !== "user" || !Array.isArray(msg.content)) {
        sanitized.push(msg);
        continue;
      }

      const filtered = msg.content.filter((part) => {
        if (part?.type === "image_url" || part?.type === "image") {
          console.log("[chinese-image-stripper] Removed image part from user message");
          changed = true;
          return false;
        }
        return true;
      });

      // Drop the message entirely if nothing remains
      if (filtered.length === 0) {
        console.log("[chinese-image-stripper] Dropped user message that was image-only");
        changed = true;
        continue;
      }

      // If only one text part remains, unwrap to a plain string for cleanliness
      if (filtered.length === 1 && filtered[0]?.type === "text") {
        sanitized.push({ ...msg, content: filtered[0].text });
      } else {
        sanitized.push({ ...msg, content: filtered });
      }
    }

    if (!changed) return payload;

    console.log(
      `[chinese-image-stripper] Sanitized payload: ${messages.length} → ${sanitized.length} messages`
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

      if (!isBlocklisted(payload?.model ?? "")) {
        return originalFetch(input, init);
      }

      const sanitized = stripImages(payload);

      if (sanitized === payload) {
        return originalFetch(input, init);
      }

      const newInit = {
        ...(init ?? {}),
        body: JSON.stringify(sanitized),
      };

      const target = input instanceof Request ? input.url : input;
      return originalFetch(target, newInit);
    } catch (err) {
      console.error("[chinese-image-stripper] Error, passing through:", err);
      return originalFetch(input, init);
    }
  };

  console.log("✅ [chinese-image-stripper] Image stripper for unsupported Chinese models installed.");
})();
