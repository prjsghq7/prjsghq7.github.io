(() => {
  const dialog = document.querySelector('#private-dialog');
  const opener = document.querySelector('#private-open');
  if (!dialog || !opener) return;

  const apiBase = location.hostname === 'localhost'
    ? 'http://localhost:8787' : dialog.dataset.apiBase;
  const locked = dialog.querySelector('#private-locked');
  const unlocked = dialog.querySelector('#private-unlocked');
  const status = dialog.querySelector('#private-status');
  const enroll = dialog.querySelector('#private-enroll');
  const notes = dialog.querySelector('#private-note-list');
  const passkeys = dialog.querySelector('#private-passkey-list');
  const noteForm = dialog.querySelector('#private-note-form');
  let sessionToken = null;
  let accountId = null;
  let pending = false;
  let inviteToken = location.hash.startsWith('#enroll=')
    ? location.hash.slice('#enroll='.length) : null;

  if (inviteToken) {
    history.replaceState(null, '', location.pathname + location.search);
    enroll.hidden = false;
  }

  function message(value) {
    status.textContent = value;
  }
  function setLocked() {
    locked.hidden = false;
    unlocked.hidden = true;
    sessionToken = null;
    accountId = null;
    notes.replaceChildren();
    passkeys.replaceChildren();
  }
  function setUnlocked() {
    locked.hidden = true;
    unlocked.hidden = false;
  }
  function fromBase64url(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  function toBase64url(value) {
    return btoa(String.fromCharCode(...new Uint8Array(value)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function creationOptions(options) {
    return {
      ...options,
      challenge: fromBase64url(options.challenge),
      user: { ...options.user, id: fromBase64url(options.user.id) },
      excludeCredentials: (options.excludeCredentials || []).map((item) => ({
        ...item, id: fromBase64url(item.id),
      })),
    };
  }
  function requestOptions(options) {
    return {
      ...options,
      challenge: fromBase64url(options.challenge),
      allowCredentials: (options.allowCredentials || []).map((item) => ({
        ...item, id: fromBase64url(item.id),
      })),
    };
  }
  function credentialJSON(credential) {
    if (typeof credential.toJSON === 'function') return credential.toJSON();
    const response = credential.response;
    const base = {
      id: credential.id,
      rawId: toBase64url(credential.rawId),
      type: credential.type,
      clientExtensionResults: credential.getClientExtensionResults(),
      authenticatorAttachment: credential.authenticatorAttachment,
    };
    if (response.attestationObject) {
      return {
        ...base,
        response: {
          clientDataJSON: toBase64url(response.clientDataJSON),
          attestationObject: toBase64url(response.attestationObject),
          transports: response.getTransports?.() || [],
        },
      };
    }
    return {
      ...base,
      response: {
        clientDataJSON: toBase64url(response.clientDataJSON),
        authenticatorData: toBase64url(response.authenticatorData),
        signature: toBase64url(response.signature),
        userHandle: response.userHandle ? toBase64url(response.userHandle) : null,
      },
    };
  }
  async function api(path, method = 'GET', body) {
    if (!apiBase) throw new Error('인증 서버 주소가 아직 연결되지 않았습니다.');
    const response = await fetch(apiBase + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: 'Bearer ' + sessionToken } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || '요청을 완료하지 못했습니다.');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  async function run(action, cancelled = '패스키 작업이 취소되었습니다.') {
    if (pending) return;
    pending = true;
    message('처리 중입니다…');
    try {
      await action();
    } catch (error) {
      if (error.name === 'NotAllowedError') {
        message(cancelled);
      } else if (error.status === 401 && sessionToken) {
        setLocked();
        message('로그인이 만료되었습니다. 패스키로 다시 들어가 주세요.');
      } else {
        message(error.message || '요청을 완료하지 못했습니다.');
      }
    } finally {
      pending = false;
    }
  }
  function date(value) {
    return new Date(value).toLocaleDateString('ko-KR');
  }
  function renderNotes(items) {
    notes.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('li');
      empty.textContent = '아직 메모가 없습니다. 과제용 가상 메모를 세 개 이상 추가해 주세요.';
      notes.append(empty);
      return;
    }
    for (const item of items) {
      const li = document.createElement('li');
      const category = document.createElement('small');
      const title = document.createElement('h4');
      const body = document.createElement('p');
      category.textContent = item.category;
      title.textContent = item.title;
      body.textContent = item.body;
      li.append(category, title, body);
      notes.append(li);
    }
  }
  function renderPasskeys(items) {
    passkeys.replaceChildren();
    for (const item of items) {
      const li = document.createElement('li');
      const detail = document.createElement('span');
      const name = document.createElement('strong');
      const created = document.createElement('small');
      name.textContent = item.name + (item.current ? ' · 현재 사용 중' : '');
      created.textContent = '등록일 ' + date(item.created_at);
      detail.append(name, created);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '삭제';
      remove.disabled = items.length <= 1;
      remove.addEventListener('click', () => {
        if (!confirm(item.name + ' 패스키를 삭제할까요?')) return;
        run(async () => {
          const result = await api('/api/passkeys/' + encodeURIComponent(item.id), 'DELETE');
          if (result.currentSessionRevoked) {
            setLocked();
            message('현재 패스키가 삭제되었습니다. 남은 패스키로 다시 로그인해 주세요.');
          } else {
            await loadPrivate();
            message('패스키를 삭제했습니다.');
          }
        });
      });
      li.append(detail, remove);
      passkeys.append(li);
    }
  }
  async function loadPrivate() {
    const account = await api('/api/me');
    accountId = account.id;
    dialog.querySelector('#private-account-label').textContent = account.label;
    const [noteData, passkeyData] = await Promise.all([
      api('/api/accounts/' + encodeURIComponent(accountId) + '/notes'),
      api('/api/passkeys'),
    ]);
    renderNotes(noteData.notes);
    renderPasskeys(passkeyData.passkeys);
    setUnlocked();
  }
  async function register(name, first) {
    if (!window.PublicKeyCredential || !navigator.credentials?.create) {
      throw new Error('이 브라우저 또는 기기에서 패스키를 사용할 수 없습니다.');
    }
    if (name.trim().length < 2) throw new Error('패스키 이름을 2자 이상 입력해 주세요.');
    const options = await api('/api/registration/options', 'POST',
      first ? { inviteToken } : {});
    const credential = await navigator.credentials.create({
      publicKey: creationOptions(options.options),
    });
    if (!credential) throw new Error('패스키 등록이 완료되지 않았습니다.');
    const result = await api('/api/registration/verify', 'POST', {
      requestId: options.requestId,
      credential: credentialJSON(credential),
      name: name.trim(),
      ...(first ? { inviteToken } : {}),
    });
    if (result.token) sessionToken = result.token;
    if (first) {
      inviteToken = null;
      enroll.hidden = true;
    }
    await loadPrivate();
    message('패스키 등록을 완료했습니다.');
  }

  opener.addEventListener('click', () => {
    message('');
    dialog.showModal();
    if (sessionToken) run(loadPrivate);
  });
  dialog.querySelector('#private-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => opener.focus());
  dialog.querySelector('#private-login').addEventListener('click', () => run(async () => {
    if (!window.PublicKeyCredential || !navigator.credentials?.get) {
      throw new Error('이 브라우저 또는 기기에서 패스키를 사용할 수 없습니다.');
    }
    const options = await api('/api/authentication/options', 'POST', {});
    const credential = await navigator.credentials.get({
      publicKey: requestOptions(options.options),
    });
    if (!credential) throw new Error('패스키 로그인이 완료되지 않았습니다.');
    const result = await api('/api/authentication/verify', 'POST', {
      requestId: options.requestId,
      credential: credentialJSON(credential),
    });
    sessionToken = result.token;
    await loadPrivate();
    message('패스키로 로그인했습니다.');
  }, '패스키 로그인이 취소되었습니다.'));
  dialog.querySelector('#private-enroll-button').addEventListener('click', () =>
    run(() => register(dialog.querySelector('#private-enroll-name').value, true),
      '패스키 등록이 취소되었습니다. 저장된 패스키는 없습니다.'));
  dialog.querySelector('#private-add-passkey').addEventListener('click', () =>
    run(() => register(dialog.querySelector('#private-passkey-name').value, false),
      '패스키 등록이 취소되었습니다. 새 패스키는 저장되지 않았습니다.'));
  dialog.querySelector('#private-logout').addEventListener('click', () => run(async () => {
    await api('/api/logout', 'POST', {});
    setLocked();
    message('로그아웃했습니다.');
  }));
  noteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    run(async () => {
      await api('/api/accounts/' + encodeURIComponent(accountId) + '/notes', 'POST', {
        category: dialog.querySelector('#private-category').value,
        title: dialog.querySelector('#private-note-title').value,
        body: dialog.querySelector('#private-note-body').value,
      });
      noteForm.reset();
      await loadPrivate();
      message('가상 메모를 저장했습니다.');
    });
  });
})();
