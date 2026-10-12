import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnswer, NO_ANSWER } from '../lib/answer.js';

test('splits the answer from a bulleted Sources block', () => {
  const r = parseAnswer('Dice roll on the server.\n\nSources:\n- artifacts/a.ts\n- `RUNNING_LOCALLY.md`');
  assert.deepEqual(r, { answer: 'Dice roll on the server.', sources: ['artifacts/a.ts', 'RUNNING_LOCALLY.md'], isNo: false });
});

test('handles a bold heading with an inline comma list', () => {
  assert.deepEqual(parseAnswer('Yes.\n\n**Sources:** a.md, b.md').sources, ['a.md', 'b.md']);
});

test('uses the last Sources block', () => {
  const r = parseAnswer('Intro\nSources: not this\nMore\n\nSources:\n1. real.md');
  assert.equal(r.answer, 'Intro\nSources: not this\nMore');
  assert.deepEqual(r.sources, ['real.md']);
});

test('the No reply has no sources and isNo', () => {
  assert.deepEqual(parseAnswer(NO_ANSWER), { answer: NO_ANSWER, sources: [], isNo: true });
});

test('text without a Sources block is all answer', () => {
  assert.deepEqual(parseAnswer('Just text.'), { answer: 'Just text.', sources: [], isNo: false });
});

test('a sentence starting with "Sources of" is not a Sources block', () => {
  assert.deepEqual(parseAnswer('Sources of truth live in lib/.').sources, []);
});

test('Drive sources keep their URL; duplicates collapse; CRLF works', () => {
  const r = parseAnswer('A.\r\n\r\nSources:\r\n- context/drive/plan--1.md — https://docs.google.com/document/d/1\r\n- context/drive/plan--1.md — https://docs.google.com/document/d/1');
  assert.deepEqual(r.sources, ['context/drive/plan--1.md — https://docs.google.com/document/d/1']);
});
