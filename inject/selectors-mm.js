// Mattermost web app (v9/v10, self-hosted). CENSORSHIP ONLY: no reader, no AI button, no draft.
// Selectors come from Mattermost's long-stable class names (SidebarLink, post, post-message__text, user-popover),
// but were NOT checked against a live server: while a selector is wrong, that part of the page stays UNCENSORED.
(function () {
const MC = (globalThis.__machatLib ||= {});
MC.COARSE = false;
const L = '#SidebarContainer', C = '#app-content, #sidebar-right, .ThreadViewer';
const inC = (s) => C.split(', ').map((c) => `${c} ${s}`);
MC.SEL = {
  blur: {
    names: {
      list: [`${L} .SidebarChannelLinkLabel`, `${L} .SidebarLink .Avatar + span`],
      chat: [...inC('.post__header .user-popover'), ...inC('.post__header .post__header-name'), '#channelHeaderTitle', '.channel-header__top .heading'],
    },
    avatars: {
      list: [`${L} .SidebarLink .Avatar`, `${L} .SidebarLink .status-wrapper img`],
      chat: [...inC('.post__img img'), ...inC('.post__img .Avatar'), '.channel-header .Avatar'],
    },
    previews: { list: [], chat: [] }, // Mattermost's sidebar shows no message previews
    messages: {
      list: [],
      chat: [...inC('.post-message__text'), ...inC('.post__body .post-preview__content'), ...inC('.attachment__body'), ...inC('.post-attachment-opengraph__title')],
    },
    media: {
      list: [],
      chat: [...inC('.post-image__column img'), ...inC('.file-preview__button img'), ...inC('.markdown-inline-img'), ...inC('.post__embed-container img'), ...inC('.post__body video'), ...inC('.file-thumbnail')],
    },
  },
  inline: {
    names: { list: [`${L} .SidebarChannelLinkLabel img`], chat: [] },
    previews: { list: [], chat: [] },
    messages: { list: [], chat: [...inC('.post-message__text img.emoticon'), ...inC('.post-message__text span.emoticon')] },
  },
  hosts: { list: `${L} .SidebarLink`, chat: inC('.post').join(', ') },
  scope: { list: L, chat: C },
  coarse: { list: [`${L} .SidebarNavContainer`, `${L} #sidebar-left`], chat: ['#postListContent', '#sidebar-right .post-list', '.ThreadViewer .post-list'] },
};
MC.VERSION_NOTE = 'mattermost selectors: from Mattermost class names, not checked on a live server';
})();
