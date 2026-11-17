// Telegram Web K (https://web.telegram.org/k/). CENSORSHIP ONLY: no reader, no AI button, no draft.
// EVERY selector below is an UNVERIFIED GUESS from memory of Web K's DOM. Nothing here has been checked
// against the live page (the app never loads the real service in tests). Re-check them all before trusting
// the censorship: while a selector is wrong, that part of the page stays UNCENSORED.
(function () {
const MC = (globalThis.__machatLib ||= {});
// Emergency switch: censor whole columns until precise selectors are fixed.
MC.COARSE = false; // VERIFY (unverified guess): flip to true if the selectors below do not match
MC.SEL = {
  blur: {
    names: {
      list: ['#column-left .chatlist-chat .peer-title'],                       // VERIFY (unverified guess)
      chat: ['#column-center .chat-info .peer-title', '#column-center .bubble .peer-title'], // VERIFY (unverified guess)
    },
    avatars: {
      list: ['#column-left .chatlist-chat avatar-element', '#column-left .chatlist-chat .avatar'], // VERIFY (unverified guess)
      chat: ['#column-center .chat-info avatar-element', '#column-center .bubble avatar-element'], // VERIFY (unverified guess)
    },
    previews: {
      list: ['#column-left .chatlist-chat .dialog-subtitle'],                  // VERIFY (unverified guess)
      chat: [],
    },
    messages: {
      list: [],
      // Text elements only: .message is the text block inside the bubble, not the bubble itself. Mentions and links are descendants.
      chat: ['#column-center .bubble .message', '#column-center .bubble .reply-content'], // VERIFY (unverified guess)
    },
    media: {
      list: [],
      chat: ['#column-center .bubble img', '#column-center .bubble video', '#column-center .bubble canvas'], // VERIFY (unverified guess)
    },
  },
  // Pictures inside text (emoji): filtered like media, under the category of the text they sit in.
  inline: {
    names:    { list: ['#column-left .chatlist-chat .peer-title img', '#column-left .chatlist-chat .peer-title custom-emoji-element'], chat: ['#column-center .chat-info .peer-title img'] }, // VERIFY (unverified guess)
    previews: { list: ['#column-left .chatlist-chat .dialog-subtitle img', '#column-left .chatlist-chat .dialog-subtitle custom-emoji-element'], chat: [] }, // VERIFY (unverified guess)
    messages: { list: [], chat: ['#column-center .bubble .message img', '#column-center .bubble .message custom-emoji-element', '#column-center .bubble .reply-content img'] }, // VERIFY (unverified guess)
  },
  hosts: { list: '#column-left a.chatlist-chat, #column-left .chatlist-chat', chat: '#column-center .bubble' }, // VERIFY (unverified guess)
  scope: { list: '#column-left', chat: '#column-center' },                       // VERIFY (unverified guess)
  coarse: { list: ['#column-left .chatlist'], chat: ['#column-center .bubbles'] }, // VERIFY (unverified guess)
};
MC.VERSION_NOTE = 'telegram selectors: unverified guesses';
})();
