chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({color: '#43A047'});  // green
});

// Toggles the ON/OFF extension status.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url.startsWith('chrome://')) return;

  // This gives the extension new on/off status.
  const [{result: isTurnedOn}] = await chrome.scripting.executeScript({
    target: {tabId: tab.id},
    files: ['injected.js'],
  });

  await Promise.all(
      isTurnedOn ?
          [
            chrome.scripting.insertCSS({
              target: {tabId: tab.id},
              files: ['injected.css'],
            }),
            chrome.action.setTitle({
              tabId: tab.id,
              title: 'Hover Highlighter (ON)',
            }),
            chrome.action.setBadgeText({tabId: tab.id, text: 'ON'}),
          ] :
          [
            chrome.scripting.removeCSS({
              target: {tabId: tab.id},
              files: ['injected.css'],
            }),
            chrome.action.setTitle({
              tabId: tab.id,
              title: 'Hover Highlighter (OFF)',
            }),
            chrome.action.setBadgeText({tabId: tab.id, text: ''}),
          ]);
});
