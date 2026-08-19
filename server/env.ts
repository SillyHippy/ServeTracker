/**
 * Validates env on server startup. Bun auto-loads `.env` from the project root.
 */

const REQUIRED_IN_PRODUCTION = ["APP_PASSWORD", "SMTP_PASSWORD", "EMAIL_FROM"] as const;

const REQUIRED_ALIASES: Record<string, string[]> = {
  SMTP_PASSWORD: ["RESEND_API_KEY"],
};

function hasEnv(name: string): boolean {
  const value = process.env[name];
  if (value && value.trim().length > 0) return true;
  const aliases = REQUIRED_ALIASES[name];
  if (aliases) {
    return aliases.some((alias) => process.env[alias]?.trim());
  }
  return false;
}

export function validateEnv() {
  const isProd = process.env.NODE_ENV === "production";
  const missing: string[] = [];

  if (isProd) {
    for (const name of REQUIRED_IN_PRODUCTION) {
      if (name === "SMTP_PASSWORD" && !hasEnv("SMTP_PASSWORD")) {
        missing.push("SMTP_PASSWORD (or RESEND_API_KEY)");
      } else if (!hasEnv(name)) {
        missing.push(name);
      }
    }
  }

  if (missing.length > 0) {
    console.warn("\n⚠️  Missing environment variables:");
    for (const name of missing) {
      console.warn(`   - ${name}`);
    }
    console.warn("   Copy .env.example → .env and fill in values, or set them in Zo service settings.\n");
  } else if (isProd) {
    console.log("Environment: required variables present");
  }

  if (!process.env.APP_PASSWORD) {
    console.warn('APP_PASSWORD not set — login will fall back to "Password" (dev only)');
  }
}
