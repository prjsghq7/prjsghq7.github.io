import { createHash, randomBytes, randomUUID } from 'node:crypto';

const label = process.argv.slice(2).join(' ').trim();
if (!label || label.length > 40) {
  console.error('사용법: node invite.mjs <가상 계정 이름>');
  process.exit(1);
}
const accountId = randomUUID();
const value = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(value).digest('base64url');
const expiresAt = Date.now() + 15 * 60 * 1000;
const sqlLabel = label.replaceAll("'", "''");
console.log('초대 링크 (15분 유효, 제출물에 포함 금지):');
console.log('https://prjsghq7.github.io/portfolio/#enroll=' + value);
console.log('\nD1에 한 번만 실행할 SQL:');
console.log("INSERT INTO accounts (id, label, created_at) VALUES ('" +
  accountId + "', '" + sqlLabel + "', " + Date.now() + ');');
console.log("INSERT INTO invites (token_hash, account_id, expires_at) VALUES ('" +
  hash + "', '" + accountId + "', " + expiresAt + ');');
