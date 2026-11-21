export type TabControlState = 'active' | 'waiting'

// Also used by the Chrome bridge in its isolated script world.
export const tabControlCode = `(owner, state) => {
  let marker = globalThis.__piTabControl;
  if (!state) {
    if (marker?.owner === owner) marker.clear();
    return;
  }
  if (!marker) {
    marker = { title: document.title, displayed: document.title };
    const update = () => {
      if (document.title !== marker.displayed) marker.title = document.title;
      const desired = (marker.state === 'waiting' ? '⏸ ' : '🖱 ') + marker.title;
      marker.displayed = desired;
      if (document.title !== desired) document.title = desired;
    };
    const observer = new MutationObserver(update);
    observer.observe(document.head || document.documentElement, { childList: true, subtree: true, characterData: true });
    marker.update = update;
    marker.clear = () => {
      observer.disconnect();
      clearTimeout(marker.timer);
      if (document.title === marker.displayed) document.title = marker.title;
      delete globalThis.__piTabControl;
    };
    globalThis.__piTabControl = marker;
  }
  marker.owner = owner;
  marker.state = state;
  clearTimeout(marker.timer);
  marker.timer = setTimeout(marker.clear, 18000);
  marker.update();
}`
