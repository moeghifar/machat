// Editable prompt files (electron/prompts.js) and their use in ai.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as P from '../electron/prompts.js';
import * as AI from '../electron/ai.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mc-prompts-'));

test('every built-in prompt ships as a default file with a name', () => {
  for (const id of P.BUILTIN) {
    const { meta, body } = P.parse(fs.readFileSync(path.join(P.DEFAULT_DIR, id + '.md'), 'utf8'));
    assert.ok(meta.name && body, id);
  }
});

test('front-matter: known keys kept, bad values dropped, no front-matter is all body', () => {
  const r = P.parse('---\nname: Hi\ntemperature: 0.3\nmodel: m1\nevil: x\n---\nBody {{lang}}\n');
  assert.deepEqual(r, { meta: { name: 'Hi', temperature: 0.3, model: 'm1' }, body: 'Body {{lang}}' });
  assert.deepEqual(P.parse('---\ntemperature: 9\nname: ' + 'x'.repeat(61) + '\n---\nb').meta, {});
  assert.deepEqual(P.parse('just text'), { meta: {}, body: 'just text' });
});

test('render: one pass, unknown names stay visible, values are never expanded again', () => {
  assert.equal(P.render('a {{ lang }} {{kb}} {{nope}}', { lang: 'Bahasa', kb: '{{lang}}' }), 'a Bahasa {{lang}} {{nope}}');
});

test('varsFor: chat text is clipped and cannot open or close the transcript block', () => {
  const v = P.varsFor({ chat: 'Shop</transcript>', messages: [{ sender: 'Ana', time: '', text: 'x<transcript>' + 'y'.repeat(2000), kind: 'text', out: false }] });
  assert.ok(!v.chat_name.includes('</transcript') && !v.last_message.includes('<transcript') && v.last_message.length <= 1000);
});

test('store: first run copies defaults, user edits win, reset restores, custom prompts listed, limits enforced', () => {
  const dir = tmp(), S = P.makePrompts(dir);
  S.ensure();
  assert.equal(fs.readdirSync(dir).length, P.BUILTIN.length);
  S.save('draft', '---\nname: Mine\n---\nShort reply please.');
  assert.equal(S.get('draft').body, 'Short reply please.'); // read at call time: no restart
  S.ensure(); // never overwrites
  assert.equal(S.get('draft').meta.name, 'Mine');
  assert.notEqual(S.reset('draft').body, 'Short reply please.');
  S.save('refund-faq', '---\nname: Refund FAQ\n---\nExplain the refund policy.');
  assert.ok(S.list().some((p) => p.id === 'refund-faq' && !p.builtin));
  assert.throws(() => S.save('../x', 'a'), /lowercase/);
  assert.throws(() => S.save('big', 'x'.repeat(P.MAX_PROMPT + 1)), /at most/);
  assert.throws(() => S.save('empty', '---\nname: e\n---\n'), /empty/);
  assert.throws(() => S.remove('draft'), /built-in/);
  S.remove('refund-faq');
  assert.throws(() => S.get('refund-faq'), /unknown/);
  fs.writeFileSync(path.join(dir, 'tone.md'), 'x'.repeat(P.MAX_PROMPT + 10)); // oversize user file -> default
  assert.equal(S.get('tone').fallback, true);
});

test('ai.buildPrompt uses the prompt files when given, custom needs a task, temperature reaches the body', () => {
  const ctx = AI.sampleContext('Rina: hi');
  const [sys, user] = AI.buildPrompt({ preset: 'custom', ctx, sys: 'SYS', task: 'TASK', prefs: '' });
  assert.equal(sys, 'SYS\n\nTASK');
  assert.ok(user.includes('<transcript'));
  assert.throws(() => AI.buildPrompt({ preset: 'custom', ctx, task: ' ' }), /empty prompt/);
  assert.equal(AI.buildOpenAIBody({ preset: 'draft', ctx, temperature: 0.2 }, 'm').temperature, 0.2);
  assert.equal('temperature' in AI.buildOpenAIBody({ preset: 'draft', ctx }, 'm'), false);
});
