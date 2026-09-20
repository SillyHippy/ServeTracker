import { betterAuth } from "better-auth";
import { Database } from "bun:sqlite";
import { join } from "path";
import { DATA_DIR } from "./db";

const DB_PATH = join(DATA_DIR, "pdfusaedit.db");
const db = new Database(DB_PATH);
db.run("PRAGMA journal_mode = WAL;");
db.run("PRAGMA busy_timeout = 5000;");

const baseURL = process.env.PUBLIC_BASE_URL || "https://servetracker.justlegalsolutions.org";

export const auth = betterAuth({
  database: db,
  baseURL,
  basePath: "/api/auth",
  secret: process.env.BETTER_AUTH_SECRET || "servetracker_secure_secret_better_auth_2026_881474473915",
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    autoSignIn: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      prompt: "select_account",
      accessType: "offline",
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "server",
        input: true,
      },
      phone_number: {
        type: "string",
        required: false,
        input: true,
      },
      phone_sms_enabled: {
        type: "boolean",
        defaultValue: true,
        input: true,
      },
      license_number: {
        type: "string",
        required: false,
        input: true,
      },
    },
  },
  trustedOrigins: [
    "https://servetracker.justlegalsolutions.org",
    "https://servetracker-beta-sillyhippy.zocomputer.io",
    "https://servetracker-sillyhippy.zocomputer.io",
    "http://localhost:5173",
    "http://localhost:3150",
    "http://localhost:3151",
    "http://localhost:3153",
  ],
});
