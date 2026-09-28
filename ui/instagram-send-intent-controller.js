(function (root, factory) {
  const dependency = typeof module === 'object' && module.exports
    ? require('./semantic-send-intent-controller.js')
    : root?.GeekSemanticSendIntentController;
  const api = factory(dependency);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekInstagramSendIntentController = api;
  if (root?.document && root?.api) api.installShell(root);
})(typeof window !== 'undefined' ? window : globalThis, function (semantic) {
  'use strict';
  if (!semantic || typeof semantic.create !== 'function') {
    throw new Error('SEMANTIC_SEND_INTENT_CONTROLLER_UNAVAILABLE');
  }

  const configured = semantic.create({
    platform: 'instagram',
    accountType: 'instagram',
    displayName: 'Instagram',
    controllerKey: '__geekInstagramSendIntentController',
    shellFlagKey: '__geekInstagramSendIntentControllerShellInstalled',
    observerKey: '__geekInstagramSendIntentControllerObserver',
    composerSelector: '[role="main"] [contenteditable="true"][role="textbox"]',
    threadPathSource: '^/direct/t/([^/?#]+)',
    sendLabelSource: '(send|发送|傳送|invia|envoyer|senden|enviar|envoie|gönder|wyślij)',
    noticeId: 'geek-instagram-send-error',
    version: 1,
  });
  return Object.freeze({ ...configured, isInstagramType: configured.isType });
});
