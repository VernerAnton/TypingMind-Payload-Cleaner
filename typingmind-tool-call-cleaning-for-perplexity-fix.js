/**
 * TypingMind Extension: Tool Call Sanitizer for Perplexity
 * ─────────────────────────────────────────────────────────
 * Perplexity models reject any payload containing tool/function call
 * structures in the chat history. This extension intercepts outgoing
 * fetch requests to OpenRouter and strips ALL tool-related blocks
 * from the message history before they reach Perplexity.
 *
 * What it removes:
 *   - Any message where role is "tool" or "function"
 *   - The tool_calls array from any assistant message
 *   - Any assistant message that becomes empty after tool_calls are removed
 *
 * What it leaves untouched:
 *   - All user messages
 *   - All system messages
 *   - Assistant messages that have text content
 *   - Any request going to a non-Perplexity model
 *
 * Recovery: if this extension causes problems, append ?safe_mode=1 to
 * your TypingMind URL to load without extensions, then remove it from
 * Settings → Advanced Settings → Extensions.
 */

(() => {
  // ── Guard against double-installation ──────────────────────────────────────
  if (window.__perplexityToolSanitizerInstalled) {
    console.log("[perplexity-tool-sanitizer] Already installed, skipping.");
    return;
  }
  window.__perplexityToolSanitizerInstalled = true;

  // ── Constants ──────────────────────────────────────────────────────────────
  const OPENROUTER_ENDPOINT = "openrouter.ai/api/v1/chat/completions";
  const PERPLEXITY_MODEL_RE = /^perplexity\//i;

  // ── Core sanitizer ─────────────────────────────────────────────────────────
  function sanitizePayload(payload) {
    const messages = payload.messages;
    if (!Array.isArray(messages) || messages.length === 0) return payload;

    const sanitized = [];

    for (const msg of messages) {
      // Drop all tool and function result messages entirely
      if (msg.role === "tool" || msg.role === "function") {
        console.log(`[perplexity-tool-sanitizer] Dropped ${msg.role} message`);
        continue;
      }

      // Clean assistant messages
      if (msg.role === "assistant") {
        const cleaned = { ...msg };

        // Remove tool_calls if present
        if (Array.isArray(cleaned.tool_calls)) {
          delete cleaned.tool_calls;
        }

        // Remove function_call if present (legacy format)
        if (cleaned.function_call) {
          delete cleaned.function_call;
        }

        // Drop the message entirely if nothing meaningful remains
        const hasContent =
          typeof cleaned.content === "string"
            ? cleaned.content.trim().length > 0
            : cleaned.content != null;

        if (!hasContent) {
          console.log("[perplexity-tool-sanitizer] Dropped empty assistant message");
          continue;
        }

        sanitized.push(cleaned);
        continue;
      }

      // All other messages (user, system) pass through untouched
      sanitized.push(msg);
    }

    if (sanitized.length === messages.length) return payload;

    console.log(
      `[perplexity-tool-sanitizer] Sanitized payload: ${messages.length} → ${sanitized.length} messages`
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

      if (!PERPLEXITY_MODEL_RE.test(payload?.model ?? "")) {
        return originalFetch(input, init);
      }

      const sanitized = sanitizePayload(payload);

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
      console.error("[perplexity-tool-sanitizer] Error, passing through:", err);
      return originalFetch(input, init);
    }
  };

  console.log("✅ [perplexity-tool-sanitizer] Tool call sanitizer for Perplexity installed.");
})();
