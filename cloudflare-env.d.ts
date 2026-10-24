declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    GAME_AUTH_MODE?: "site" | "guest";
  }
}
