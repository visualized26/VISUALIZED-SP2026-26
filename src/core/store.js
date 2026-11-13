// Tiny reactive store: UI modules subscribe; the core never touches the DOM.
export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      subs.forEach((fn) => fn(state, prev));
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

// per-viewer conveniences only (favourites); never required for the app to work
export const local = {
  read(key, fallback) {
    try {
      const v = localStorage.getItem(`visualized:${key}`);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(`visualized:${key}`, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};
