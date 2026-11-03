import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAccessLink } from '../src/access-links.ts';
const token = '1234567890abcdef1234567890abcdef';
test('entry links support messaging, refresh, old fragments and query parameters', () => {
  for (const path of ['/join/' + token, '/#invite=' + token, '/?invite=' + token])
    assert.deepEqual(parseAccessLink('https://study.test' + path), { invite: token, team_key: '' });
  for (const path of ['/team/' + token, '/#team=' + token])
    assert.deepEqual(parseAccessLink('https://study.test' + path), { invite: '', team_key: token });
  assert.equal(parseAccessLink('https://study.test/'), null);
  for (const path of ['/join/', '/join/short', '/#invite=', '/#team=short'])
    assert.throws(() => parseAccessLink('https://study.test' + path), /incomplete/);
});
