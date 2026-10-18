import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
const mobileRequire = createRequire(new URL('../../mobile/package.json', import.meta.url));
const braces = mobileRequire('braces');
const forge = mobileRequire('node-forge');

test('brace tooling rejects excessive nesting before recursive AST traversal', () => {
  for (const [open, close] of [['{', '}'], ['(', ')']]) {
    const pattern = open.repeat(3000) + 'a,b' + close.repeat(3000);
    for (const method of ['parse', 'compile', 'expand', 'stringify']) {
      assert.throws(() => braces[method](pattern), /Maximum brace nesting depth exceeded/);
    }
  }
});

test('brace AST entry points also enforce depth limits', () => {
  for (const method of ['compile', 'expand', 'stringify']) {
    let ast = { type: 'text', value: 'hello', nodes: [] };
    for (let i = 0; i < 300; i++) ast = { type: 'root', nodes: [ast] };
    assert.throws(() => braces[method](ast), /Maximum brace nesting depth exceeded/);
  }
});

test('normal brace expansion and escaping still work', () => {
  assert.deepEqual(braces.expand('src/{api,ui}/{1..3}.ts'), [
    'src/api/1.ts', 'src/api/2.ts', 'src/api/3.ts',
    'src/ui/1.ts', 'src/ui/2.ts', 'src/ui/3.ts',
  ]);
  assert.equal(braces.compile('src/{api,ui}/*.ts'), 'src/(api|ui)/*.ts');
  assert.equal(braces.stringify(braces.parse('a/{b,c}/d')), 'a/{b,c}/d');
  assert.deepEqual(braces.expand(String.raw`a/\{literal\}`), ['a/{literal}']);
});

const { privateKey: pem } = generateKeyPairSync('rsa', {
  modulusLength: 1024, // Synthetic test key only; never used by the application.
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const privateKey = forge.pki.privateKeyFromPem(pem);
const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
const digest = forge.md.sha256.create().update('synthetic security regression').digest().getBytes();
const asn1 = forge.asn1;
const make = (type, value, constructed = false) => asn1.create(asn1.Class.UNIVERSAL, type, constructed, value);
const oid = () => make(asn1.Type.OID, asn1.oidToDer(forge.oids.sha256).getBytes());
const nil = () => make(asn1.Type.NULL, '');
function signature(parameters) {
  const info = make(asn1.Type.SEQUENCE, [
    make(asn1.Type.SEQUENCE, parameters, true), make(asn1.Type.OCTETSTRING, digest),
  ], true);
  return forge.pki.rsa.encrypt(asn1.toDer(info).getBytes(), privateKey, 0x01);
}

test('RSA verifier rejects extra or malformed nested DigestAlgorithm elements', () => {
  for (const parameters of [
    [oid(), nil(), nil()],
    [oid(), nil(), make(asn1.Type.OCTETSTRING, 'garbage')],
    [oid(), make(asn1.Type.SEQUENCE, [nil()], true)],
    [oid(), make(asn1.Type.NULL, 'garbage')],
  ]) {
    assert.throws(() => publicKey.verify(digest, signature(parameters)), /DigestInfo/);
  }
});

test('RSA verifier accepts valid SHA-256 encodings and rejects altered digests', () => {
  for (const parameters of [[oid()], [oid(), nil()]]) {
    const sig = signature(parameters);
    assert.equal(publicKey.verify(digest, sig), true);
    assert.equal(publicKey.verify('x'.repeat(digest.length), sig), false);
  }
});
