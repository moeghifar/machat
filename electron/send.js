// Send now (ADR-5): one click by the user sends one message, after a random pause. Pure: no electron import (node --test).
// Full auto (ADR-6) reuses the same sender from main (one pending, jitter, gap); the agent process itself never sends.

export const JITTER_MIN_MS = 1200, JITTER_MAX_MS = 3500; // uniform pause before every send
export const MIN_GAP_MS = 4000; // two sends are at least this plus a jitter apart

export const jitter = (rnd = Math.random) => Math.round(JITTER_MIN_MS + rnd() * (JITTER_MAX_MS - JITTER_MIN_MS));

/** Why main must not send now, or null. state: main's { locked, focused, active }; acct: the account the draft is for. */
export const sendBlocked = (state, acct) =>
  state.locked ? 'Machat is locked' : !state.focused ? 'Machat lost focus' : state.active !== acct ? 'the account changed' : null;

/** One pending send at a time. fire(job) runs once, after the delay start() returned, unless cancel() came first. */
export function makeSender({ fire, now = Date.now, rnd = Math.random, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let pending = null, last = -Infinity;
  return {
    get pending() { return pending ? pending.job : null; },
    /** Returns the delay in ms. Throws while another send is pending: clicks never pile up. */
    start(job) {
      if (pending) throw new Error('a send is already pending');
      const j = jitter(rnd), delay = Math.max(j, last + MIN_GAP_MS + j - now());
      pending = { job, timer: setTimer(() => { pending = null; last = now(); fire(job); }, delay) };
      return delay;
    },
    /** Drops the pending send and returns its job, or null when there is none. */
    cancel() {
      if (!pending) return null;
      clearTimer(pending.timer);
      const { job } = pending;
      pending = null;
      return job;
    },
  };
}
