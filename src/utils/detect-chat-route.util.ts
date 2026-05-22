/**
 * detectChatRoute
 *
 * Fast, regex-based classifier that runs synchronously before the ChatWonder
 * AI stream starts. Returns a `ChatRoute` when the input clearly maps to a
 * known experience, or `null` when ChatWonder should decide on its own.
 *
 * Returned `route` values mirror the mirror-app experience names used by the
 * `navigate` action in actions.json and the `navigate` intent in intents.json.
 */

export interface ChatRoute {
  /** Experience key the frontend uses to navigate / activate a panel */
  route:
    | "video"
    | "map"
    | "outfit-builder"
    | "virtual-mirror"
    | "event-setup"
    | "schedule"
    | "qrcode"
    | "home";
  /** Extracted search query or destination, when applicable */
  query?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extract(t: string, re: RegExp): string | undefined {
  const m = t.match(re);
  return m?.[1]?.trim() || undefined;
}

// ─── Route rules (ordered: most specific first) ───────────────────────────────

const rules: Array<(t: string) => ChatRoute | null> = [
  // Video / music
  (t) => {
    if (
      /\b(play|show|find|search|put on|queue|recommend)\b.{0,30}\b(video|music|song|track|playlist|mv|audio)\b/i.test(
        t
      ) ||
      /\b(videos?|music|songs?|tracks?|playlists?)\b.{0,20}\b(of|by|from|about)\b/i.test(t)
    ) {
      const query =
        extract(
          t,
          /(?:play|show|find|search|put on|queue|recommend)\s+(.+?)(?:\s+(?:video|music|song|track|playlist))?$/i
        ) || extract(t, /(.+?)\s+(?:video|music|song|track)s?/i);
      return { route: "video", query };
    }
    return null;
  },

  // Maps / directions / navigation
  (t) => {
    const navMatch = t.match(
      /(?:take me to|navigate to|directions?\s+to|drive to|go to|how (?:do i|to) get to)\s+(.+)/i
    );
    if (navMatch) return { route: "map", query: navMatch[1].trim() };

    if (/\b(open|show|go\s+to)\s+(the\s+)?map\b/i.test(t)) return { route: "map" };
    if (/\b(best route|traffic|avoid traffic)\b/i.test(t)) return { route: "map" };
    return null;
  },

  // Outfit builder
  (t) => {
    if (
      /\b(build|create|make|assemble|suggest|recommend)\s+(an?\s+)?(outfit|look|style|fit)\b/i.test(
        t
      ) ||
      /\b(pick|choose|select)\s+(clothes|outfit|what to wear)\b/i.test(t) ||
      /\bwhat\s+(should|can)\s+i\s+wear\b/i.test(t)
    ) {
      return { route: "outfit-builder" };
    }
    return null;
  },

  // Virtual mirror / try-on
  (t) => {
    if (
      /\btry\s+it\s+on\b/i.test(t) ||
      /\bvirtual\s+(fitting|mirror|try(-?on)?)\b/i.test(t) ||
      /\bsee\s+how\s+(it|this)\s+looks?\s+on\s+(me|you)\b/i.test(t)
    ) {
      return { route: "virtual-mirror" };
    }
    return null;
  },

  // Event setup
  (t) => {
    if (
      /\b(plan|set\s+up|create|add|new)\s+(an?\s+)?(event|appointment|meeting|occasion)\b/i.test(
        t
      ) ||
      /\b(i('m| am)\s+(going|attending|heading))\b/i.test(t)
    ) {
      return { route: "event-setup" };
    }
    return null;
  },

  // Schedule / calendar
  (t) => {
    if (
      /\b(show|open|check|view|see)\s+(my\s+)?(schedule|calendar|events?|agenda)\b/i.test(t) ||
      /\bwhat('s|s| is)\s+(on\s+my\s+calendar|my\s+schedule)\b/i.test(t) ||
      /\bupcoming\s+events?\b/i.test(t)
    ) {
      return { route: "schedule" };
    }
    return null;
  },

  // QR / pairing
  (t) => {
    if (/\b(scan|qr[\s-]?code|pair|connect)\b/i.test(t)) {
      return { route: "qrcode" };
    }
    return null;
  },

  // Home
  (t) => {
    if (/\b(home|main\s+screen|welcome\s+screen|start\s+over|go\s+back\s+home)\b/i.test(t)) {
      return { route: "home" };
    }
    return null;
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the matched `ChatRoute`, or `null` if the input should be handled
 * entirely by the ChatWonder AI (e.g. general fashion Q&A, weather, time).
 */
export function detectChatRoute(input: string): ChatRoute | null {
  const t = input.trim();
  for (const rule of rules) {
    const result = rule(t);
    if (result) return result;
  }
  return null;
}
