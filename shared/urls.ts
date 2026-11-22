// Small URL helpers (pure, unit tested).
/** CodeCraft's website (where you get API keys) from the pasted base URL: "https://x.com/v1" → "https://x.com". */
export function codecraftDashboard(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl.trim())
    return /^https?:$/.test(u.protocol) ? u.origin : null
  } catch {
    return null
  }
}
