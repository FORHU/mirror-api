/**
 * Repair common LLM JSON defects so a structured response survives a slip.
 * Handles the failure modes we see from ChatWonder:
 *   - empty values:        `"key":,`  /  `"key": }`     -> null
 *   - bare decimal point:  `"confidence": .`            -> null  (truncated number)
 *   - leading-dot number:  `"confidence": .5`           -> 0.5
 *   - trailing commas:     `[1, 2, ]`  /  `{ ..., }`    -> removed
 *
 * This only runs as a fallback after a normal JSON.parse has already failed, so
 * well-formed responses are never touched.
 */
export function repairJson(input: string): string {
  return (
    input
      // "key": .5  -> "key": 0.5  (JSON forbids a leading dot)
      .replace(/(:\s*)(\.\d+)/g, "$10$2")
      // "key": .   -> "key": null (model wrote a lone dot instead of a number)
      .replace(/(:\s*)\.(?=\s*[,}\]])/g, "$1null")
      // "key": ,  /  "key": }  /  "key": ]  -> empty value becomes null
      .replace(/(:\s*)(?=[,}\]])/g, "$1null")
      // trailing comma before a closing brace/bracket
      .replace(/,(\s*[}\]])/g, "$1")
  );
}
