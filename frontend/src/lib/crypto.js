// ─────────────────────────────────────────────────────────
//  Lucid AI — Encryption Utils
//  AES-256-CTR with per-message IV (stream cipher mode)
//
//  CTR mode is preferred over CBC here because:
//    • No padding oracle attacks (stream cipher)
//    • Parallelisable encryption/decryption
//    • No need for PKCS7 padding
//
//  Env:  ENCRYPTION_KEY  (32-byte hex or any string, hashed to 32 bytes)
// ─────────────────────────────────────────────────────────

import crypto from 'crypto';

const ALGORITHM = 'aes-256-ctr';
const IV_LENGTH = 16; // 128-bit IV for AES-CTR

// ── Internal: Derive a 32-byte key from ENCRYPTION_KEY env var ──
function getSecretKey() {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      'Missing ENCRYPTION_KEY environment variable. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  // Hash the secret to ensure it's always exactly 32 bytes (256 bits)
  return crypto.createHash('sha256').update(String(secret)).digest();
}

/**
 * Encrypt a plaintext string.
 *
 * @param   {string} text  — The plaintext to encrypt
 * @returns {{ iv: string, content: string }}
 *          iv      — hex-encoded initialization vector (16 bytes)
 *          content — hex-encoded encrypted ciphertext
 *
 * @example
 *   const hash = encrypt('ghp_abc123...');
 *   // → { iv: 'a1b2c3...', content: 'd4e5f6...' }
 *   // Store hash.content as `encryptedToken`, hash.iv as `iv`
 */
export function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getSecretKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return {
    iv: iv.toString('hex'),
    content: encrypted,
  };
}

/**
 * Decrypt data that was encrypted with `encrypt()`.
 *
 * @param   {{ iv: string, content: string }} hash
 *          iv      — hex-encoded initialization vector
 *          content — hex-encoded ciphertext
 * @returns {string} — The original plaintext
 *
 * @example
 *   const token = decrypt({ iv: 'a1b2c3...', content: 'd4e5f6...' });
 *   // → 'ghp_abc123...'
 */
export function decrypt(hash) {
  const iv = Buffer.from(hash.iv, 'hex');
  const key = getSecretKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

  let decrypted = decipher.update(hash.content, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Convenience: Decrypt from the DB column format.
 * Prisma stores `encryptedToken` and `iv` as separate columns.
 *
 * @param   {string} encryptedToken — hex ciphertext from DB
 * @param   {string} iv             — hex IV from DB
 * @returns {string} — The original plaintext token
 */
export function decryptFromDB(encryptedToken, iv) {
  return decrypt({ iv, content: encryptedToken });
}
