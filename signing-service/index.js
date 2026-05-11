'use strict';

// signing-service/index.js
//
// Runs inside a Bare thread via react-native-bare-kit.
// Owns ALL Cloak/ZK imports. Metro never sees this file.
// Pre-bundled by bare-pack into app.bundle before the RN build.
// HTTP server on 127.0.0.1:7647.

const http = require('http');
const { scanOwnerUtxos, reconstructAndTransfer } = require('@legacy-protocol/cloak-integration');
const { decodeShareBase64, reconstructSecret, hexToUtxoPubkey } = require('@legacy-protocol/sdk');
const { Connection, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

const PORT = 7647;
const HOST = '127.0.0.1';

// ─── BigInt-safe JSON ─────────────────────────────────────────────────────────
// JSON cannot represent bigint natively.
// We wrap as { __bigint: "n" } on both sides.

function serialize(obj) {
  return JSON.stringify(obj, (_, v) =>
    typeof v === 'bigint' ? { __bigint: v.toString() } : v
  );
}

function deserialize(str) {
  return JSON.parse(str, (_, v) =>
    v && typeof v === 'object' && '__bigint' in v ? BigInt(v.__bigint) : v
  );
}

// ─── Request helpers ──────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(deserialize(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function send(res, status, data) {
  const body = serialize(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ─── Route handlers ───────────────────────────────────────────────────────────

async function handleScan(body) {
  const { guardianShares, connectionUrl } = body;
  const connection = new Connection(connectionUrl, 'confirmed');
  return await scanOwnerUtxos({ guardianShares, connection });
}

async function handleExecute(body) {
  const {
    guardianShares,
    beneficiaryUtxoPubkeyHex,
    vaultUtxos,
    totalAmount,
    relayerPrivateKeyBase58,
    connectionUrl,
  } = body;

  const connection = new Connection(connectionUrl, 'confirmed');
  const beneficiaryUtxoPubkey = hexToUtxoPubkey(beneficiaryUtxoPubkeyHex);

  let keypair = null;
  try {
    keypair = Keypair.fromSecretKey(
      Buffer.from(bs58.decode(relayerPrivateKeyBase58))
    );

    await reconstructAndTransfer({
      guardianShares,
      beneficiaryUtxoPubkey,
      vaultUtxos,
      totalAmount,
      relayerWallet: {
        publicKey: keypair.publicKey,
        signTransaction: async (tx) => {
          if (!keypair) throw new Error('Keypair already zeroed');
          if ('sign' in tx && typeof tx.sign === 'function') {
            tx.sign([keypair]);
          }
          return tx;
        },
      },
      connection,
    });

    return { success: true };
  } finally {
    if (keypair) {
      keypair._keypair?.secretKey?.fill(0);
      keypair = null;
    }
  }
}

async function handleTestReconstruction(body) {
  const { shareStrings } = body;
  const shares = shareStrings.map(s => decodeShareBase64(s));
  let reconstructed = reconstructSecret(shares);
  reconstructed.fill(0);
  reconstructed = null;
  return { success: true };
}

// ─── Server ───────────────────────────────────────────────────────────────────

const ROUTES = {
  '/scan':                handleScan,
  '/execute':             handleExecute,
  '/test-reconstruction': handleTestReconstruction,
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    send(res, 200, { ok: true });
    return;
  }

  if (req.method !== 'POST') {
    send(res, 405, { error: 'Method not allowed' });
    return;
  }

  const handler = ROUTES[req.url];
  if (!handler) {
    send(res, 404, { error: `Unknown endpoint: ${req.url}` });
    return;
  }

  try {
    const body = await readBody(req);
    const result = await handler(body);
    send(res, 200, result);
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[signing-service] Ready on ${HOST}:${PORT}`);
});
