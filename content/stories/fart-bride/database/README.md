# 방귀쟁이 며느리 — 인터랙티브 동화 데이터베이스

`story_database.json` 하나로 영상 제작과 플레이(질문/답변) 구현에 필요한 모든 데이터를 관리합니다.
`source/script.md`(대사본)와 실제 `image/`, `sound/` 파일을 대조하여 생성했습니다.

## 전체 구조

```
story_database.json
├─ meta        스토리 정보, 에셋 루트 경로, STT 기본 설정
├─ characters  화자 목록 + 성우(TTS 보이스) 매핑
│              내레이션=Despina, 며느리=Leda, 시아버지=Schedar, 이장님=Sadachbia, 아이=STT 입력(보이스 없음)
├─ scenes      씬 18개 (재생 순서대로)
├─ assets      실제 파일 인덱스 (자동 생성 — 오디오 길이, 이미지 크기 포함)
└─ issues      데이터 정리 중 발견된 문제 목록
```

## 씬 구성 (18개)

| 씬 | 챕터 | 타입 | 내용 |
|---|---|---|---|
| 1 | 도입부 | linear | 도입 |
| 2 | 전개1 | linear | 방귀 참는 며느리 (화면전환 있음) |
| 3 | 대화1 | linear | 며느리의 걱정 |
| **4** | 대화1 | **interactive** | 며느리 질문 → STT → 답변 |
| 5 | 전개2 | linear | 며느리의 고백 |
| 6 | 전개2 | linear | 방귀 폭발 |
| **7** | 대화2 | **interactive** | 시아버지 질문 → STT → 답변 |
| 8 | 대화2 | linear | 친정 가는 길 |
| 9 | 전개3 | linear | 높은 배나무 |
| **10** | 대화3 | **interactive** | 이장님 질문 → STT → **미니게임** → 답변 |
| 11 | 대화3 | linear | 며느리의 깨달음 |
| 12 | 대화3 | linear | 사람들을 설득 |
| 13 | 대화3 | linear | 방귀 나갑니다! |
| 14 | 대화3 | linear | 배 잔치 |
| 15 | 전개4 | linear | 시아버지의 사과 |
| **16** | 대화4 | **interactive** | 며느리 질문(2줄) → STT → 답변 |
| 17 | 대화4 | linear | 편안해진 며느리 |
| 18 | 대화4 | linear | 마을 사람들과 함께 |

총 사용 오디오 69개, 이미지 22장(전부 1672×941), 내레이션 총 길이 약 8분 6초 (STT 대기·미니게임 제외).

## 씬 스키마

### linear 씬 (일반 영상 씬)

이미지 1장을 배경으로 `lines` 배열의 음성을 순서대로 재생합니다.

```json
{
  "id": 1,
  "chapter": "도입부",
  "title": "도입",
  "type": "linear",
  "screenTransition": false,     // true면 씬 진입 시 화면전환 연출 (씬 2)
  "image": "1_도입.png",          // assets.images의 키
  "lines": [
    {
      "order": 1,
      "speaker": "narrator",      // characters의 id
      "text": "옛날 어느 마을에...",  // 자막용 텍스트
      "audio": "1_도입_Take1.wav"   // assets.audio의 키
    }
  ]
}
```

### interactive 씬 (플레이 방식)

`phases` 배열을 순서대로 실행합니다: `question` → `stt` → (`minigame`) → `answer`

```json
{
  "id": 4,
  "type": "interactive",
  "interactSpeaker": "bride",     // 아이와 대화하는 캐릭터
  "phases": [
    { "phase": "question", "image": "...", "lines": [ ... ] },  // 질문 이미지 + 음성
    { "phase": "stt" },                                          // 아이의 음성 답변 대기 (meta.sttDefaults 적용)
    { "phase": "answer", "image": "...", "lines": [ ... ] }      // 답변 이미지 + 음성
  ]
}
```

- **STT 단계**: `meta.sttDefaults` 설정 사용 — 최대 10초 청취, 무응답 시 5초 후 재시도 1회, 그래도 없으면 그냥 진행(`proceedOnSilence`), 녹음 저장.
- **이름 치환**: 대사에 `"namePlaceholder": "ㅇㅇ"`가 있는 줄은 텍스트의 "ㅇㅇ"을 아이 이름으로 바꿔야 함 (씬 4, 16). 음성 파일도 이름 부분 재녹음 또는 TTS 치환 필요.
- **미니게임**: 씬 10에만 있음. 대사본에 "미니게임"으로만 표기되어 `gameId: null` 상태 — 내용 확정 후 채울 것.

## assets (자동 생성)

씬에서는 파일명만 참조하고, 실제 경로·메타데이터는 여기서 조회합니다.

```json
"assets": {
  "images": {
    "1_도입.png": {
      "path": "source/image/1_도입.png",
      "width": 1672, "height": 941,
      "needsReplacement": false,   // 파일명에 "(이미지 교체 필요)" 포함 여부
      "usedByScene": 1
    }
  },
  "audio": {
    "1_도입_Take1.wav": {
      "path": "source/sound/1_도입_Take1.wav",
      "durationSec": 7.0,          // 영상 타임라인 계산용
      "usedByScene": 1
    }
  }
}
```

파일을 추가·교체한 뒤에는 이 폴더의 `build_assets.ps1`을 다시 실행하면 assets 섹션이 갱신되고 씬 참조가 전부 유효한지 검증됩니다.

## 발견된 문제 (issues 섹션에도 기록됨)

1. `7-2_대화2_답변_Take1.wav.wav` — 확장자 중복. DB는 실제 파일명으로 참조 중이므로 파일명을 고치면 DB도 함께 수정.
2. 씬 4 답변 이미지 파일명이 `4-2_대화1_질문(...)`으로 "질문"이라 되어 있으나 실제로는 답변 단계 이미지.
3. 대사본의 씬 5 오디오 표기(`5_전개1_TakeN`)가 실제 파일(`5_전개2_TakeN`)과 다름 — DB는 실제 파일 기준.
4. 대사본의 씬 2 대사 3개가 모두 Take1로 표기 — 실제 파일 Take1~3을 순서대로 매핑.
5. "(이미지 교체 필요)" 이미지 8장: 4-1, 4-2, 5, 7-1, 7-2, 14, 17, 18.
6. 16-1/16-2 이미지(하이픈)와 오디오(언더스코어) 네이밍 불일치.
7. 자막 텍스트에서 오탈자 교정: '함게'→'함께'(씬 7), '훨신'→'훨씬'(씬 6) — 음성과 대조 확인 필요.
