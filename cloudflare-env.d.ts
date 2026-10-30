declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    LIUBAI_SECRET_KEY?: string;
    LIUBAI_DEFAULT_DEEPSEEK_KEY?: string;
    LIUBAI_BOOTSTRAP_EMAIL?: string;
  }
}
