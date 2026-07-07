// 툴바 아이콘 배지에 ON/OFF 상태 표시
'use strict';

async function updateBadge() {
  try {
    const result = await chrome.storage.local.get(['enabled']);
    const isEnabled = result.enabled !== false;
    await chrome.action.setBadgeText({ text: isEnabled ? 'ON' : 'OFF' });
    await chrome.action.setBadgeBackgroundColor({ color: isEnabled ? '#2ba640' : '#909090' });
  } catch (error) {
    console.error('[ShortsAutoNext] 배지 업데이트 오류:', error);
  }
}

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);

// 팝업 또는 Alt+N으로 상태가 바뀌면 배지 갱신
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) {
    updateBadge();
  }
});
