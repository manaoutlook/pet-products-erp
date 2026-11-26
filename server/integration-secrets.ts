import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption for credentials that belong to a third-party service.
 *
 * The WooCommerce consumer key + secret can change the stock (and, with a broader key, the
 * catalogue and orders) of a live shop. They are therefore never stored in plain text and never
 * returned to the browser: `website_channels` holds `consumer_key_enc` / `consumer_secret_enc`
 * and the API answers with a masked value only.
 *
 * Format: `v1:<iv>:<authTag>:<ciphertext>`, all base64. AES-256-GCM authenticates the payload,
 * so a tampered or truncated value fails on decrypt instead of producing garbage credentials.
 *
 * AI Agent Note - the key comes from the environment, not the database:
 * A key stored next to the ciphertext is not encryption. `INTEGRATION_SECRET_KEY` lives in `.env`;
 * rotating it re-encrypts on the next channel save (the old ciphertext becomes unreadable, which
 * is the point - re-enter the keys after a rotation).
 *
 * AI Agent Note - why the env value is hashed:
 * Any passphrase length works, and the same text always produces the same 32-byte key, so a short
 * operator-chosen secret is not silently padded with zeros.
 */

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;
const KEY_ENV = "INTEGRATION_SECRET_KEY";

/** Minimum length that carries any entropy at all; shorter values are refused loudly. */
const MIN_SECRET_LENGTH = 16;

function encryptionKey(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw || raw.trim().length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${KEY_ENV} must be set to at least ${MIN_SECRET_LENGTH} characters before saving website credentials`,
    );
  }
  // SHA-256 gives AES a 32-byte key whatever the operator typed.
  return createHash("sha256").update(raw).digest();
}

/** Whether a channel can be saved right now - the route answers 400 instead of a 500. */
export function isEncryptionConfigured(): boolean {
  const raw = process.env[KEY_ENV];
  return Boolean(raw && raw.trim().length >= MIN_SECRET_LENGTH);
}

/** `plain` -> `v1:<iv>:<tag>:<ciphertext>`. */
export function encryptSecret(plain: string): string {
  const value = String(plain ?? "");
  if (!value) throw new Error("Nothing to encrypt");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/**
 * `v1:…` -> plain text.
 *
 * A value that is not in the `v1:` format is returned unchanged. That is deliberate: a channel
 * inserted by hand (a script, a support session) with a plain key keeps working, and the next save
 * through the screen encrypts it.
 */
export function decryptSecret(payload: string): string {
  const text = String(payload ?? "");
  if (!text) return "";
  if (!isEncryptedSecret(text)) return text;

  const [version, ivB64, tagB64, dataB64] = text.split(":");
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("The stored credential is not in the expected format");
  }

  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key after a rotation, or a tampered row. Say which one it is, never log the value.
    throw new Error(
      `The stored website credential could not be decrypted. Check ${KEY_ENV} has not changed, then re-enter the API key.`,
    );
  }
}

/** True for ciphertext this module produced (so a plain-text row is not double-encrypted). */
export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${VERSION}:`);
}
