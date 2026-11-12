(function (root) {
  function due(records, currentTabId, now, snoozedUntil = {}) {
    return records.filter(record => record && record.tabId !== currentTabId && record.microphoneOn && record.connected && record.hiddenSince > 0 && now - record.at < 180000 && now - record.hiddenSince >= (record.screenSharing ? 300000 : 120000) && now >= Number(snoozedUntil[record.tabId] || 0));
  }
  const policy = { due };
  if (typeof module !== 'undefined' && module.exports) module.exports = policy;
  else root.SnapKeyMeetingReminderPolicy = policy;
})(typeof window !== 'undefined' ? window : globalThis);
