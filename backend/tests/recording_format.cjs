const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync('frontend/js/controller.js', 'utf8');
function setup(supported) {
  const functions = ['recordingMimeType', 'recordingFilename', 'downloadRecording'].map(name => {
    const start = source.indexOf(`  function ${name}(`);
    const end = source.indexOf('\n  function ', start + 1);
    return source.slice(start, end);
  }).join('\n');
  let downloaded;
  const link = { click() { downloaded = { filename: this.download, blob: context.savedBlob }; }, remove() {} };
  const context = vm.createContext({
    window: { MediaRecorder: { isTypeSupported: supported } },
    presentation: { title: 'Meeting: test' },
    document: { createElement: () => link, body: { append() {} } },
    URL: { createObjectURL(blob) { context.savedBlob = blob; return 'blob:test'; } },
    releaseRecordingDownloadUrl() {}, localRecordingDownloadUrl: '',
  });
  vm.runInContext(functions, context);
  return { context, download: () => downloaded };
}

test('prefers H.264/AAC MP4 and negotiates video-only MP4', () => {
  const { context } = setup(() => true);
  assert.equal(context.recordingMimeType(), 'video/mp4;codecs=avc1.424028,mp4a.40.2');
  assert.equal(context.recordingMimeType(false), 'video/mp4;codecs=avc1.424028');
});

test('falls back to real WebM without relabeling it as MP4', () => {
  const { context } = setup(type => type.startsWith('video/webm'));
  assert.equal(context.recordingMimeType(), 'video/webm;codecs=vp8,opus');
  assert(context.recordingFilename(context.recordingMimeType()).endsWith('.webm'));
});

test('lets the browser choose when no explicit codec is supported', () => {
  assert.equal(setup(() => false).context.recordingMimeType(), '');
});

test('preserves MP4 MIME and bytes for untyped browser-storage files', async () => {
  const { context, download } = setup(() => true);
  const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
  context.downloadRecording(new Blob([bytes]), 'video/mp4');
  assert(download().filename.endsWith('.mp4'));
  assert.equal(download().blob.type, 'video/mp4');
  assert.deepEqual(new Uint8Array(await download().blob.arrayBuffer()), bytes);
});

test('keeps the correct WebM extension and safe filename', () => {
  const { context, download } = setup(() => true);
  context.downloadRecording(new Blob(['webm'], { type: 'video/webm' }), 'video/webm');
  assert(download().filename.endsWith('.webm'));
  assert(!download().filename.includes(':'));
});
