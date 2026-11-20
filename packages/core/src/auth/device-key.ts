import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';

/**
 * T1.3.1 step 7 - the device key: Ed25519, generated on this machine at login. The public key (SPKI DER, base64) is
 * registered with the session; the private key (PKCS8 DER, base64) goes only to the credential store and only signs
 * a reauth: `<sessionId>|<Auth0 token iat>|<timestamp>` (platform device-signature.ts, T1.2.2).
 */
export interface DeviceKeyPair {
  readonly publicKey: string;
  readonly privateKey: string;
}

export function newDeviceKey(): DeviceKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  };
}

export function reauthMessage(sessionId: string, tokenIat: number, timestamp: number): Buffer {
  return Buffer.from(`${sessionId}|${tokenIat}|${timestamp}`, 'utf8');
}

export function signReauth(privateKey: string, sessionId: string, tokenIat: number, timestamp: number): string {
  const key = createPrivateKey({ key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  return sign(null, reauthMessage(sessionId, tokenIat, timestamp), key).toString('base64');
}
