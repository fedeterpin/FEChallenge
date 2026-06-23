/**
 * Tiny env helper. No t3-env on purpose — keep the dependency surface small
 * and the defaults obvious. Everything has a sensible default so the app runs
 * with zero configuration.
 */

export type AiProvider = "mock" | "anthropic" | "openai" | "bedrock";

export const env = {
  /** Which model provider the agent uses. Defaults to the offline mock. */
  AI_PROVIDER: (process.env.AI_PROVIDER ?? "mock") as AiProvider,

  /**
   * Model ids per provider (only read when that provider is selected).
   * ANTHROPIC_MODEL defaults to the prod model; set it to `claude-haiku-4-5` in
   * `.env.local` for cheaper/faster dev + eval runs. See `.env.example`.
   */
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  BEDROCK_MODEL: process.env.BEDROCK_MODEL ?? "anthropic.claude-sonnet-4-6",

  /**
   * Optional gateway base URL. When set, the anthropic/openai providers route
   * through it — point this at a Vercel AI Gateway or Cloudflare AI Gateway
   * endpoint. Leave unset to call the provider directly. See `.env.example`.
   */
  AI_GATEWAY_BASE_URL: process.env.AI_GATEWAY_BASE_URL,

  /** File-backed PGlite directory, shared by the seed and dev processes. */
  PGLITE_DIR: process.env.PGLITE_DIR ?? "./.pglite",
} as const;
