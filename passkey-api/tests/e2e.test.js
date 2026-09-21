import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';

const cwd = resolve('.');
const origin = 'http://localhost:4173';
const api = 'http://127.0.0.1:8787';
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
const env = {
  ...process.env,
  XDG_CONFIG_HOME: resolve('.wrangler'),
  WRANGLER_SEND_METRICS: 'false',
};

async function waitFor(url) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      await fetch(url, { headers: { Origin: origin } });
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 250));
    }
  }
  throw new Error('로컬 서버가 시작되지 않았습니다: ' + url);
}
function launch(file, args) {
  const child = spawn(process.execPath, [file, ...args], { cwd, env, stdio: 'pipe' });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}
function invite(label) {
  const id = randomUUID();
  const value = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(value).digest('base64url');
  const expires = Date.now() + 15 * 60 * 1000;
  const sql = "INSERT INTO accounts (id,label,created_at) VALUES ('" +
    id + "','" + label + "'," + Date.now() + "); " +
    "INSERT INTO invites (token_hash,account_id,expires_at) VALUES ('" +
    hash + "','" + id + "'," + expires + ');';
  execFileSync(process.execPath, [
    wrangler, 'd1', 'execute', 'portfolio-passkeys', '--local',
    '--config', 'wrangler.dev.jsonc', '--command', sql,
  ], { cwd, env, stdio: 'pipe' });
  return { id, value };
}
function database(sql) {
  const output = execFileSync(process.execPath, [
    wrangler, 'd1', 'execute', 'portfolio-passkeys', '--local',
    '--config', 'wrangler.dev.jsonc', '--command', sql, '--json',
  ], { cwd, env, stdio: 'pipe' });
  return JSON.parse(output.toString())[0].results;
}
async function apiRequest(path, method = 'GET', body, bearer) {
  return fetch(api + path, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test('실제 가상 패스키로 등록하고 비공개 API를 보호한다', { timeout: 120_000 }, async () => {
  const worker = launch(wrangler, ['dev', '--config', 'wrangler.dev.jsonc', '--port', '8787']);
  const site = launch(resolve('serve-static.mjs'), []);
  let browser;
  try {
    await Promise.all([waitFor(api + '/api/me'), waitFor(origin)]);
    const account = invite('과제용 소유자');
    const forbidden = await apiRequest('/api/accounts/' + account.id + '/notes');
    assert.equal(forbidden.status, 401);

    const [a, b] = await Promise.all([
      apiRequest('/api/authentication/options', 'POST', {}).then((r) => r.json()),
      apiRequest('/api/authentication/options', 'POST', {}).then((r) => r.json()),
    ]);
    assert.notEqual(a.options.challenge, b.options.challenge);
    const [registerA, registerB] = await Promise.all([
      apiRequest('/api/registration/options', 'POST', { inviteToken: account.value }).then((r) => r.json()),
      apiRequest('/api/registration/options', 'POST', { inviteToken: account.value }).then((r) => r.json()),
    ]);
    assert.notEqual(registerA.options.challenge, registerB.options.challenge);

    browser = await chromium.launchPersistentContext(resolve('.test-browser'), {
      executablePath: edge,
      headless: true,
      viewport: { width: 1100, height: 800 },
    });
    const page = browser.pages()[0] || await browser.newPage();
    const cdp = await browser.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const virtualOptions = {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    };
    const { authenticatorId: auth1 } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: virtualOptions,
    });
    await page.goto(origin + '/#enroll=' + account.value);
    await page.locator('#private-open').click();
    await page.locator('#private-enroll-name').fill('과제용 노트북');
    const verified = page.waitForResponse((response) =>
      response.url().endsWith('/api/registration/verify'));
    await page.locator('#private-enroll-button').click();
    const registration = await verified;
    assert.equal(registration.status(), 201, await registration.text());
    const registered = await registration.json();
    assert.equal(typeof registered.token, 'string');
    await page.waitForFunction(() => !document.querySelector('#private-unlocked').hidden);
    await page.waitForFunction(() => document.querySelector('#private-status').textContent.includes('패스키 등록을 완료'));
    const registrationBody = registration.request().postDataJSON();
    assert.equal(Object.hasOwn(registrationBody, 'privateKey'), false);
    assert.equal(Object.hasOwn(registrationBody.credential, 'privateKey'), false);
    const storedKey = database("SELECT public_key FROM credentials WHERE id='" + registered.credentialId + "'");
    assert.equal(storedKey.length, 1);
    assert.equal(storedKey[0].public_key.length > 40, true);

    const cancelledAccount = invite('과제용 취소 확인');
    const cancelPage = await browser.newPage();
    await cancelPage.addInitScript(() => {
      Object.defineProperty(navigator.credentials, 'create', {
        value: async () => { throw new DOMException('취소', 'NotAllowedError'); },
      });
    });
    await cancelPage.goto(origin + '/#enroll=' + cancelledAccount.value);
    await cancelPage.locator('#private-open').click();
    await cancelPage.locator('#private-enroll-name').fill('취소할 패스키');
    await cancelPage.locator('#private-enroll-button').click();
    await cancelPage.waitForFunction(() =>
      document.querySelector('#private-status').textContent.includes('등록이 취소되었습니다'));
    assert.equal(database("SELECT id FROM credentials WHERE account_id='" + cancelledAccount.id + "'").length, 0);
    await cancelPage.close();

    const empty = await apiRequest('/api/accounts/' + account.id + '/notes', 'GET', undefined, registered.token);
    assert.equal(empty.status, 200);
    assert.deepEqual((await empty.json()).notes, []);
    const examples = [
      ['소개·경력', '소개 문구 다듬기', '첫 화면의 소개 문구를 더 간결하게 정리한다.'],
      ['프로젝트', '프로젝트 설명 점검', '프로젝트별 역할 설명과 캡처 순서를 점검한다.'],
      ['화면·사용성', '모바일 화면 점검', '모바일 메뉴와 상세 창의 사용 흐름을 살펴본다.'],
    ];
    for (const [index, [category, title, body]] of examples.entries()) {
      await page.locator('#private-category').selectOption({ label: category });
      await page.locator('#private-note-title').fill(title);
      await page.locator('#private-note-body').fill(body);
      const saved = page.waitForResponse((response) =>
        response.url().endsWith('/api/accounts/' + account.id + '/notes') &&
        response.request().method() === 'POST');
      await page.locator('#private-note-form button[type="submit"]').click();
      assert.equal((await saved).status(), 201);
      await page.waitForFunction((count) =>
        document.querySelectorAll('#private-note-list li').length === count &&
        document.querySelector('#private-status').textContent.includes('가상 메모를 저장'), index + 1);
    }
    const pageSource = await (await fetch(origin)).text();
    for (const [, title, body] of examples) {
      assert.equal(pageSource.includes(title), false);
      assert.equal(pageSource.includes(body), false);
    }
    const ownerNotes = await apiRequest('/api/accounts/' + account.id + '/notes', 'GET', undefined, registered.token);
    assert.equal((await ownerNotes.json()).notes.length, 3);

    const { authenticatorId: auth2 } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { ...virtualOptions, transport: 'usb' },
    });
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId: auth1, enabled: false });
    await page.locator('#private-passkey-name').fill('과제용 보안 키');
    const secondVerify = page.waitForResponse((response) =>
      response.url().endsWith('/api/registration/verify'));
    await page.locator('#private-add-passkey').click();
    const secondResponse = await secondVerify;
    assert.equal(secondResponse.status(), 201, await secondResponse.text());
    const secondRegistered = await secondResponse.json();
    const secondHardware = await cdp.send('WebAuthn.getCredentials', { authenticatorId: auth2 });
    assert.equal(secondHardware.credentials.length, 1);
    const twoPasskeys = await apiRequest('/api/passkeys', 'GET', undefined, registered.token);
    assert.equal((await twoPasskeys.json()).passkeys.length, 2);

    page.once('dialog', (prompt) => prompt.accept());
    const removed = page.waitForResponse((response) =>
      response.url().endsWith('/api/passkeys/' + registered.credentialId) &&
      response.request().method() === 'DELETE');
    await page.locator('#private-passkey-list li').filter({ hasText: '과제용 노트북' })
      .getByRole('button', { name: '삭제' }).click();
    assert.equal((await removed).status(), 200);
    await page.waitForFunction(() => !document.querySelector('#private-locked').hidden);
    assert.equal(
      (await apiRequest('/api/accounts/' + account.id + '/notes', 'GET', undefined, registered.token)).status,
      401,
    );
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId: auth2, enabled: false });
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId: auth1, enabled: true });
    const deletedLogin = page.waitForResponse((response) =>
      response.url().endsWith('/api/authentication/verify'));
    await page.locator('#private-login').click();
    assert.equal((await deletedLogin).status(), 401);

    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId: auth1, enabled: false });
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId: auth2, enabled: true });
    const remainingLogin = page.waitForResponse((response) =>
      response.url().endsWith('/api/authentication/verify'));
    await page.locator('#private-login').click();
    const loginResponse = await remainingLogin;
    assert.equal(loginResponse.status(), 200, await loginResponse.text());
    const ownerAfterDelete = await loginResponse.json();
    await page.waitForFunction(() => !document.querySelector('#private-unlocked').hidden);
    const sameAssertion = loginResponse.request().postDataJSON();
    assert.equal(
      (await apiRequest('/api/authentication/verify', 'POST', sameAssertion)).status,
      401,
    );
    const freshChallenge = await (await apiRequest('/api/authentication/options', 'POST', {})).json();
    const wrongSignature = { ...sameAssertion, requestId: freshChallenge.requestId };
    assert.equal((await apiRequest('/api/authentication/verify', 'POST', wrongSignature)).status, 401);
    assert.equal((await apiRequest('/api/authentication/verify', 'POST', wrongSignature)).status, 401);
    const afterDelete = await apiRequest('/api/passkeys', 'GET', undefined, ownerAfterDelete.token);
    assert.equal((await afterDelete.json()).passkeys.length, 1);
    assert.equal(secondRegistered.credentialId !== registered.credentialId, true);
    assert.equal((await apiRequest('/api/passkeys/' + secondRegistered.credentialId,
      'DELETE', undefined, ownerAfterDelete.token)).status, 409);

    const other = invite('과제용 비교 계정');
    const pageB = await browser.newPage();
    const cdpB = await browser.newCDPSession(pageB);
    await cdpB.send('WebAuthn.enable');
    await cdpB.send('WebAuthn.addVirtualAuthenticator', { options: virtualOptions });
    await pageB.goto(origin + '/#enroll=' + other.value);
    await pageB.locator('#private-open').click();
    await pageB.locator('#private-enroll-name').fill('비교 계정 키');
    const otherVerified = pageB.waitForResponse((response) =>
      response.url().endsWith('/api/registration/verify'));
    await pageB.locator('#private-enroll-button').click();
    const otherResponse = await otherVerified;
    assert.equal(otherResponse.status(), 201, await otherResponse.text());
    const otherToken = (await otherResponse.json()).token;
    const otherPost = await apiRequest('/api/accounts/' + other.id + '/notes', 'POST', {
      category: '프로젝트', title: '다른 계정 메모', body: '계정별 분리를 확인하기 위한 가상 내용',
    }, otherToken);
    assert.equal(otherPost.status, 201);
    assert.equal((await apiRequest('/api/accounts/' + account.id + '/notes', 'GET', undefined, otherToken)).status, 403);
    assert.equal((await apiRequest('/api/accounts/' + other.id + '/notes', 'GET', undefined, ownerAfterDelete.token)).status, 403);
    assert.equal((await apiRequest('/api/accounts/' + account.id + '/notes', 'POST', {
      category: '프로젝트', title: '잘못된 계정 요청', body: '저장되면 안 되는 가상 내용',
    }, otherToken)).status, 403);
    const ownWithOtherId = await apiRequest('/api/accounts/' + other.id + '/notes', 'POST', {
      accountId: account.id,
      category: '프로젝트', title: '본문 계정 변경 시도', body: '그래도 비교 계정에만 들어가는 내용',
    }, otherToken);
    assert.equal(ownWithOtherId.status, 201);
    assert.equal((await (await apiRequest('/api/accounts/' + account.id + '/notes', 'GET', undefined, ownerAfterDelete.token)).json()).notes.length, 3);
    assert.equal((await (await apiRequest('/api/accounts/' + other.id + '/notes', 'GET', undefined, otherToken)).json()).notes.length, 2);

    const logout = page.waitForResponse((response) => response.url().endsWith('/api/logout'));
    await page.locator('#private-logout').click();
    assert.equal((await logout).status(), 200);
    assert.equal(
      (await apiRequest('/api/accounts/' + account.id + '/notes', 'GET', undefined, ownerAfterDelete.token)).status,
      401,
    );
    const replay = await apiRequest('/api/registration/verify', 'POST', {
      requestId: (await registration.request().postDataJSON()).requestId,
      credential: (await registration.request().postDataJSON()).credential,
      name: '재사용',
      inviteToken: account.value,
    });
    assert.equal(replay.status, 401);
  } finally {
    await browser?.close();
    worker.kill();
    site.kill();
  }
});
