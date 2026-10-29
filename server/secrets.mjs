const encoder = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
async function keyFor(secret) {
  if (typeof secret !== 'string') throw new Error('secret_unconfigured');
  const raw = bytes(secret);
  if (raw.length !== 32) throw new Error('secret_unconfigured');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptKey(apiKey, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('liubai-deepseek-v1') }, await keyFor(secret), encoder.encode(apiKey));
  return { encrypted_key: b64(new Uint8Array(encrypted)), iv: b64(iv) };
}
export async function decryptKey(config, secret) {
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(config.iv), additionalData: encoder.encode('liubai-deepseek-v1') }, await keyFor(secret), bytes(config.encrypted_key));
  return new TextDecoder().decode(decrypted);
}
export async function digest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
