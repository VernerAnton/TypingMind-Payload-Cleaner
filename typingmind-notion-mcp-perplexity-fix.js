/**
 * TypingMind Extension: Notion MCP Sanitizer for Perplexity
 * ──────────────────────────────────────────────────────────
 * When routing to any Perplexity model via OpenRouter, this extension
 * surgically removes Notion MCP tool blocks from the chat history so
 * that Perplexity's strict message schema doesn't throw a 400 error.
 *
 * What it does:
 *   - Removes Notion-specific entries from assistant `tool_calls` arrays
 *     (matched by function name containing "notion", case-insensitive)
 *   - Removes corresponding `role: "tool"` result messages by tracking
 *     the tool_call IDs that were stripped
 *   - Drops the entire assistant message if it becomes empty after removal
 *   - Leaves all other messages, tools, and non-Notion tool calls untouched
 *   - Fires ONLY on requests to OpenRouter completions with a Perplexity model
 *
 * What it does NOT do:
 *   - Does not touch non-Perplexity models
 *   - Does not touch non-Notion tool calls
 *   - Does not modify the `tools` / `tool_choice` parameters
 *   - Does not merge or re-order messages
 *
 * Recovery: if this extension causes problems, append ?safe_mode=1 to the
 * TypingMind URL to load without extensions, then remove it from settings.
 */

(() => {
  // ── Guard against double-installation ──────────────────────────────────────
  if (window.__notionMcpPerplexityFixInstalled) {
    console.log("[notion-mcp-fix] Already installed, skipping.");
    return;
  }
  window.__notionMcpPerplexityFixInstalled = true;

  // ── Constants ──────────────────────────────────────────────────────────────
  const OPENROUTER_ENDPOINT = "openrouter.ai/api/v1/chat/completions";

  // Matches any Perplexity model slug (e.g. perplexity/sonar-pro-search,
  // perplexity/sonar, perplexity/sonar-reasoning, etc.)
  const PERPLEXITY_MODEL_RE = /^perplexity\//i;

  // Matches Notion MCP tool names (notion-search, notion-fetch,
  // notion-update-page, notion_search, notionFetch, etc.)
  const NOTION_TOOL_RE = /notion/i;

  // ── Helper: is this a Notion MCP tool call? ────────────────────────────────
  function isNotionToolCall(toolCall) {
    const name = toolCall?.function?.name ?? "";
    return NOTION_TOOL_RE.test(name);
  }

  // ── Core sanitizer ─────────────────────────────────────────────────────────
  /**
   * Receives the parsed JSON payload and returns a sanitized copy.
   * Only called when model matches PERPLEXITY_MODEL_RE.
   */
  function sanitizePayload(payload) {
    const messages = payload.messages;
    if (!Array.isArray(messages) || messages.length === 0) return payload;

    // Pass 1 — walk assistant messages, strip Notion tool_calls,
    //           collect the IDs of removed calls for pass 2.
    const removedToolCallIds = new Set();
    const afterPass1 = [];

    for (const msg of messages) {
      // Only assistant messages can carry tool_calls
      if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
        const keptCalls = [];
        const droppedCalls = [];

        for (const tc of msg.tool_calls) {
          if (isNotionToolCall(tc)) {
            droppedCalls.push(tc);
            if (tc.id) removedToolCallIds.add(tc.id);
          } else {
            keptCalls.push(tc);
          }
        }

        if (droppedCalls.length === 0) {
          // No Notion calls in this message — pass through unchanged
          afterPass1.push(msg);
          continue;
        }

        // Build a cleaned copy of the assistant message
        const cleaned = { ...msg };

        if (keptCalls.length > 0) {
          // Mixed message: keep the non-Notion tool_calls intact
          cleaned.tool_calls = keptCalls;
        } else {
          // All tool_calls were Notion — remove the array entirely
          delete cleaned.tool_calls;
        }

        // Determine whether anything meaningful remains
        const hasContent =
          typeof cleaned.content === "string"
            ? cleaned.content.trim().length > 0
            : cleaned.content != null;
        const hasRemainingCalls =
          Array.isArray(cleaned.tool_calls) && cleaned.tool_calls.length > 0;

        if (!hasContent && !hasRemainingCalls) {
          // Empty shell — drop the whole message
          console.log(
            `[notion-mcp-fix] Dropped empty assistant message (had ${droppedCalls.length} Notion call(s))`
          );
          continue;
        }

        afterPass1.push(cleaned);
      } else {
        afterPass1.push(msg);
      }
    }

    // Pass 2 — remove role:"tool" messages whose tool_call_id was stripped
    const afterPass2 = [];
    for (const msg of afterPass1) {
      if (msg.role === "tool" && removedToolCallIds.has(msg.tool_call_id)) {
        console.log(
          `[notion-mcp-fix] Dropped tool result message for call id: ${msg.tool_call_id}`
        );
        continue;
      }
      afterPass2.push(msg);
    }

    // Only mutate the payload if something actually changed
    if (afterPass2.length === messages.length) return payload;

    console.log(
      `[notion-mcp-fix] Sanitized payload: ${messages.length} → ${afterPass2.length} messages ` +
        `(removed ${messages.length - afterPass2.length} Notion MCP block(s))`
    );

    return { ...payload, messages: afterPass2 };
  }

  // ── Fetch interceptor ──────────────────────────────────────────────────────
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    try {
      // Resolve URL from either a Request object or a plain string/URL
      const url =
        input instanceof Request
          ? input.url
          : typeof input === "string"
          ? input
          : input?.toString?.() ?? "";

      // Only intercept OpenRouter completions endpoint
      if (!url.includes(OPENROUTER_ENDPOINT)) {
        return originalFetch(input, init);
      }

      // Extract the raw body string
      let bodyText;
      if (init && typeof init.body === "string") {
        bodyText = init.body;
      } else if (input instanceof Request) {
        // Request body can only be read once — clone it
        bodyText = await input.clone().text();
      } else {
        // Body is not a plain string (e.g. FormData, stream) — pass through
        return originalFetch(input, init);
      }

      // Parse JSON — bail out silently if it's not valid JSON
      let payload;
      try {
        payload = JSON.parse(bodyText);
      } catch {
        return originalFetch(input, init);
      }

      // Only act on Perplexity models
      if (!PERPLEXITY_MODEL_RE.test(payload?.model ?? "")) {
        return originalFetch(input, init);
      }

      // Run the sanitizer
      const sanitized = sanitizePayload(payload);

      // If nothing changed, pass through the original call untouched
      if (sanitized === payload) {
        return originalFetch(input, init);
      }

      // Re-package the request with the sanitized body
      const newInit = {
        ...(init ?? {}),
        body: JSON.stringify(sanitized),
      };

      // If input was a Request object, use its URL as the target so that
      // newInit.body (not the consumed Request body) is used
      const target = input instanceof Request ? input.url : input;
      return originalFetch(target, newInit);
    } catch (err) {
      // Never let the interceptor break the app — fall back to original
      console.error("[notion-mcp-fix] Error in fetch interceptor, passing through:", err);
      return originalFetch(input, init);
    }
  };

  console.log("✅ [notion-mcp-fix] Notion MCP sanitizer for Perplexity installed.");
})();
