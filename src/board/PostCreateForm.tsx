import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../api/auth'
import { createPost } from '../api/posts'
import type { CreatePostInput, PostDetail, PostType, TeamSide, TierKey } from '../api/posts'
import { extractYoutubeId } from './time'
import TierCheckboxes from './TierCheckboxes'

const TITLE_MAX = 100
const TIP_BODY_MAX = 2000
const FEEDBACK_NOTE_MAX = 500
const POLL_OPTION_MAX = 40
const POLL_MAX_OPTIONS = 5

const TYPE_OPTIONS: { key: PostType; emoji: string; label: string }[] = [
  { key: 'tip', emoji: '💡', label: '팁' },
  { key: 'feedback', emoji: '🎬', label: '피드백' },
  { key: 'poll', emoji: '🗳', label: '투표' },
]

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: '로그인이 필요합니다.',
  EMPTY_TITLE: '제목을 입력해 주세요.',
  TITLE_TOO_LONG: `제목은 ${TITLE_MAX}자 이내로 작성해 주세요.`,
  EMPTY_BODY: '내용을 입력해 주세요.',
  BODY_TOO_LONG: '내용이 너무 길어요.',
  EMPTY_REPLAY_CODE: '리플레이 코드를 입력해 주세요.',
  EMPTY_HERO: '영웅을 입력해 주세요.',
  INVALID_YOUTUBE_URL: '올바른 YouTube 링크를 입력해 주세요.',
  INVALID_OPTION_COUNT: '선택지는 2~5개까지 입력할 수 있습니다.',
  OPTION_TOO_LONG: `선택지는 ${POLL_OPTION_MAX}자 이내로 작성해 주세요.`,
}

interface PostCreateFormProps {
  onCreated: (post: PostDetail) => void
  onCancel: () => void
}

export default function PostCreateForm({ onCreated, onCancel }: PostCreateFormProps) {
  const [type, setType] = useState<PostType>('tip')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [replayCode, setReplayCode] = useState('')
  const [hero, setHero] = useState('')
  const [teamSide, setTeamSide] = useState<TeamSide>('attack')
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [allowedTiers, setAllowedTiers] = useState<TierKey[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bodyMax = type === 'tip' ? TIP_BODY_MAX : FEEDBACK_NOTE_MAX

  function updateOption(index: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === index ? value.slice(0, POLL_OPTION_MAX) : o)))
  }
  function addOption() {
    setOptions((prev) => (prev.length >= POLL_MAX_OPTIONS ? prev : [...prev, '']))
  }
  function removeOption(index: number) {
    setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError('제목을 입력해 주세요.')
      return
    }
    if (trimmedTitle.length > TITLE_MAX) {
      setError(`제목은 ${TITLE_MAX}자 이내로 작성해 주세요.`)
      return
    }

    let input: CreatePostInput
    if (type === 'tip') {
      const trimmedBody = body.trim()
      if (!trimmedBody) {
        setError('내용을 입력해 주세요.')
        return
      }
      input = { type: 'tip', title: trimmedTitle, body: trimmedBody }
    } else if (type === 'feedback') {
      const trimmedBody = body.trim()
      const trimmedReplayCode = replayCode.trim()
      const trimmedHero = hero.trim()
      const trimmedUrl = youtubeUrl.trim()
      if (!trimmedReplayCode) {
        setError('리플레이 코드를 입력해 주세요.')
        return
      }
      if (!trimmedHero) {
        setError('영웅을 입력해 주세요.')
        return
      }
      if (!extractYoutubeId(trimmedUrl)) {
        setError('올바른 YouTube 링크를 입력해 주세요.')
        return
      }
      if (!trimmedBody) {
        setError('요청 노트를 입력해 주세요.')
        return
      }
      input = {
        type: 'feedback',
        title: trimmedTitle,
        body: trimmedBody,
        replayCode: trimmedReplayCode,
        hero: trimmedHero,
        teamSide,
        youtubeUrl: trimmedUrl,
        allowedTiers,
      }
    } else {
      const trimmedOptions = options.map((o) => o.trim()).filter(Boolean)
      if (trimmedOptions.length < 2) {
        setError('선택지를 2개 이상 입력해 주세요.')
        return
      }
      input = { type: 'poll', title: trimmedTitle, options: trimmedOptions, allowedTiers }
    }

    setSubmitting(true)
    try {
      const post = await createPost(input)
      onCreated(post)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? ERROR_MESSAGES[err.code] ?? '게시글 작성에 실패했습니다. 다시 시도해 주세요.'
          : '게시글 작성에 실패했습니다. 다시 시도해 주세요.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="post-create">
      <button type="button" className="post-detail__back" onClick={onCancel}>
        ← 목록으로
      </button>

      <h1 className="post-create__title">새 글쓰기</h1>

      <div className="post-create__type-select">
        {TYPE_OPTIONS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`chip${type === t.key ? ' chip--active' : ''}`}
            onClick={() => setType(t.key)}
          >
            {t.emoji} {t.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="post-create__form">
        <div className="field">
          <span className="field__label">제목</span>
          <input
            className="field__input"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
            placeholder="제목을 입력하세요"
          />
        </div>

        {type === 'tip' && (
          <div className="field">
            <span className="field__label">내용</span>
            <textarea
              className="post-create__textarea"
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, bodyMax))}
              placeholder="공유하고 싶은 팁을 자유롭게 작성해 보세요."
              rows={8}
            />
            <span className="field__hint">
              {body.length}/{bodyMax}
            </span>
          </div>
        )}

        {type === 'feedback' && (
          <>
            <div className="post-create__row">
              <div className="field">
                <span className="field__label">리플레이 코드</span>
                <input
                  className="field__input"
                  value={replayCode}
                  onChange={(e) => setReplayCode(e.target.value)}
                  placeholder="예: X8YZ4B"
                />
              </div>
              <div className="field">
                <span className="field__label">영웅</span>
                <input
                  className="field__input"
                  value={hero}
                  onChange={(e) => setHero(e.target.value)}
                  placeholder="예: 아나"
                />
              </div>
              <div className="field">
                <span className="field__label">팀 사이드</span>
                <select
                  className="field__input field__select"
                  value={teamSide}
                  onChange={(e) => setTeamSide(e.target.value as TeamSide)}
                >
                  <option value="attack">공격</option>
                  <option value="defense">방어</option>
                </select>
              </div>
            </div>

            <div className="field">
              <span className="field__label">YouTube 링크</span>
              <input
                className="field__input"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
              />
            </div>

            <div className="field">
              <span className="field__label">요청 노트</span>
              <textarea
                className="post-create__textarea"
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, bodyMax))}
                placeholder="어떤 피드백을 받고 싶은지 알려주세요."
                rows={5}
              />
              <span className="field__hint">
                {body.length}/{bodyMax}
              </span>
            </div>

            <div className="field">
              <span className="field__label">참여 가능 티어</span>
              <TierCheckboxes value={allowedTiers} onChange={setAllowedTiers} />
            </div>
          </>
        )}

        {type === 'poll' && (
          <>
            <div className="field">
              <span className="field__label">선택지 (2~5개)</span>
              <div className="post-create__options">
                {options.map((option, index) => (
                  <div key={index} className="post-create__option-row">
                    <input
                      className="field__input"
                      value={option}
                      onChange={(e) => updateOption(index, e.target.value)}
                      placeholder={`선택지 ${index + 1}`}
                    />
                    {options.length > 2 && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--small"
                        onClick={() => removeOption(index)}
                      >
                        삭제
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {options.length < POLL_MAX_OPTIONS && (
                <button type="button" className="btn btn--ghost btn--small" onClick={addOption}>
                  + 선택지 추가
                </button>
              )}
            </div>

            <div className="field">
              <span className="field__label">참여 가능 티어</span>
              <TierCheckboxes value={allowedTiers} onChange={setAllowedTiers} />
            </div>
          </>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="post-create__footer">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            취소
          </button>
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? '등록 중...' : '게시하기'}
          </button>
        </div>
      </form>
    </div>
  )
}
