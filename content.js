(function() {
  'use strict';

  const PREFIX = '[ShortsAutoNext]';
  const CHECK_INTERVAL = 300; // ms
  const DURATION_EPSILON = 0.5; // seconds
  const TOAST_DURATION = 1000; // ms

  // 즉시 실행되는 로그 (스크립트가 로드되었는지 확인용)
  console.log(`${PREFIX} ========== 스크립트 로드됨 ==========`);
  console.log(`${PREFIX} URL: ${window.location.href}`);
  console.log(`${PREFIX} User Agent: ${navigator.userAgent.substring(0, 50)}...`);
  
  // Shorts 페이지인지 확인
  const isShortsPage = window.location.pathname.includes('/shorts/');
  console.log(`${PREFIX} Shorts 페이지 여부: ${isShortsPage}`);
  
  if (!isShortsPage) {
    console.log(`${PREFIX} Shorts 페이지가 아니므로 종료`);
    // Shorts 페이지가 아니면 실행하지 않음
  }

  let isEnabled = true;
  let currentVideo = null;
  let checkIntervalId = null;
  let lastCurrentTime = 0;
  let observer = null;
  let toastContainer = null;
  let isNavigating = false; // 이동 중 플래그
  let navigationTimeout = null; // 이동 타임아웃

  // 초기화
  async function init() {
    try {
      console.log(`${PREFIX} 초기화 시작`);
      
      // 저장된 설정 불러오기
      const result = await chrome.storage.local.get(['enabled']);
      isEnabled = result.enabled !== undefined ? result.enabled : true;
      console.log(`${PREFIX} 설정 로드: ${isEnabled ? 'ON' : 'OFF'}`);

      // 토스트 컨테이너 생성
      createToastContainer();

      // 키보드 단축키 리스너 등록
      setupKeyboardShortcut();

      // 비디오 감지 시작
      setupVideoObserver();

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
        // Alt+N
        if (e.altKey && e.key === 'n') {
          e.preventDefault();
          toggleEnabled();
        }
      });
      console.log(`${PREFIX} 키보드 단축키 등록: Alt+N`);
    } catch (error) {
      console.error(`${PREFIX} 키보드 단축키 설정 오류:`, error);
    }
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
        currentVideo.removeEventListener('ended', handleVideoEnded);
        currentVideo = null;
      }
      
      if (checkIntervalId) {
        clearInterval(checkIntervalId);
        checkIntervalId = null;
      }
      
      lastCurrentTime = 0;
      
      // 이동 플래그는 유지 (새 비디오가 로드될 때까지)
    } catch (error) {
      console.error(`${PREFIX} 비디오 정리 오류:`, error);
    }
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
      
      // 체크 인터벌 일시 중지 (중복 방지)
      if (checkIntervalId) {
        clearInterval(checkIntervalId);
        checkIntervalId = null;
        console.log(`${PREFIX} 체크 인터벌 일시 중지 (ended 이벤트)`);
      }
      
      goToNextShorts();
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

      checkIntervalId = setInterval(() => {
        try {
          if (!isEnabled || !currentVideo || currentVideo !== video) {
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
            return;
          }

          // 루프 감지: currentTime이 갑자기 감소
          if (lastCurrentTime > 0 && currentTime < lastCurrentTime - 1) {
            console.log(`${PREFIX} 루프 감지 (${lastCurrentTime} -> ${currentTime})`);
            goToNextShorts();
            return;
          }

          // 이미 ended 상태이거나 이동 중이면 체크하지 않음
          if (video.ended || isNavigating) {
            return;
          }

          // 종료 근처 감지 (더 정확하게)
          if (duration > 0 && currentTime > 0) {
            const timeRemaining = duration - currentTime;
            if (timeRemaining <= DURATION_EPSILON && timeRemaining >= 0) {
              console.log(`${PREFIX} 종료 근처 감지 (${currentTime.toFixed(2)}/${duration.toFixed(2)}, 남은시간: ${timeRemaining.toFixed(2)})`);
              
              // 체크 인터벌 일시 중지 (중복 방지)
              if (checkIntervalId) {
                clearInterval(checkIntervalId);
                checkIntervalId = null;
                console.log(`${PREFIX} 체크 인터벌 일시 중지 (종료 감지)`);
              }
              
              goToNextShorts();
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
      
      isNavigating = true;
      console.log(`${PREFIX} 다음 쇼츠로 이동 시도`);
      
      // 기존 타임아웃이 있으면 제거
      if (navigationTimeout) {
        clearTimeout(navigationTimeout);
      }
      
      // 3초 후 플래그 해제 (충분한 시간 확보)
      navigationTimeout = setTimeout(() => {
        isNavigating = false;
        navigationTimeout = null;
        console.log(`${PREFIX} 이동 플래그 해제`);
      }, 3000);

      // 1순위: ArrowDown 키 이벤트 (여러 방법 시도)
      const activeElement = document.activeElement;
      const body = document.body;
      
      // window에 직접 전달
      const arrowDownEvent1 = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        code: 'ArrowDown',
        keyCode: 40,
        which: 40,
        bubbles: true,
        cancelable: true,
        view: window
      });
      window.dispatchEvent(arrowDownEvent1);
      console.log(`${PREFIX} ArrowDown 키 이벤트 전송 (window)`);

      // document에 전달
      const arrowDownEvent2 = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        code: 'ArrowDown',
        keyCode: 40,
        which: 40,
        bubbles: true,
        cancelable: true
      });
      document.dispatchEvent(arrowDownEvent2);
      console.log(`${PREFIX} ArrowDown 키 이벤트 전송 (document)`);

      // body에 전달
      if (body) {
        const arrowDownEvent3 = new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          code: 'ArrowDown',
          keyCode: 40,
          which: 40,
          bubbles: true,
          cancelable: true
        });
        body.dispatchEvent(arrowDownEvent3);
        console.log(`${PREFIX} ArrowDown 키 이벤트 전송 (body)`);
      }

      // 활성 요소에 포커스가 있으면 그곳에도 전달
      if (activeElement && activeElement !== body && activeElement !== document.documentElement) {
        try {
          const arrowDownEvent4 = new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            code: 'ArrowDown',
            keyCode: 40,
            which: 40,
            bubbles: true,
            cancelable: true
          });
          activeElement.dispatchEvent(arrowDownEvent4);
          console.log(`${PREFIX} ArrowDown 키 이벤트 전송 (activeElement)`);
        } catch (e) {
          console.log(`${PREFIX} activeElement 이벤트 전송 실패:`, e.message);
        }
      }

      // 2순위: 다음 버튼 찾아서 클릭 (약간의 지연 후)
      setTimeout(() => {
        try {
          // YouTube Shorts의 다음 버튼 선택자들 (여러 가능성 시도)
          const nextSelectors = [
            'button[aria-label*="다음"]',
            'button[aria-label*="Next"]',
            'button[aria-label*="다음 동영상"]',
            'button[aria-label*="Next video"]',
            '[data-testid="shorts-player-next-button"]',
            'ytd-shorts[role="button"][aria-label*="다음"]',
            'ytd-shorts[role="button"][aria-label*="Next"]',
            'ytd-reel-player-overlay-renderer button[aria-label*="다음"]',
            'ytd-reel-player-overlay-renderer button[aria-label*="Next"]',
            '#navigation-button-down',
            '[id*="next"]',
            '[class*="next"]'
          ];

          let clicked = false;
          for (const selector of nextSelectors) {
            try {
              const button = document.querySelector(selector);
              if (button && button.offsetParent !== null) {
                // 실제 클릭 이벤트 생성
                const clickEvent = new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  view: window
                });
                button.dispatchEvent(clickEvent);
                button.click(); // 추가로 직접 클릭도 시도
                console.log(`${PREFIX} 다음 버튼 클릭 성공: ${selector}`);
                clicked = true;
                break;
              }
            } catch (e) {
              // selector 실패는 무시하고 다음 시도
            }
          }

          if (!clicked) {
            console.log(`${PREFIX} 다음 버튼을 찾을 수 없음 (ArrowDown만 시도됨)`);
          }
        } catch (error) {
          console.error(`${PREFIX} 버튼 클릭 시도 오류:`, error);
        }
      }, 150);

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

  // Shorts 페이지에서만 실행
  if (isShortsPage) {
    // 초기화 실행
    function startInit() {
      console.log(`${PREFIX} startInit 호출됨 - readyState: ${document.readyState}`);
      
      if (document.readyState === 'loading') {
        console.log(`${PREFIX} DOMContentLoaded 대기 중`);
        document.addEventListener('DOMContentLoaded', () => {
          console.log(`${PREFIX} DOMContentLoaded 발생`);
          setTimeout(init, 300);
        });
      } else {
        console.log(`${PREFIX} 즉시 초기화 시작`);
        // 약간의 지연을 두고 초기화 (YouTube가 완전히 로드될 때까지)
        setTimeout(init, 500);
      }
    }
    
    // 즉시 실행
    try {
      startInit();
    } catch (error) {
      console.error(`${PREFIX} startInit 오류:`, error);
    }
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
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      console.log(`${PREFIX} URL 변경 감지: ${url}`);
      setTimeout(() => {
        cleanupVideo();
        findAndBindVideo();
      }, 500);
    }
  }).observe(document, { subtree: true, childList: true });

  // history API 감지
  const originalPushState = history.pushState;
  history.pushState = function() {
    originalPushState.apply(history, arguments);
    setTimeout(() => {
      console.log(`${PREFIX} history.pushState 감지`);
      cleanupVideo();
      findAndBindVideo();
    }, 500);
  };

})();
