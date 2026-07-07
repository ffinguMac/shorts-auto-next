(function() {
  'use strict';

  const PREFIX = '[ShortsAutoNext]';
  const CHECK_INTERVAL = 300; // ms
  const DURATION_EPSILON = 0.5; // seconds
  const TOAST_DURATION = 1000; // ms
  const NAVIGATION_DELAY = 300; // ms - 쇼츠 종료 후 다음으로 넘어가기 전 대기 시간
  const AD_CHECK_INTERVAL = 500; // ms - 광고 감지 주기

  // 즉시 실행되는 로그 (스크립트가 로드되었는지 확인용) - 가장 먼저 실행되어야 함
  console.log(`${PREFIX} ========== 스크립트 로드됨 ==========`);
  console.log(`${PREFIX} 현재 URL: ${window.location.href}`);
  console.log(`${PREFIX} Pathname: ${window.location.pathname}`);
  console.log(`${PREFIX} Timestamp: ${Date.now()}`);
  
  // Shorts 페이지인지 확인하는 함수 (동적으로 체크)
  function isShortsPage() {
    const pathname = window.location.pathname || '';
    const isShorts = pathname.includes('/shorts/');
    console.log(`${PREFIX} isShortsPage() 체크: ${isShorts} (pathname: ${pathname})`);
    return isShorts;
  }
  
  console.log(`${PREFIX} 초기 Shorts 페이지 여부: ${isShortsPage()}`);

  let isEnabled = true;
  let currentVideo = null;
  let checkIntervalId = null;
  let lastCurrentTime = 0;
  let observer = null;
  let toastContainer = null;
  let isNavigating = false; // 이동 중 플래그
  let navigationTimeout = null; // 이동 타임아웃
  let manualNavigationTime = 0; // 사용자가 수동으로 넘긴 시간 (timestamp)
  let manualNavigationTimeout = null; // 수동 이동 타임아웃
  let navScheduleTimeout = null; // 예약된 자동 이동 타임아웃 (중복 예약 방지)
  let skipAds = true; // 광고 자동 넘기기 설정
  let adCheckIntervalId = null; // 광고 감지 인터벌

  // 초기화
  async function init() {
    try {
      // Shorts 페이지인지 확인
      if (!isShortsPage()) {
        console.log(`${PREFIX} Shorts 페이지가 아니므로 초기화 취소`);
        return;
      }
      
      console.log(`${PREFIX} 초기화 시작`);
      
      // 저장된 설정 불러오기
      const result = await chrome.storage.local.get(['enabled', 'skipAds']);
      isEnabled = result.enabled !== undefined ? result.enabled : true;
      skipAds = result.skipAds !== undefined ? result.skipAds : true;
      console.log(`${PREFIX} 설정 로드: ${isEnabled ? 'ON' : 'OFF'}, 광고 넘기기: ${skipAds ? 'ON' : 'OFF'}`);

      // 토스트 컨테이너 생성
      createToastContainer();

      // 키보드 단축키 리스너 등록
      setupKeyboardShortcut();

      // 비디오 감지 시작
      setupVideoObserver();

      // 광고 감지 시작
      startAdWatcher();

      // 초기 비디오 찾기
      findAndBindVideo();

      console.log(`${PREFIX} 초기화 완료`);
    } catch (error) {
      console.error(`${PREFIX} 초기화 오류:`, error);
    }
  }

  // 토스트 컨테이너 생성
  function createToastContainer() {
    try {
      toastContainer = document.createElement('div');
      toastContainer.id = 'shorts-auto-next-toast';
      toastContainer.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 999999;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        color: #fff;
        background: rgba(0, 0, 0, 0.8);
        padding: 12px 20px;
        border-radius: 8px;
        opacity: 0;
        transform: translateY(10px);
        transition: opacity 0.3s, transform 0.3s;
      `;
      document.body.appendChild(toastContainer);
    } catch (error) {
      console.error(`${PREFIX} 토스트 컨테이너 생성 오류:`, error);
    }
  }

  // 토스트 메시지 표시
  function showToast(message) {
    try {
      if (!toastContainer) return;
      
      toastContainer.textContent = message;
      toastContainer.style.opacity = '1';
      toastContainer.style.transform = 'translateY(0)';

      setTimeout(() => {
        if (toastContainer) {
          toastContainer.style.opacity = '0';
          toastContainer.style.transform = 'translateY(10px)';
        }
      }, TOAST_DURATION);
    } catch (error) {
      console.error(`${PREFIX} 토스트 표시 오류:`, error);
    }
  }

  // 키보드 단축키 설정
  function setupKeyboardShortcut() {
    try {
      document.addEventListener('keydown', (e) => {
        // 확장프로그램이 만든 합성 이벤트는 무시 (실제 사용자 입력만 감지)
        if (!e.isTrusted) return;

        // Alt+N
        if (e.altKey && e.key === 'n') {
          e.preventDefault();
          toggleEnabled();
          return;
        }
        
        // 사용자가 수동으로 ArrowDown/ArrowUp 키를 눌렀는지 감지
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          // Alt 키가 눌리지 않은 경우에만 수동 이동으로 간주
          if (!e.altKey && !e.ctrlKey && !e.metaKey) {
            console.log(`${PREFIX} 사용자 수동 이동 감지: ${e.key}`);
            markManualNavigation();
          }
        }
      }, true); // capture phase에서 먼저 감지
      
      // 클릭 이벤트 감지 (YouTube Shorts UI 클릭) - 더 광범위하게 감지
      document.addEventListener('click', (e) => {
        try {
          // 확장프로그램이 만든 합성 클릭은 무시 (실제 사용자 클릭만 감지)
          if (!e.isTrusted) return;

          lastClickTime = Date.now(); // 클릭 시간 기록
          
          const target = e.target;
          if (!target) return;
          
          // 모든 버튼 클릭 감지 (더 광범위하게)
          const button = target.closest('button');
          if (button) {
            const ariaLabel = button.getAttribute('aria-label') || '';
            const buttonText = button.textContent || '';
            const buttonId = button.id || '';
            const buttonClass = button.className || '';
            
            // 다음/이전 관련 버튼인지 확인 (더 많은 패턴 감지)
            if (ariaLabel.includes('다음') || ariaLabel.includes('Next') ||
                ariaLabel.includes('이전') || ariaLabel.includes('Previous') ||
                ariaLabel.includes('다음 동영상') || ariaLabel.includes('Next video') ||
                ariaLabel.includes('이전 동영상') || ariaLabel.includes('Previous video') ||
                buttonText.includes('다음') || buttonText.includes('Next') ||
                buttonText.includes('이전') || buttonText.includes('Previous') ||
                buttonId.includes('next') || buttonId.includes('previous') ||
                buttonClass.includes('next') || buttonClass.includes('previous')) {
              console.log(`${PREFIX} 사용자 수동 이동 감지: 버튼 클릭 (${ariaLabel || buttonText || buttonId})`);
              markManualNavigation();
              return;
            }
          }
          
          // 비디오 영역 클릭 감지 (특히 하단 영역 - 다음으로 이동하는 영역)
          const video = target.closest('video') || document.querySelector('video');
          if (video) {
            const rect = video.getBoundingClientRect();
            const clickY = e.clientY - rect.top;
            const videoHeight = rect.height;
            
            // 비디오 하단 40% 영역 클릭 시 다음으로 이동하는 것으로 간주 (범위 확대)
            if (clickY > videoHeight * 0.6) {
              console.log(`${PREFIX} 사용자 수동 이동 감지: 비디오 하단 영역 클릭 (${(clickY/videoHeight*100).toFixed(0)}%)`);
              markManualNavigation();
            }
          }
          
          // Shorts 플레이어 전체 영역 클릭도 감지 (더 광범위하게)
          const shortsPlayer = target.closest('ytd-shorts, ytd-reel-player-overlay-renderer');
          if (shortsPlayer && !target.closest('button')) {
            // 버튼이 아닌 플레이어 영역 클릭도 수동 이동으로 간주
            // 하지만 너무 광범위하므로 일단 주석 처리
            // console.log(`${PREFIX} 사용자 수동 이동 감지: Shorts 플레이어 영역 클릭`);
            // markManualNavigation();
          }
        } catch (error) {
          // 클릭 감지 오류는 무시 (너무 많은 로그 방지)
        }
      }, true); // capture phase에서 먼저 감지
      
      console.log(`${PREFIX} 키보드 단축키 등록: Alt+N`);
    } catch (error) {
      console.error(`${PREFIX} 키보드 단축키 설정 오류:`, error);
    }
  }

  // 사용자 수동 이동 표시
  function markManualNavigation() {
    try {
      manualNavigationTime = Date.now();
      console.log(`${PREFIX} 수동 이동 표시 (${manualNavigationTime})`);

      // 예약된 자동 이동이 있으면 취소 (수동 이동 + 자동 이동 = 2번 넘어감 방지)
      if (navScheduleTimeout) {
        clearTimeout(navScheduleTimeout);
        navScheduleTimeout = null;
        console.log(`${PREFIX} 예약된 자동 이동 취소 (수동 이동)`);
      }

      // 즉시 비디오 정리 (중요: 기존 이벤트 리스너 제거)
      cleanupVideo();
      
      // 기존 타임아웃 제거
      if (manualNavigationTimeout) {
        clearTimeout(manualNavigationTimeout);
      }
      
      // 3초 동안 자동 이동 비활성화 (더 길게)
      manualNavigationTimeout = setTimeout(() => {
        manualNavigationTime = 0;
        manualNavigationTimeout = null;
        console.log(`${PREFIX} 수동 이동 플래그 해제 - 비디오 재바인딩 시작`);
        
        // 플래그 해제 후 비디오 재바인딩하여 자동 이동 재개
        // 현재 비디오가 있어도 강제로 재바인딩
        setTimeout(() => {
          console.log(`${PREFIX} 수동 이동 플래그 해제 후 비디오 재검색 (현재 비디오: ${currentVideo ? '있음' : '없음'})`);
          
          // 현재 비디오가 있으면 정리하고 재바인딩
          if (currentVideo) {
            console.log(`${PREFIX} 기존 비디오 정리 후 재바인딩`);
            cleanupVideo();
          }
          
          // 비디오 재검색 및 바인딩
          const video = findActiveVideo();
          if (video) {
            console.log(`${PREFIX} 비디오 발견, 재바인딩 시작`);
            currentVideo = video;
            bindVideoEvents(video);
            startCheckInterval(video);
            console.log(`${PREFIX} 비디오 재바인딩 완료`);
          } else {
            console.log(`${PREFIX} 비디오를 찾을 수 없음, findAndBindVideo 호출`);
            findAndBindVideo();
          }
        }, 500);
      }, 3000);
      
      // 새 비디오가 로드될 때까지 충분히 기다린 후 재바인딩
      // YouTube가 비디오를 변경하는데 시간이 걸리므로 더 긴 대기
      setTimeout(() => {
        // 수동 이동 중이 아닐 때만 재바인딩
        if (!isManualNavigation()) {
          console.log(`${PREFIX} 수동 이동 후 비디오 재바인딩`);
          findAndBindVideo();
        }
      }, 1000); // 1초 대기 (비디오 변경 완료 대기)
    } catch (error) {
      console.error(`${PREFIX} 수동 이동 표시 오류:`, error);
    }
  }
  
  // 수동 이동 여부 확인
  function isManualNavigation() {
    if (manualNavigationTime === 0) return false;
    const timeSinceManualNav = Date.now() - manualNavigationTime;
    return timeSinceManualNav < 3000; // 3초 이내
  }

  // ON/OFF 토글
  async function toggleEnabled() {
    try {
      isEnabled = !isEnabled;
      await chrome.storage.local.set({ enabled: isEnabled });
      
      const status = isEnabled ? 'ON' : 'OFF';
      console.log(`${PREFIX} 상태 변경: ${status}`);
      showToast(`AutoNext: ${status}`);

      if (isEnabled) {
        findAndBindVideo();
      } else {
        cleanupVideo();
      }
    } catch (error) {
      console.error(`${PREFIX} 토글 오류:`, error);
    }
  }

  // 팝업 등 다른 곳에서 설정이 변경되면 동기화
  chrome.storage.onChanged.addListener((changes, area) => {
    try {
      if (area !== 'local') return;

      // 자동 넘김 ON/OFF
      if (changes.enabled) {
        const newValue = changes.enabled.newValue !== false;
        if (newValue !== isEnabled) { // Alt+N 토글 등 이미 반영된 변경은 무시
          isEnabled = newValue;
          const status = isEnabled ? 'ON' : 'OFF';
          console.log(`${PREFIX} 설정 변경 감지 (팝업): ${status}`);
          showToast(`AutoNext: ${status}`);

          if (isEnabled) {
            findAndBindVideo();
          } else {
            cleanupVideo();
          }
        }
      }

      // 광고 자동 넘기기 ON/OFF
      if (changes.skipAds) {
        const newValue = changes.skipAds.newValue !== false;
        if (newValue !== skipAds) {
          skipAds = newValue;
          const status = skipAds ? 'ON' : 'OFF';
          console.log(`${PREFIX} 광고 넘기기 설정 변경: ${status}`);
          showToast(`광고 건너뛰기: ${status}`);
        }
      }
    } catch (error) {
      console.error(`${PREFIX} 설정 동기화 오류:`, error);
    }
  });

  // 현재 재생 중인 비디오 찾기
  function findActiveVideo() {
    try {
      const videos = document.querySelectorAll('video');
      console.log(`${PREFIX} 발견된 비디오 개수: ${videos.length}`);
      
      if (videos.length === 0) {
        // Shadow DOM 내부도 확인 시도
        const ytdShorts = document.querySelector('ytd-shorts');
        if (ytdShorts) {
          const shadowVideos = ytdShorts.shadowRoot?.querySelectorAll('video');
          if (shadowVideos && shadowVideos.length > 0) {
            console.log(`${PREFIX} Shadow DOM에서 비디오 발견: ${shadowVideos.length}개`);
            return shadowVideos[0];
          }
        }
        return null;
      }

      // 화면 중앙에 가장 가까운 비디오 찾기
      const viewportCenter = window.innerHeight / 2;
      let bestVideo = null;
      let minDistance = Infinity;

      for (const video of videos) {
        try {
          const rect = video.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0 && 
                           rect.top < window.innerHeight && 
                           rect.bottom > 0;
          
          if (isVisible) {
            const centerY = rect.top + rect.height / 2;
            const distance = Math.abs(centerY - viewportCenter);
            
            // 재생 중인 비디오 우선
            if (!video.paused && !video.ended && video.readyState >= 2) {
              if (distance < minDistance) {
                minDistance = distance;
                bestVideo = video;
              }
            } else if (!bestVideo || distance < minDistance) {
              minDistance = distance;
              bestVideo = video;
            }
          }
        } catch (e) {
          // 개별 비디오 처리 오류는 무시
        }
      }

      if (bestVideo) {
        console.log(`${PREFIX} 활성 비디오 선택: paused=${bestVideo.paused}, ended=${bestVideo.ended}, readyState=${bestVideo.readyState}`);
        return bestVideo;
      }

      // 마지막으로 첫 번째 비디오
      if (videos[0]) {
        console.log(`${PREFIX} 첫 번째 비디오 사용`);
        return videos[0];
      }

      return null;
    } catch (error) {
      console.error(`${PREFIX} 비디오 찾기 오류:`, error);
      return null;
    }
  }

  // 비디오 찾기 및 바인딩
  function findAndBindVideo() {
    try {
      if (!isEnabled) {
        cleanupVideo();
        return;
      }

      const video = findActiveVideo();
      
      if (video && video !== currentVideo) {
        // 비디오가 변경되었을 때 수동 이동이 있었는지 확인
        const wasManualNav = isManualNavigation();
        if (wasManualNav) {
          console.log(`${PREFIX} 비디오 변경 감지 (수동 이동 중이므로 자동 이동 스킵)`);
        }
        
        cleanupVideo();
        currentVideo = video;
        
        // 비디오가 로드될 때까지 대기
        if (video.readyState < 2) {
          console.log(`${PREFIX} 비디오 로딩 대기 중...`);
          video.addEventListener('loadeddata', () => {
            // 새 비디오가 로드되면 이동 플래그 해제
            isNavigating = false;
            if (navigationTimeout) {
              clearTimeout(navigationTimeout);
              navigationTimeout = null;
            }
            bindVideoEvents(video);
            startCheckInterval(video);
            console.log(`${PREFIX} 비디오 바인딩 완료 (loadeddata)`);
          }, { once: true });
        } else {
          // 새 비디오가 로드되면 이동 플래그 해제
          isNavigating = false;
          if (navigationTimeout) {
            clearTimeout(navigationTimeout);
            navigationTimeout = null;
          }
          bindVideoEvents(video);
          startCheckInterval(video);
          console.log(`${PREFIX} 비디오 바인딩 완료`);
        }
      } else if (!video && currentVideo) {
        console.log(`${PREFIX} 비디오가 사라짐`);
        cleanupVideo();
      } else if (video && video === currentVideo) {
        // 이미 바인딩된 비디오인 경우, 상태 확인
        if (!checkIntervalId) {
          console.log(`${PREFIX} 기존 비디오 재바인딩`);
          bindVideoEvents(video);
          startCheckInterval(video);
        }
      }
    } catch (error) {
      console.error(`${PREFIX} 비디오 바인딩 오류:`, error);
    }
  }

  // 비디오 이벤트 바인딩
  function bindVideoEvents(video) {
    try {
      video.addEventListener('ended', handleVideoEnded);
      lastCurrentTime = video.currentTime || 0;
    } catch (error) {
      console.error(`${PREFIX} 비디오 이벤트 바인딩 오류:`, error);
    }
  }

  // 비디오 정리
  function cleanupVideo() {
    try {
      if (currentVideo) {
        // ended 이벤트 리스너 제거
        currentVideo.removeEventListener('ended', handleVideoEnded);
        currentVideo = null;
      }
      
      // 체크 인터벌 즉시 중지 (중요!)
      if (checkIntervalId) {
        clearInterval(checkIntervalId);
        checkIntervalId = null;
        console.log(`${PREFIX} 체크 인터벌 중지 (비디오 정리)`);
      }
      
      lastCurrentTime = 0;
      
      // 이동 플래그는 유지 (새 비디오가 로드될 때까지)
    } catch (error) {
      console.error(`${PREFIX} 비디오 정리 오류:`, error);
    }
  }

  // 요소가 현재 화면에 보이는지 확인
  function isElementInView(el) {
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      // 뷰포트와 겹치는지 확인 (아래에 미리 로드된 다음 릴은 제외됨)
      return rect.top < window.innerHeight && rect.bottom > 0;
    } catch (e) {
      return false;
    }
  }

  // 현재 화면의 쇼츠가 광고인지 확인
  function isAdShowing() {
    try {
      // 활성 릴 찾기 (YouTube 버전에 따라 구조가 다를 수 있어 여러 셀렉터 시도)
      const activeReel =
        document.querySelector('ytd-reel-video-renderer[is-active]') ||
        document.querySelector('yt-reel-video-renderer[is-active]') ||
        document.querySelector('[is-active][id^="reel-video-renderer"]');
      const scope = activeReel || document;

      // 1. 광고 슬롯 요소 확인
      const adSlots = scope.querySelectorAll('ytd-ad-slot-renderer, .ytd-ad-slot-renderer, ad-slot-renderer');
      for (const slot of adSlots) {
        if (isElementInView(slot)) return true;
      }

      // 2. "스폰서" / "Sponsored" 뱃지 확인
      const badges = scope.querySelectorAll(
        '.badge-shape-wiz__text, ytd-badge-supported-renderer, badge-shape'
      );
      for (const badge of badges) {
        const text = (badge.textContent || '').trim();
        if ((text.includes('스폰서') || text.includes('Sponsored')) && isElementInView(badge)) {
          return true;
        }
      }

      return false;
    } catch (error) {
      // 감지 실패 시 광고가 아닌 것으로 간주 (오탐으로 일반 쇼츠를 넘기는 것 방지)
      return false;
    }
  }

  // 광고 감지 인터벌 시작
  function startAdWatcher() {
    try {
      if (adCheckIntervalId) return; // 이미 실행 중이면 중복 생성 방지

      adCheckIntervalId = setInterval(() => {
        try {
          if (!isEnabled || !skipAds) return;
          // isShortsPage()는 매번 로그를 찍으므로 직접 확인
          if (!(window.location.pathname || '').includes('/shorts/')) return;
          // 이동 중이거나 이미 예약되어 있으면 스킵
          if (isNavigating || navScheduleTimeout) return;
          // 사용자가 방금 수동으로 넘긴 직후에는 개입하지 않음 (2번 넘어감 방지)
          if (isManualNavigation()) return;

          if (isAdShowing()) {
            console.log(`${PREFIX} 광고 감지, 다음 쇼츠로 이동`);
            showToast('광고 건너뛰기');
            scheduleNavigation('광고 감지');
          }
        } catch (error) {
          // 개별 체크 오류는 무시
        }
      }, AD_CHECK_INTERVAL);

      console.log(`${PREFIX} 광고 감지 시작 (${AD_CHECK_INTERVAL}ms 주기)`);
    } catch (error) {
      console.error(`${PREFIX} 광고 감지 시작 오류:`, error);
    }
  }

  // 자동 이동 예약 (한 번에 하나만 예약되도록 보장)
  function scheduleNavigation(reason) {
    if (navScheduleTimeout) {
      console.log(`${PREFIX} 이미 이동이 예약되어 있으므로 무시 (${reason})`);
      return;
    }
    if (isNavigating) {
      console.log(`${PREFIX} 이미 이동 중이므로 예약 취소 (${reason})`);
      return;
    }
    console.log(`${PREFIX} 딜레이 ${NAVIGATION_DELAY}ms 후 이동 예약 (${reason})`);
    navScheduleTimeout = setTimeout(() => {
      navScheduleTimeout = null;
      goToNextShorts();
    }, NAVIGATION_DELAY);
  }

  // 비디오 종료 처리
  function handleVideoEnded() {
    try {
      console.log(`${PREFIX} ended 이벤트 감지`);
      
      // 이미 이동 중이면 무시
      if (isNavigating) {
        console.log(`${PREFIX} 이미 이동 중이므로 ended 이벤트 무시`);
        return;
      }
      
          // 사용자가 최근에 수동으로 넘겼는지 확인 (3초 이내)
          if (isManualNavigation()) {
            const timeSinceManualNav = Date.now() - manualNavigationTime;
            console.log(`${PREFIX} 최근 수동 이동 감지 (${timeSinceManualNav}ms 전), ended 이벤트 무시`);
            return;
          }
      
      // 체크 인터벌 일시 중지 (중복 방지)
      if (checkIntervalId) {
        clearInterval(checkIntervalId);
        checkIntervalId = null;
        console.log(`${PREFIX} 체크 인터벌 일시 중지 (ended 이벤트)`);
      }

      // 딜레이 후 이동
      scheduleNavigation('ended 이벤트');
    } catch (error) {
      console.error(`${PREFIX} ended 이벤트 처리 오류:`, error);
    }
  }

  // 체크 인터벌 시작
  function startCheckInterval(video) {
    try {
      if (checkIntervalId) {
        clearInterval(checkIntervalId);
      }

      console.log(`${PREFIX} 체크 인터벌 시작 (비디오: ${video ? '있음' : '없음'})`);

      checkIntervalId = setInterval(() => {
        try {
          if (!isEnabled || !currentVideo || currentVideo !== video) {
            console.log(`${PREFIX} 체크 인터벌: 조건 불만족 (enabled: ${isEnabled}, currentVideo: ${!!currentVideo}, video match: ${currentVideo === video})`);
            cleanupVideo();
            return;
          }

          // 수동 이동 중이면 체크 인터벌도 중지 (중요!)
          if (isManualNavigation()) {
            console.log(`${PREFIX} 수동 이동 중이므로 체크 인터벌 중지`);
            cleanupVideo();
            return;
          }

          // 비디오가 DOM에서 제거되었는지 확인
          if (!document.contains(video)) {
            console.log(`${PREFIX} 비디오가 DOM에서 제거됨`);
            cleanupVideo();
            findAndBindVideo();
            return;
          }

          const currentTime = video.currentTime || 0;
          const duration = video.duration || 0;

          // duration이 유효한지 확인
          if (!isFinite(duration) || duration <= 0) {
            // duration이 아직 로드되지 않았을 수 있음 (로그는 너무 많이 출력되므로 주석 처리)
            // console.log(`${PREFIX} 체크 인터벌: duration 유효하지 않음 (${duration})`);
            return;
          }
          
          // 디버깅: 주기적으로 상태 로그 (5초마다)
          if (Math.floor(currentTime) % 5 === 0 && Math.floor(currentTime * 10) % 50 === 0) {
            console.log(`${PREFIX} 체크 인터벌: ${currentTime.toFixed(2)}/${duration.toFixed(2)} (${((currentTime/duration)*100).toFixed(1)}%)`);
          }

          // 루프 감지: currentTime이 갑자기 감소
          if (lastCurrentTime > 0 && currentTime < lastCurrentTime - 1) {
            console.log(`${PREFIX} 루프 감지 (${lastCurrentTime} -> ${currentTime})`);
            
            // 사용자가 최근에 수동으로 넘겼는지 확인 (3초 이내)
            if (isManualNavigation()) {
              const timeSinceManualNav = Date.now() - manualNavigationTime;
              console.log(`${PREFIX} 최근 수동 이동 감지 (${timeSinceManualNav}ms 전), 루프 감지 무시`);
              lastCurrentTime = currentTime;
              return;
            }
            
            // 체크 인터벌 일시 중지 (중복 방지)
            if (checkIntervalId) {
              clearInterval(checkIntervalId);
              checkIntervalId = null;
            }
            // 딜레이 후 이동
            scheduleNavigation('루프 감지');
            return;
          }

          // 이미 ended 상태이거나 이동 중이면 체크하지 않음
          if (video.ended || isNavigating) {
            return;
          }

          // 종료 근처 감지 (더 정확하게)
          if (duration > 0 && currentTime > 0) {
            const timeRemaining = duration - currentTime;
            
            // 종료 근처일 때 로그 (디버깅)
            if (timeRemaining <= 1.0 && timeRemaining > 0) {
              console.log(`${PREFIX} 종료 임박: ${currentTime.toFixed(2)}/${duration.toFixed(2)}, 남은시간: ${timeRemaining.toFixed(2)}`);
            }
            
            if (timeRemaining <= DURATION_EPSILON && timeRemaining >= 0) {
              console.log(`${PREFIX} 종료 근처 감지 (${currentTime.toFixed(2)}/${duration.toFixed(2)}, 남은시간: ${timeRemaining.toFixed(2)})`);
              
              // 사용자가 최근에 수동으로 넘겼는지 확인 (3초 이내)
              if (isManualNavigation()) {
                const timeSinceManualNav = Date.now() - manualNavigationTime;
                console.log(`${PREFIX} 최근 수동 이동 감지 (${timeSinceManualNav}ms 전), 종료 감지 무시`);
                return;
              }
              
              // 체크 인터벌 일시 중지 (중복 방지)
              if (checkIntervalId) {
                clearInterval(checkIntervalId);
                checkIntervalId = null;
                console.log(`${PREFIX} 체크 인터벌 일시 중지 (종료 감지)`);
              }

              // 딜레이 후 이동
              scheduleNavigation('종료 근처 감지');
              return;
            }
          }

          lastCurrentTime = currentTime;
        } catch (error) {
          console.error(`${PREFIX} 체크 인터벌 오류:`, error);
        }
      }, CHECK_INTERVAL);
    } catch (error) {
      console.error(`${PREFIX} 체크 인터벌 시작 오류:`, error);
    }
  }

  // 다음 버튼 클릭 시도 (성공 시 true 반환)
  function clickNextButton() {
    try {
      // YouTube Shorts의 다음 버튼 셀렉터 (정확한 것만 사용 - 광범위한 셀렉터는 오작동 위험)
      const nextSelectors = [
        '#navigation-button-down button',
        'button[aria-label="다음 동영상"]',
        'button[aria-label="Next video"]',
        'button[aria-label*="다음 동영상"]',
        'button[aria-label*="Next video"]'
      ];

      for (const selector of nextSelectors) {
        try {
          const button = document.querySelector(selector);
          if (button && button.offsetParent !== null) {
            button.click(); // 1회만 클릭
            console.log(`${PREFIX} 다음 버튼 클릭: ${selector}`);
            return true;
          }
        } catch (e) {
          // selector 실패는 무시하고 다음 시도
        }
      }
      return false;
    } catch (error) {
      console.error(`${PREFIX} 버튼 클릭 시도 오류:`, error);
      return false;
    }
  }

  // ArrowDown 키 이벤트 1회 전송 (document에만 - 여러 대상에 보내면 중복 이동됨)
  function dispatchArrowDown() {
    try {
      const arrowDownEvent = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        code: 'ArrowDown',
        keyCode: 40,
        which: 40,
        bubbles: true,
        cancelable: true,
        view: window
      });
      document.dispatchEvent(arrowDownEvent);
      console.log(`${PREFIX} ArrowDown 키 이벤트 전송`);
    } catch (error) {
      console.error(`${PREFIX} ArrowDown 전송 오류:`, error);
    }
  }

  // 다음 쇼츠로 이동
  function goToNextShorts() {
    try {
      if (!isEnabled) {
        console.log(`${PREFIX} 비활성화 상태로 이동 취소`);
        return;
      }

      // 중복 실행 방지 (강화)
      if (isNavigating) {
        console.log(`${PREFIX} 이미 이동 중이므로 취소`);
        return;
      }
      
      // 수동 이동 중이면 자동 이동 취소 (가장 중요!)
      if (isManualNavigation()) {
        const timeSinceManualNav = Date.now() - manualNavigationTime;
        console.log(`${PREFIX} 수동 이동 중 (${timeSinceManualNav}ms 전)이므로 자동 이동 취소`);
        return;
      }
      
      isNavigating = true;
      isAutoNavigating = true; // 자동 이동 플래그 설정
      console.log(`${PREFIX} 다음 쇼츠로 이동 시도 (자동)`);
      
      // 기존 타임아웃이 있으면 제거
      if (navigationTimeout) {
        clearTimeout(navigationTimeout);
      }
      
      // 3초 후 플래그 해제 (충분한 시간 확보)
      navigationTimeout = setTimeout(() => {
        isNavigating = false;
        isAutoNavigating = false; // 이동 실패 시에도 플래그가 남지 않도록
        navigationTimeout = null;
        console.log(`${PREFIX} 이동 플래그 해제`);
      }, 3000);

      // 이동 시도 전 URL 기록 (성공 여부 판단용)
      const urlBeforeNav = location.href;

      // 1순위: 다음 버튼 클릭 (정확한 셀렉터만, 1회만 클릭)
      // 실패 시 2순위: ArrowDown 키 이벤트 1회 전송
      const buttonClicked = clickNextButton();
      if (!buttonClicked) {
        dispatchArrowDown();
      }

      // 800ms 후 URL이 그대로면 (이동 실패) 다른 방법으로 1회만 재시도
      setTimeout(() => {
        try {
          if (location.href === urlBeforeNav) {
            console.log(`${PREFIX} 이동 실패 감지, 다른 방법으로 재시도`);
            if (buttonClicked) {
              dispatchArrowDown();
            } else {
              clickNextButton();
            }
          }
        } catch (error) {
          console.error(`${PREFIX} 이동 재시도 오류:`, error);
        }
      }, 800);

      // 정리 및 재바인딩 준비
      setTimeout(() => {
        cleanupVideo();
        setTimeout(() => {
          findAndBindVideo();
        }, 1000);
      }, 500);
    } catch (error) {
      console.error(`${PREFIX} 다음 쇼츠 이동 오류:`, error);
      isNavigating = false;
      if (navigationTimeout) {
        clearTimeout(navigationTimeout);
        navigationTimeout = null;
      }
    }
  }

  // MutationObserver 설정
  function setupVideoObserver() {
    try {
      if (observer) {
        observer.disconnect();
      }

      observer = new MutationObserver((mutations) => {
        try {
          // 비디오가 추가/제거되었거나 변경되었을 때
          const hasVideoChanges = mutations.some(mutation => {
            return Array.from(mutation.addedNodes).some(node => 
              node.nodeName === 'VIDEO' || node.querySelector?.('video')
            ) || Array.from(mutation.removedNodes).some(node => 
              node === currentVideo || node.contains?.(currentVideo)
            );
          });

          if (hasVideoChanges) {
            console.log(`${PREFIX} DOM 변경 감지, 비디오 재검색`);
            setTimeout(() => {
              findAndBindVideo();
            }, 100);
          }
        } catch (error) {
          console.error(`${PREFIX} MutationObserver 콜백 오류:`, error);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      console.log(`${PREFIX} MutationObserver 설정 완료`);
    } catch (error) {
      console.error(`${PREFIX} MutationObserver 설정 오류:`, error);
    }
  }

  // 페이지 언로드 시 정리
  window.addEventListener('beforeunload', () => {
    try {
      cleanupVideo();
      if (observer) {
        observer.disconnect();
      }
    } catch (error) {
      console.error(`${PREFIX} 정리 오류:`, error);
    }
  });

  // 초기화 실행 함수
  function startInit() {
    console.log(`${PREFIX} startInit 호출됨`);
    
    // Shorts 페이지인지 확인 (동적으로 체크)
    if (!isShortsPage()) {
      console.log(`${PREFIX} Shorts 페이지가 아니므로 초기화 스킵`);
      return;
    }
    
    console.log(`${PREFIX} startInit 진행 - readyState: ${document.readyState}`);
    
    if (document.readyState === 'loading') {
      console.log(`${PREFIX} DOMContentLoaded 대기 중`);
      document.addEventListener('DOMContentLoaded', () => {
        console.log(`${PREFIX} DOMContentLoaded 발생`);
        setTimeout(() => {
          console.log(`${PREFIX} DOMContentLoaded 후 init 호출`);
          init();
        }, 300);
      });
    } else {
      console.log(`${PREFIX} 즉시 초기화 시작 (readyState: ${document.readyState})`);
      // 약간의 지연을 두고 초기화 (YouTube가 완전히 로드될 때까지)
      setTimeout(() => {
        console.log(`${PREFIX} 지연 후 init 호출`);
        init();
      }, 500);
    }
  }
  
  // 즉시 실행
  try {
    console.log(`${PREFIX} 스크립트 즉시 실행 시작`);
    startInit();
  } catch (error) {
    console.error(`${PREFIX} startInit 오류:`, error);
  }
  
  // YouTube가 동적으로 로드되는 경우를 대비해 추가 대기
  if (document.readyState === 'complete') {
    setTimeout(() => {
      console.log(`${PREFIX} 지연 초기화 체크`);
      if (!currentVideo) {
        console.log(`${PREFIX} 지연 초기화 재시도`);
        findAndBindVideo();
      }
    }, 1500);
  }

  // window load 이벤트도 대기
  window.addEventListener('load', () => {
    console.log(`${PREFIX} window.load 이벤트 발생`);
    setTimeout(() => {
      if (!currentVideo) {
        console.log(`${PREFIX} window.load 후 비디오 재검색`);
        findAndBindVideo();
      }
    }, 1000);
  });

  // SPA 네비게이션 대응 (YouTube는 history.pushState 사용)
  let lastUrl = location.href;
  let lastClickTime = 0; // 마지막 클릭 시간
  let lastUrlChangeTime = 0; // 마지막 URL 변경 시간
  let isAutoNavigating = false; // 우리 코드가 자동으로 이동 중인지
  
  // URL 변경 감지 함수
  function handleUrlChange(newUrl, source) {
    if (newUrl === lastUrl) return;
    
    const timeSinceClick = Date.now() - lastClickTime;
    const timeSinceLastUrlChange = Date.now() - lastUrlChangeTime;
    lastUrlChangeTime = Date.now();
    
    // 우리가 자동으로 이동한 경우가 아니고, 클릭 후 2초 이내에 URL이 변경되면 수동 이동으로 간주
    if (!isAutoNavigating && (timeSinceClick < 2000 && lastClickTime > 0)) {
      console.log(`${PREFIX} URL 변경 감지 (${source}, 클릭 후 ${timeSinceClick}ms, 수동 이동): ${newUrl}`);
      markManualNavigation();
    } else if (isAutoNavigating) {
      console.log(`${PREFIX} URL 변경 감지 (${source}, 자동 이동): ${newUrl}`);
      // 자동 이동 후에는 플래그 해제
      setTimeout(() => {
        isAutoNavigating = false;
      }, 1000);
    } else {
      console.log(`${PREFIX} URL 변경 감지 (${source}): ${newUrl}`);
      // 예상치 못한 URL 변경도 수동 이동으로 간주 (안전하게)
      if (timeSinceLastUrlChange > 100) { // 너무 빠른 연속 변경이 아닌 경우
        markManualNavigation();
      }
    }
    
    lastUrl = newUrl;
    
    setTimeout(() => {
      cleanupVideo();
      // Shorts 페이지인지 확인 후 재바인딩
      if (isShortsPage()) {
        findAndBindVideo();
      }
    }, 500);
  }
  
  const urlChangeObserver = new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      handleUrlChange(url, 'MutationObserver');
      // URL 변경 시 Shorts 페이지로 전환되었으면 초기화 재실행
      if (isShortsPage()) {
        if (!currentVideo) {
          console.log(`${PREFIX} Shorts 페이지로 전환됨, 초기화 재실행`);
          setTimeout(() => {
            startInit();
          }, 500);
        }
      } else {
        // Shorts 페이지가 아니면 정리
        cleanupVideo();
      }
    }
  });
  
  urlChangeObserver.observe(document, { subtree: true, childList: true });

  // history API 감지
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function() {
    originalPushState.apply(history, arguments);
    const url = location.href;
    if (url !== lastUrl) {
      handleUrlChange(url, 'pushState');
    }
  };
  
  history.replaceState = function() {
    originalReplaceState.apply(history, arguments);
    const url = location.href;
    if (url !== lastUrl) {
      handleUrlChange(url, 'replaceState');
    }
  };

})();
