export class PromptBuilder {
  static build({
    input,
    persona,
    context,
    history,
  }: {
    input: string;
    persona?: string;
    context?: Record<string, unknown>;
    history?: string;
  }) {
    return {
      system: persona ?? "",
      // Backward compatibility: inject persona into user string for the current external API
      user: persona ? `${input}\n\n[SYSTEM INSTRUCTION: ${persona}]` : input,
      context: {
        history: history ?? "",
        ...context,
      },
    };
  }
}
