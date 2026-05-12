import logger from "./logger";

/**
 * Strip leading `[Sources] [...]` from ChatWonder WebSocket stream accumulation.
 */
export function stripSourcesPrefix(raw: string): {
  cleaned: string;
  sourceMetadata: unknown[];
} {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("[Sources]")) {
    return { cleaned: raw, sourceMetadata: [] };
  }

  // Find the end of the [Sources] block (the first newline or the end of the JSON array)
  const afterLabel = trimmed.slice("[Sources]".length).trimStart();
  
  // Basic implementation to find the end of the first JSON array
  if (afterLabel.startsWith("[")) {
    let depth = 0;
    let end = -1;
    for (let i = 0; i < afterLabel.length; i++) {
      if (afterLabel[i] === "[") depth++;
      else if (afterLabel[i] === "]") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }

    if (end !== -1) {
      const sourceJson = afterLabel.slice(0, end);
      const cleaned = afterLabel.slice(end).trimStart();
      try {
        const sourceMetadata = JSON.parse(sourceJson);
        return { cleaned, sourceMetadata };
      } catch (err) {
        logger.warn("[SourceMetadata] Failed to parse sources JSON");
      }
    }
  }

  // Fallback to splitting by first newline
  const lineEnd = trimmed.indexOf("\n");
  if (lineEnd !== -1) {
    return {
      cleaned: trimmed.slice(lineEnd + 1).trimStart(),
      sourceMetadata: [],
    };
  }

  return { cleaned: raw, sourceMetadata: [] };
}
