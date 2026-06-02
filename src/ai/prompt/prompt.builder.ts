export class PromptBuilder {
  static build({
    input,
    context,
    history,
  }: {
    input: string;
    context?: Record<string, unknown>;
    history?: string;
  }) {
    return {
      system: "",
      user: input,
      context: {
        history: history ?? "",
        ...context,
      },
    };
  }
}
