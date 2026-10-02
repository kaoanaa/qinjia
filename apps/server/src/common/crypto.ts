import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * PIPL 敏感字段静态加密（AES-256-GCM）。
 * 密钥 = sha256(CONSENT_ENC_KEY || JWT_SECRET || dev 兜底)。生产必须配置独立密钥。
 * 存储格式：base64(iv).base64(tag).base64(cipher)
 */
const DEV_FALLBACK = 'dev_only_consent_key_change_me';

function deriveKey(secret: string | undefined): Buffer {
  const material = secret && secret.length > 0 ? secret : DEV_FALLBACK;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须配置 CONSENT_ENC_KEY/JWT_SECRET 用于敏感字段加密');
  }
  return createHash('sha256').update(material).digest();
}

export function encryptField(plaintext: string, secret?: string): string {
  const key = deriveKey(secret ?? process.env.CONSENT_ENC_KEY ?? process.env.JWT_SECRET);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decryptField(payload: string, secret?: string): string {
  const key = deriveKey(secret ?? process.env.CONSENT_ENC_KEY ?? process.env.JWT_SECRET);
  const parts = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) throw new Error('密文格式非法');
  const [iv, tag, data] = parts as [Buffer, Buffer, Buffer];
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
