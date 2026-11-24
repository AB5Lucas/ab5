import { describe, expect, it } from "vitest";
import { b64urlToBytes, bytesToB64url, encryptPayload, vapidAuthorization } from "./web-push.server";

const enc = new TextEncoder();
const ab = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) {
  const k = await crypto.subtle.importKey("raw", ab(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: ab(salt), info: ab(info) }, k, n * 8));
}

describe("Web Push (RFC 8291/8292)", () => {
  it("cifra um corpo que o navegador consegue decifrar", async () => {
    const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const body = await encryptPayload(enc.encode('{"title":"Olá"}'), bytesToB64url(uaPub), bytesToB64url(auth));
    const salt = body.slice(0, 16);
    const idlen = body[20] ?? 0;
    const asPub = body.slice(21, 21 + idlen);
    const cipher = body.slice(21 + idlen);
    const asKey = await crypto.subtle.importKey("raw", ab(asPub), { name: "ECDH", namedCurve: "P-256" }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
    const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPub, ...asPub]);
    const ikm = await hkdf(auth, ecdh, info, 32);
    const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
    const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
    const key = await crypto.subtle.importKey("raw", ab(cek), "AES-GCM", false, ["decrypt"]);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: ab(nonce) }, key, ab(cipher)));
    expect(plain[plain.length - 1]).toBe(2);
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe('{"title":"Olá"}');
  });

  it("assina o JWT VAPID com a chave privada", async () => {
    const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    const keys = { publicKey: bytesToB64url(pub), privateKey: jwk.d!, subject: "mailto:ti@example.com" };
    const h = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, 1_000_000);
    const [, t1 = "", t2 = "", t3 = "", k = ""] = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h) ?? [];
    expect(k).toBe(keys.publicKey);
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(t2)));
    expect(payload).toEqual({ aud: "https://fcm.googleapis.com", exp: 1_000_000 + 43_200, sub: "mailto:ti@example.com" });
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, kp.publicKey, ab(b64urlToBytes(t3)), ab(enc.encode(`${t1}.${t2}`)));
    expect(ok).toBe(true);
  });
});
