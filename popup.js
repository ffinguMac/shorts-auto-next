(function() {
  'use strict';

  const toggle = document.getElementById('toggle');
  const status = document.getElementById('status');
  const toggleAds = document.getElementById('toggleAds');
  const statusAds = document.getElementById('statusAds');

  function renderEnabled(isEnabled) {
    toggle.checked = isEnabled;
    status.textContent = isEnabled ? '켜짐 - 영상이 끝나면 자동으로 넘어갑니다' : '꺼짐';
    status.classList.toggle('on', isEnabled);
  }

  function renderSkipAds(skipAds) {
    toggleAds.checked = skipAds;
    statusAds.textContent = skipAds ? '켜짐 - 광고 쇼츠를 바로 건너뜁니다' : '꺼짐';
    statusAds.classList.toggle('on', skipAds);
  }

  // 초기 상태 로드
  chrome.storage.local.get(['enabled', 'skipAds'], (result) => {
    renderEnabled(result.enabled !== false);
    renderSkipAds(result.skipAds !== false);
  });

  // 토글 변경 시 저장 (content script와 배지는 storage.onChanged로 동기화됨)
  toggle.addEventListener('change', () => {
    chrome.storage.local.set({ enabled: toggle.checked });
    renderEnabled(toggle.checked);
  });

  toggleAds.addEventListener('change', () => {
    chrome.storage.local.set({ skipAds: toggleAds.checked });
    renderSkipAds(toggleAds.checked);
  });

  // 팝업이 열려있는 동안 다른 곳(Alt+N)에서 바뀌면 반영
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled) {
      renderEnabled(changes.enabled.newValue !== false);
    }
    if (changes.skipAds) {
      renderSkipAds(changes.skipAds.newValue !== false);
    }
  });
})();
