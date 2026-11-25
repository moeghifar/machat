// What each service supports. Plain data with no imports: main and the shell (src/) both read it.
export const CENSOR_OK = ['whatsapp', 'telegram', 'mattermost']; // the others get a stub instead of inject/blur.js
export const AI_OK = ['whatsapp']; // the AI reader exists for WhatsApp only
/** True when nothing is active (Home) or the service has blur. */
export const censorOk = (service) => !service || CENSOR_OK.includes(service);
export const aiOk = (service) => !service || AI_OK.includes(service);
