import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

const CHALLENGE_TTL = 120_000;
const SESSION_TTL = 3_600_000;
const CATEGORIES = new Set(['소개·경력', '프로젝트', '화면·사용성']);
const now = () => Date.now();

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value) {
  const text = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(text.padEnd(Math.ceil(text.length / 4) * 4, '=')), (char) => char.charCodeAt(0));
}
function token() {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}
async function digest(value) {
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
function reply(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}
function noteFields(body) {
  if (!CATEGORIES.has(body.category) ||
    typeof body.title !== 'string' || body.title.trim().length < 2 || body.title.trim().length > 80 ||
    typeof body.body !== 'string' || body.body.trim().length < 2 || body.body.trim().length > 1000) {
    throw new ApiError(400, '메모 분류·제목·내용을 확인해 주세요.');
  }
  return { category: body.category, title: body.title.trim(), body: body.body.trim() };
}
async function readBody(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'JSON 요청이 필요합니다.');
  }
  const text = await request.text();
  if (text.length > 128 * 1024) throw new ApiError(413, '요청이 너무 큽니다.');
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new ApiError(400, '요청 형식이 올바르지 않습니다.');
  }
}
async function sessionOf(request, db) {
  const match = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(request.headers.get('authorization') ?? '');
  if (!match) return null;
  return db.prepare('SELECT s.account_id, s.credential_id, a.label FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?')
    .bind(await digest(match[1]), now()).first();
}
async function requireSession(request, db) {
  const session = await sessionOf(request, db);
  if (!session) throw new ApiError(401, '패스키 로그인이 필요합니다.');
  return session;
}
async function consumeChallenge(db, id, kind) {
  if (typeof id !== 'string') throw new ApiError(400, '질문 ID가 필요합니다.');
  const row = await db.prepare('SELECT * FROM challenges WHERE id=? AND kind=?').bind(id, kind).first();
  if (!row || row.used_at !== null || row.expires_at <= now()) {
    throw new ApiError(401, '질문이 만료되었거나 이미 사용되었습니다.');
  }
  const result = await db.prepare('UPDATE challenges SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>?')
    .bind(now(), id, now()).run();
  if (result.meta.changes !== 1) throw new ApiError(401, '질문이 만료되었거나 이미 사용되었습니다.');
  return row;
}
async function createSession(db, accountId, credentialId) {
  const value = token();
  await db.prepare('INSERT INTO sessions (token_hash,account_id,credential_id,expires_at) VALUES (?,?,?,?)')
    .bind(await digest(value), accountId, credentialId, now() + SESSION_TTL).run();
  return value;
}

async function registerOptions(request, env) {
  const body = await readBody(request);
  const session = await sessionOf(request, env.DB);
  let accountId = session?.account_id;
  let inviteHash = null;
  if (!session) {
    if (typeof body.inviteToken !== 'string' || body.inviteToken.length < 40) {
      throw new ApiError(401, '등록 초대가 필요합니다.');
    }
    inviteHash = await digest(body.inviteToken);
    const invite = await env.DB.prepare('SELECT account_id FROM invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?')
      .bind(inviteHash, now()).first();
    if (!invite) throw new ApiError(401, '초대가 만료되었거나 이미 사용되었습니다.');
    accountId = invite.account_id;
    const existing = await env.DB.prepare('SELECT COUNT(*) AS count FROM credentials WHERE account_id=?')
      .bind(accountId).first();
    if (existing.count) throw new ApiError(403, '이미 등록된 계정입니다.');
  }
  const account = await env.DB.prepare('SELECT id,label FROM accounts WHERE id=?').bind(accountId).first();
  if (!account) throw new ApiError(404, '계정을 찾을 수 없습니다.');
  const existing = await env.DB.prepare('SELECT id,transports FROM credentials WHERE account_id=?')
    .bind(accountId).all();
  const options = await generateRegistrationOptions({
    rpName: 'Kim Geonho Portfolio',
    rpID: env.RP_ID,
    userID: new TextEncoder().encode(account.id),
    userName: account.label,
    attestationType: 'none',
    timeout: 60_000,
    supportedAlgorithmIDs: [-7, -257],
    excludeCredentials: existing.results.map((item) => ({
      id: item.id, transports: JSON.parse(item.transports),
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const requestId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO challenges (id,kind,account_id,invite_hash,challenge,expires_at) VALUES (?,'registration',?,?,?,?)")
    .bind(requestId, accountId, inviteHash, options.challenge, now() + CHALLENGE_TTL).run();
  return { requestId, options };
}

async function registerVerify(request, env) {
  const body = await readBody(request);
  const challenge = await consumeChallenge(env.DB, body.requestId, 'registration');
  const session = await sessionOf(request, env.DB);
  if (challenge.invite_hash) {
    if (typeof body.inviteToken !== 'string' || await digest(body.inviteToken) !== challenge.invite_hash) {
      throw new ApiError(401, '등록 초대가 일치하지 않습니다.');
    }
  } else if (!session || session.account_id !== challenge.account_id) {
    throw new ApiError(401, '패스키 로그인이 필요합니다.');
  }
  if (typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.trim().length > 40) {
    throw new ApiError(400, '패스키 이름은 2~40자로 입력해 주세요.');
  }
  if (!body.credential || typeof body.credential !== 'object') {
    throw new ApiError(400, '패스키 응답이 필요합니다.');
  }
  let result;
  try {
    result = await verifyRegistrationResponse({
      response: body.credential,
      expectedChallenge: challenge.challenge,
      expectedOrigin: env.FRONTEND_ORIGIN,
      expectedRPID: env.RP_ID,
      requireUserVerification: true,
    });
  } catch {
    throw new ApiError(401, '패스키 등록 검증에 실패했습니다.');
  }
  if (!result.verified || !result.registrationInfo?.credential) {
    throw new ApiError(401, '패스키 등록 검증에 실패했습니다.');
  }
  const credential = result.registrationInfo.credential;
  if (challenge.invite_hash) {
    const claimed = await env.DB.prepare('UPDATE invites SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?')
      .bind(now(), challenge.invite_hash, now()).run();
    if (claimed.meta.changes !== 1) throw new ApiError(401, '초대가 만료되었거나 이미 사용되었습니다.');
  }
  try {
    await env.DB.prepare('INSERT INTO credentials (id,account_id,public_key,counter,transports,name,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(
        credential.id, challenge.account_id, encode(credential.publicKey),
        credential.counter, JSON.stringify(body.credential.response?.transports ?? []),
        body.name.trim(), now()
      ).run();
  } catch {
    throw new ApiError(409, '이미 등록된 패스키입니다.');
  }
  return {
    registered: true,
    credentialId: credential.id,
    token: session ? null : await createSession(env.DB, challenge.account_id, credential.id),
  };
}

async function authOptions(env) {
  const options = await generateAuthenticationOptions({
    rpID: env.RP_ID, timeout: 60_000, userVerification: 'required', allowCredentials: [],
  });
  const requestId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO challenges (id,kind,challenge,expires_at) VALUES (?,'authentication',?,?)")
    .bind(requestId, options.challenge, now() + CHALLENGE_TTL).run();
  return { requestId, options };
}
async function authVerify(request, env) {
  const body = await readBody(request);
  const challenge = await consumeChallenge(env.DB, body.requestId, 'authentication');
  if (!body.credential || typeof body.credential.id !== 'string') {
    throw new ApiError(400, '패스키 응답이 필요합니다.');
  }
  const passkey = await env.DB.prepare('SELECT * FROM credentials WHERE id=?')
    .bind(body.credential.id).first();
  if (!passkey) throw new ApiError(401, '등록되지 않은 패스키입니다.');
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: body.credential,
      expectedChallenge: challenge.challenge,
      expectedOrigin: env.FRONTEND_ORIGIN,
      expectedRPID: env.RP_ID,
      requireUserVerification: true,
      credential: {
        id: passkey.id,
        publicKey: decode(passkey.public_key),
        counter: passkey.counter,
        transports: JSON.parse(passkey.transports),
      },
    });
  } catch {
    throw new ApiError(401, '패스키 서명 검증에 실패했습니다.');
  }
  if (!result.verified) throw new ApiError(401, '패스키 서명 검증에 실패했습니다.');
  const updated = await env.DB.prepare('UPDATE credentials SET counter=? WHERE id=?')
    .bind(result.authenticationInfo.newCounter, passkey.id).run();
  if (updated.meta.changes !== 1) throw new ApiError(401, '삭제된 패스키입니다.');
  return {
    token: await createSession(env.DB, passkey.account_id, passkey.id),
    accountId: passkey.account_id,
  };
}

async function route(request, env) {
  const path = new URL(request.url).pathname;
  const method = request.method;
  const db = env.DB;
  if (method === 'POST' && path === '/api/registration/options') return reply(await registerOptions(request, env));
  if (method === 'POST' && path === '/api/registration/verify') return reply(await registerVerify(request, env), 201);
  if (method === 'POST' && path === '/api/authentication/options') return reply(await authOptions(env));
  if (method === 'POST' && path === '/api/authentication/verify') return reply(await authVerify(request, env));
  if (method === 'GET' && path === '/api/me') {
    const s = await requireSession(request, db);
    return reply({ id: s.account_id, label: s.label, currentCredentialId: s.credential_id });
  }
  if (method === 'POST' && path === '/api/logout') {
    await requireSession(request, db);
    const value = request.headers.get('authorization').slice(7);
    await db.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?')
      .bind(now(), await digest(value)).run();
    return reply({ loggedOut: true });
  }
  const notes = /^\/api\/accounts\/([^/]+)\/notes$/.exec(path);
  if (notes && (method === 'GET' || method === 'POST')) {
    const s = await requireSession(request, db);
    if (s.account_id !== notes[1]) throw new ApiError(403, '다른 계정의 자료에는 접근할 수 없습니다.');
    if (method === 'GET') {
      const rows = await db.prepare('SELECT id,category,title,body,created_at FROM notes WHERE account_id=? ORDER BY created_at,id')
        .bind(s.account_id).all();
      return reply({ notes: rows.results });
    }
    const fields = noteFields(await readBody(request));
    const note = {
      id: crypto.randomUUID(), ...fields, created_at: now(),
    };
    await db.prepare('INSERT INTO notes (id,account_id,category,title,body,created_at) VALUES (?,?,?,?,?,?)')
      .bind(note.id, s.account_id, note.category, note.title, note.body, note.created_at).run();
    return reply({ note }, 201);
  }
  const noteItem = /^\/api\/accounts\/([^/]+)\/notes\/([^/]+)$/.exec(path);
  if (noteItem && (method === 'PATCH' || method === 'DELETE')) {
    const s = await requireSession(request, db);
    if (s.account_id !== noteItem[1]) throw new ApiError(403, '다른 계정의 자료에는 접근할 수 없습니다.');
    if (method === 'PATCH') {
      const fields = noteFields(await readBody(request));
      const updated = await db.prepare('UPDATE notes SET category=?,title=?,body=? WHERE id=? AND account_id=?')
        .bind(fields.category, fields.title, fields.body, noteItem[2], s.account_id).run();
      if (updated.meta.changes !== 1) throw new ApiError(404, '메모를 찾을 수 없습니다.');
      const note = await db.prepare('SELECT id,category,title,body,created_at FROM notes WHERE id=? AND account_id=?')
        .bind(noteItem[2], s.account_id).first();
      return reply({ note });
    }
    const deleted = await db.prepare('DELETE FROM notes WHERE id=? AND account_id=?')
      .bind(noteItem[2], s.account_id).run();
    if (deleted.meta.changes !== 1) throw new ApiError(404, '메모를 찾을 수 없습니다.');
    return reply({ deleted: true });
  }
  if (method === 'GET' && path === '/api/passkeys') {
    const s = await requireSession(request, db);
    const rows = await db.prepare('SELECT id,name,created_at FROM credentials WHERE account_id=? ORDER BY created_at,id')
      .bind(s.account_id).all();
    return reply({ passkeys: rows.results.map((item) => ({
      ...item, current: item.id === s.credential_id,
    })) });
  }
  const deleting = /^\/api\/passkeys\/([^/]+)$/.exec(path);
  if (method === 'DELETE' && deleting) {
    const s = await requireSession(request, db);
    const passkey = await db.prepare('SELECT account_id FROM credentials WHERE id=?')
      .bind(deleting[1]).first();
    if (!passkey || passkey.account_id !== s.account_id) throw new ApiError(404, '패스키를 찾을 수 없습니다.');
    const count = await db.prepare('SELECT COUNT(*) AS count FROM credentials WHERE account_id=?')
      .bind(s.account_id).first();
    if (count.count <= 1) throw new ApiError(409, '마지막 패스키는 삭제할 수 없습니다.');
    await db.prepare('DELETE FROM sessions WHERE credential_id=?').bind(deleting[1]).run();
    const removed = await db.prepare('DELETE FROM credentials WHERE id=? AND account_id=? AND (SELECT COUNT(*) FROM credentials WHERE account_id=?)>1')
      .bind(deleting[1], s.account_id, s.account_id).run();
    if (removed.meta.changes !== 1) throw new ApiError(409, '마지막 패스키는 삭제할 수 없습니다.');
    return reply({ deleted: true, currentSessionRevoked: s.credential_id === deleting[1] });
  }
  throw new ApiError(404, '요청한 경로가 없습니다.');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin');
    if (origin !== env.FRONTEND_ORIGIN) return reply({ error: '허용되지 않은 출처입니다.' }, 403);
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const response = await route(request, env);
      Object.entries(cors).forEach(([name, value]) => response.headers.set(name, value));
      return response;
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      if (status === 500) console.error(error);
      return reply({ error: error instanceof ApiError ? error.message : '서버 오류가 발생했습니다.' }, status, cors);
    }
  },
};
