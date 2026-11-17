// The only WA-coupled file. Every selector below must be re-checked against the live page.
(function () {
const MC = (globalThis.__machatLib ||= {});
// Emergency switch: blur whole #pane-side and #main until precise selectors are fixed.
MC.COARSE = false; // VERIFY against live page (flip to true if blur selectors break)
MC.SEL = {
  chatList:     '#pane-side',                                   // VERIFY against live page
  chatRow:      '#pane-side [role="listitem"], #pane-side [role="row"]', // VERIFY against live page
  rowName:      'span[title][dir="auto"]',                      // VERIFY against live page
  rowPreview:   'span[title]:not([dir]) , div[role="gridcell"] + div span[dir="ltr"]', // VERIFY against live page
  // Watch all: the last-message line inside one chat row (relative to the row). title holds the full text when present.
  rowLastMsg:   'span[title]:not([dir="auto"]), [role="gridcell"] span[dir="ltr"]', // VERIFY against live page
  rowUnread:    '[aria-label*="unread" i], [data-icon="unread-count"]', // VERIFY against live page (badge inside a row)
  avatar:      'img[src*="pps.whatsapp.net"], [data-icon="default-user"], [data-icon="default-group"]', // VERIFY against live page
  main:         '#main',                                        // VERIFY against live page
  header:       '#main header',                                 // VERIFY against live page
  headerTitle:  '#main header span[dir="auto"]',                // VERIFY against live page (first one = chat name)
  msgRow:       '#main [role="row"]',                           // VERIFY against live page
  msgCopyable:  '[data-pre-plain-text]',                        // VERIFY against live page ("[10:42, 11/8/2026] Alice: ")
  quoted:       '[aria-label^="Quoted"], [data-testid="quoted-message"]', // VERIFY against live page
  msgText:      'span.selectable-text, span[dir="ltr"]',        // VERIFY against live page
  msgOut:       '[data-id^="true_"], .message-out, [data-icon="tail-out"], [data-icon="msg-check"], [data-icon="msg-dblcheck"], [data-icon="msg-dblcheck-ack"], [data-icon="msg-time"]',             // VERIFY against live page
  msgIn:        '[data-id^="false_"], .message-in',             // VERIFY against live page
  media:        'img[src^="blob:"], video, [data-icon="audio-play"], [data-icon^="document"], [data-icon="media-play"]', // VERIFY against live page
  // order matters: first match wins (sticker before image)
  mediaKind: {
    sticker:  'img[alt][draggable="false"][src^="blob:"][width]', // VERIFY against live page
    image:    'img[src^="blob:"]',                                // VERIFY against live page
    video:    'video,[data-icon="media-play"]',                   // VERIFY against live page
    audio:    '[data-icon="audio-play"],[data-icon="ptt-status"]',// VERIFY against live page
    document: '[data-icon^="document"]',                          // VERIFY against live page
    deleted:  '[data-icon="recalled"]',                           // VERIFY against live page
  },
  composer:     'footer [contenteditable="true"][role="textbox"]', // VERIFY against live page
  send:         'footer [data-icon="send"], footer [data-icon="wds-ic-send-filled"], footer button[aria-label="Send"]', // VERIFY against live page (Send now clicks it; only there when the composer has text)
  unread:       '[aria-label*="unread" i]',                     // VERIFY against live page (unread badge inside a chat row; probe.js measures it)
  // Censor targets per category and column. `list` = contact/chat list, `chat` = the open conversation.
  blur: {
    names: {
      list: ['#pane-side span[title][dir="auto"]'], // VERIFY against live page
      // Group chats: the sender's name above a bubble is span[data-testid="author"] (role=button), seen live 2026-11.
      chat: ['#main header span[dir="auto"]', '[data-pre-plain-text] ~ * span[dir="auto"][aria-label]', '#main [data-testid="author"]', '#main [role="row"] span[role="button"][dir="auto"]'], // VERIFY against live page
    },
    avatars: {
      // Pictures with a status ring or a disappearing-messages badge are <svg><image>, not <img> (seen live 2026-11).
      list: ['#pane-side img', '#pane-side svg image', '#pane-side [data-icon="default-user"]', '#pane-side [data-icon="default-group"]'], // VERIFY against live page
      // img[src^="https://"]: profile pictures beside group messages (media is blob:, emoji is data:).
      chat: ['#main header img', '#main img[src^="https://"]', '#main svg image', '#main [data-icon="default-user"]', '#main [data-icon="default-group"]'], // VERIFY against live page
    },
    previews: {
      list: ['#pane-side span[title]:not([dir])', '#pane-side [role="gridcell"] span[dir="ltr"]'], // VERIFY against live page
      chat: [],
    },
    messages: {
      list: [],
      // Message TEXT only: body, caption, quoted-reply and file-name spans. Not every span in the bubble: that also hit
      // WhatsApp's invisible timestamp spacer, so the block ran under the time.
      // [data-pre-plain-text] a span[dir="auto"]: title, description and site of a link-preview card (seen live 2026-11).
      chat: ['#main span.selectable-text', '#main [aria-label^="Quoted"] span', '#main [data-icon^="document"] ~ span', '#main [data-pre-plain-text] a span[dir="auto"]'], // VERIFY against live page
    },
    media: {
      list: [],
      chat: ['#main img[src^="blob:"]', '#main video', '#main canvas'], // VERIFY against live page
    },
  },
  // Pictures inside text (emoji): filtered like media, under the category of the text they sit in.
  inline: {
    names:    { list: ['#pane-side span[dir="auto"] img'], chat: ['#main header span[dir="auto"] img'] }, // VERIFY against live page
    previews: { list: ['#pane-side span[title] img', '#pane-side [role="gridcell"] span[dir="ltr"] img'], chat: [] }, // VERIFY against live page
    messages: { list: [], chat: ['#main span.selectable-text img', '#main [data-pre-plain-text] span img', '#main [aria-label^="Quoted"] img[alt]', '#main img.emoji'] }, // VERIFY against live page
  },
  // Hover-reveal hosts and the scope prefix each column's selectors start with.
  hosts: { list: '#pane-side [role="listitem"], #pane-side [role="row"]', chat: '#main [role="row"]' }, // VERIFY against live page
  scope: { list: '#pane-side', chat: '#main' },                  // VERIFY against live page
  // 0px no-op containers kept so a maintainer can raise them (see COARSE)
  coarse: { list: ['#pane-side'], chat: ['#main'] },              // VERIFY against live page
};
MC.VERSION_NOTE = 'selectors last verified: never (draft) against WA Web (unknown build)';
})();
