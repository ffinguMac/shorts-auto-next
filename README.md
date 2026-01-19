# Shorts Auto Next

YouTube Shorts에서 자동으로 다음 쇼츠로 넘기는 Chrome 확장프로그램 (Manifest V3)

## 기능

- YouTube Shorts 재생이 끝나면 자동으로 다음 쇼츠로 이동
- `Alt+N` 키로 ON/OFF 토글
- 상태는 브라우저 재시작 후에도 유지

## 설치 방법

1. Chrome 브라우저에서 `chrome://extensions/` 접속
2. 우측 상단의 **개발자 모드** 활성화
3. **압축해제된 확장 프로그램을 로드합니다** 클릭
4. 이 폴더(`shorts-auto-next`) 선택
5. 설치 완료!

## 사용 방법

- 확장프로그램은 기본적으로 **ON** 상태로 시작됩니다
- `Alt+N` 키를 눌러 ON/OFF를 토글할 수 있습니다
- 토글 시 화면 우측 하단에 상태가 표시됩니다

## 파일 구조

```
shorts-auto-next/
├── manifest.json    # 확장프로그램 매니페스트
├── content.js       # 메인 로직 (콘텐츠 스크립트)
└── README.md        # 이 파일
```

## 기술 사양

- **Manifest Version**: 3
- **동작 URL**: `https://www.youtube.com/shorts/*`
- **필수 권한**: `storage` (설정 저장용)
- **호스트 권한**: YouTube Shorts 페이지만
