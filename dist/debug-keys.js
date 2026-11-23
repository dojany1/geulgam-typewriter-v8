// Shows what a keyboard sends to the writing box, for phones whose Enter does
// not behave. Loaded only when the address ends with ?keys (see app.js).
(() => {
  'use strict';
  const editor = document.getElementById('editor');
  if (!editor) return;
  const panel = document.createElement('pre');
  panel.style.cssText = 'position:fixed;z-index:99;top:0;left:0;right:0;max-height:46vh;overflow:hidden;margin:0;'
    + 'padding:6px 8px;font:11px/1.35 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all;'
    + 'color:#0f0;background:rgba(0,0,0,.82);pointer-events:none';
  document.body.append(panel);
  const ua = navigator.userAgent;
  const device = (ua.match(/iPhone|iPad|Android [\d.]+|Windows|Mac OS X/) || ['?'])[0];
  const browser = (ua.match(/SamsungBrowser\/[\d.]+|KAKAOTALK|NAVER|CriOS\/\d+|Chrome\/\d+|Version\/[\d.]+ (Mobile\/\S+ )?Safari/) || ['?'])[0];
  const lines = [];
  const tail = () => JSON.stringify(editor.value.slice(-8));
  const state = () => {
    const pull = document.getElementById('pull');
    return 'pull=' + (pull?.disabled ? 'off' : 'on') + ' view=' + document.body.dataset.view
      + ' caret=' + editor.selectionStart + '/' + editor.value.length + ' tail=' + tail();
  };
  const render = () => {
    panel.textContent = '[keys] ' + device + ' · ' + browser + '\n' + lines.slice(-14).join('\n');
  };
  const log = text => {
    lines.push(text);
    render();
  };
  // Bubble listeners on window run after the app's own, so they see whether it cancelled the event.
  window.addEventListener('keydown', event => {
    if (event.target !== editor) return;
    log('keydown key=' + event.key + ' code=' + (event.code || '-') + ' kc=' + event.keyCode
      + ' comp=' + event.isComposing + ' shift=' + event.shiftKey + ' prevented=' + event.defaultPrevented);
  });
  window.addEventListener('beforeinput', event => {
    if (event.target !== editor) return;
    log('beforeinput ' + event.inputType + ' data=' + JSON.stringify(event.data) + ' comp=' + event.isComposing
      + ' cancelable=' + event.cancelable + ' prevented=' + event.defaultPrevented);
  });
  window.addEventListener('input', event => {
    if (event.target !== editor) return;
    log('input ' + (event.inputType || '-') + ' data=' + JSON.stringify(event.data ?? null) + ' | ' + state());
  });
  for (const type of ['compositionstart', 'compositionend']) {
    window.addEventListener(type, event => {
      if (event.target === editor) log(type + ' data=' + JSON.stringify(event.data));
    });
  }
  // The pull, or its absence, shows a moment after the last event.
  let timer;
  editor.addEventListener('keyup', () => {
    clearTimeout(timer);
    timer = setTimeout(() => log('  → ' + state()), 250);
  });
  log('ready · ' + state());
})();
