import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helper.js';

function setup() {
  const env = load();
  const { w, d } = env;
  const dispatched = [];
  const orig = w.EventTarget.prototype.dispatchEvent;
  w.EventTarget.prototype.dispatchEvent = function (e) { dispatched.push(e.type + ':' + (e.key || '')); return orig.call(this, e); };
  // jsdom has no execCommand: insert a text node at the caret
  d.execCommand = (cmd, _ui, text) => {
    if (cmd !== 'insertText') return false;
    w.getSelection().getRangeAt(0).insertNode(d.createTextNode(text));
    return true;
  };
  return { ...env, dispatched };
}

test('insertDraft fills the composer and never sends', () => {
  const { w, d, dispatched } = setup();
  w.__machat.insertDraft('hi <b>there</b>');
  const el = d.querySelector('footer [contenteditable]');
  assert.equal(el.textContent, 'hi <b>there</b>');
  assert.equal(el.children.length, 0);
  assert.equal(w.__sent, undefined);
  assert.ok(!dispatched.some((t) => /^key|^click/.test(t)), dispatched.join());
});

test('insertDraft appends at the end of existing text', () => {
  const { w, d } = setup();
  d.querySelector('footer [contenteditable]').textContent = 'a ';
  w.__machat.insertDraft('b');
  assert.equal(d.querySelector('footer [contenteditable]').textContent, 'a b');
});

test('missing composer toasts and does not throw', () => {
  const { w, d } = setup();
  d.querySelector('footer').remove();
  w.__machat.insertDraft('x');
  assert.match(d.querySelector('.mc-toast').textContent, /composer not found/);
});

test('execCommand failure falls back to beforeinput, still no send', () => {
  const { w, d } = setup();
  d.execCommand = () => false;
  const got = [];
  d.querySelector('footer [contenteditable]').addEventListener('beforeinput', (e) => got.push(e.data));
  w.__machat.insertDraft('yo');
  assert.deepEqual(got, ['yo']);
  assert.equal(w.__sent, undefined);
});
