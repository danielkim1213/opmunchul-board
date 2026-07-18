import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../api/auth'
import { createPost, updatePost } from '../api/posts'
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
  FORBIDDEN: '본인 글만 수정할 수 있습니다.',
  ADMIN_ONLY: '공지글은 관리자만 작성할 수 있습니다.',
  EMPTY_TITLE: '제목을 입력해 주세요.',
  TITLE_TOO_LONG: `제목은 ${TITLE_MAX}자 이내로 작성해 주세요.`,
  EMPTY_BODY: '내용을 입력해 주세요.',
  BODY_TOO_LONG: '내용이 너무 길어요.',
  EMPTY_HERO: '영웅을 입력해 주세요.',
  INVALID_YOUTUBE_URL: '올바른 YouTube 링크를 입력해 주세요.',
  INVALID_OPTION_COUNT: '선택지는 2~5개까지 입력할 수 있습니다.',
  OPTION_TOO_LONG: `선택지는 ${POLL_OPTION_MAX}자 이내로 작성해 주세요.`,
}

interface PostCreateFormProps {
  /** When provided, the form edits this existing post instead of creating a new one. */
  editingPost?: PostDetail
  /** Admins may pin a post as a notice. */
  isAdmin?: boolean
  onCreated: (post: PostDetail) => void
  onCancel: () => void
}

export default function PostCreateForm({
  editingPost,
  isAdmin = false,
  onCreated,
  onCancel,
}: PostCreateFormProps) {
  const isEditing = Boolean(editingPost)
  const [selectableType, setSelectableType] = useState<PostType>(editingPost?.type ?? 'tip')
  const activeType = isEditing ? (editingPost?.type ?? 'tip') : selectableType

  const [title, setTitle] = useState(editingPost?.title ?? '')
  const [body, setBody] = useState(
    editingPost?.type === 'tip' || editingPost?.type === 'feedback' ? editingPost.body : '',
  )
  const [replayCode, setReplayCode] = useState(
    editingPost?.type === 'feedback' ? editingPost.replayCode ?? '' : '',
  )
  const [hero, setHero] = useState(editingPost?.type === 'feedback' ? editingPost.hero : '')
  const [teamSide, setTeamSide] = useState<TeamSide>(
    editingPost?.type === 'feedback' ? editingPost.teamSide : 'red',
  )
  const [youtubeUrl, setYoutubeUrl] = useState(
    editingPost?.type === 'feedback' ? `https://youtu.be/${editingPost.youtubeId}` : '',
  )
  const [options, setOptions] = useState<string[]>(
    editingPost?.type === 'poll' ? editingPost.options.map((o) => o.label) : ['', ''],
  )
  const [allowedTiers, setAllowedTiers] = useState<TierKey[]>(editingPost?.allowedTiers ?? [])
  const [isNotice, setIsNotice] = useState(editingPost?.isNotice ?? false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bodyMax = activeType === 'tip' ? TIP_BODY_MAX : FEEDBACK_NOTE_MAX

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

    const noticeFlag = isAdmin ? isNotice : false

    setSubmitting(true)
    try {
      let post: PostDetail
      if (isEditing && editingPost) {
        if (activeType === 'tip') {
          const trimmedBody = body.trim()
          if (!trimmedBody) {
            setError('내용을 입력해 주세요.')
            setSubmitting(false)
            return
          }
          post = await updatePost(editingPost.id, {
            title: trimmedTitle,
            body: trimmedBody,
            isNotice: noticeFlag,
          })
        } else if (activeType === 'feedback') {
          const trimmedBody = body.trim()
          const trimmedHero = hero.trim()
          const trimmedUrl = youtubeUrl.trim()
          if (!trimmedHero) {
            setError('영웅을 입력해 주세요.')
            setSubmitting(false)
            return
          }
          if (!extractYoutubeId(trimmedUrl)) {
            setError('올바른 YouTube 링크를 입력해 주세요.')
            setSubmitting(false)
            return
          }
          if (!trimmedBody) {
            setError('요청 노트를 입력해 주세요.')
            setSubmitting(false)
            return
          }
          post = await updatePost(editingPost.id, {
            title: trimmedTitle,
            body: trimmedBody,
            replayCode: replayCode.trim() || null,
            hero: trimmedHero,
            teamSide,
            youtubeUrl: trimmedUrl,
            allowedTiers,
            isNotice: noticeFlag,
          })
        } else {
          // poll: options aren't editable, only title/tiers/notice.
          post = await updatePost(editingPost.id, {
            title: trimmedTitle,
            allowedTiers,
            isNotice: noticeFlag,
          })
        }
      } else {
        let input: CreatePostInput
        if (activeType === 'tip') {
          const trimmedBody = body.trim()
          if (!trimmedBody) {
            setError('내용을 입력해 주세요.')
            setSubmitting(false)
            return
          }
          input = { type: 'tip', title: trimmedTitle, body: trimmedBody, isNotice: noticeFlag }
        } else if (activeType === 'feedback') {
          const trimmedBody = body.trim()
          const trimmedReplayCode = replayCode.trim()
          const trimmedHero = hero.trim()
          const trimmedUrl = youtubeUrl.trim()
          if (!trimmedHero) {
            setError('영웅을 입력해 주세요.')
            setSubmitting(false)
            return
          }
          if (!extractYoutubeId(trimmedUrl)) {
            setError('올바른 YouTube 링크를 입력해 주세요.')
            setSubmitting(false)
            return
          }
          if (!trimmedBody) {
            setError('요청 노트를 입력해 주세요.')
            setSubmitting(false)
            return
          }
          input = {
            type: 'feedback',
            title: trimmedTitle,
            body: trimmedBody,
            replayCode: trimmedReplayCode || undefined,
            hero: trimmedHero,
            teamSide,
            youtubeUrl: trimmedUrl,
            allowedTiers,
            isNotice: noticeFlag,
          }
        } else {
          const trimmedOptions = options.map((o) => o.trim()).filter(Boolean)
          if (trimmedOptions.length < 2) {
            setError('선택지를 2개 이상 입력해 주세요.')
            setSubmitting(false)
            return
          }
          input = {
            type: 'poll',
            title: trimmedTitle,
            options: trimmedOptions,
            allowedTiers,
            isNotice: noticeFlag,
          }
        }
        post = await createPost(input)
      }
      onCreated(post)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? ERROR_MESSAGES[err.code] ?? '게시글 저장에 실패했습니다. 다시 시도해 주세요.'
          : '게시글 저장에 실패했습니다. 다시 시도해 주세요.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="post-create">
      <button type="button" className="post-detail__back" onClick={onCancel}>
        ← {isEditing ? '뒤로' : '목록으로'}
      </button>

      <h1 className="post-create__title">{isEditing ? '글 수정' : '새 글쓰기'}</h1>

      {!isEditing && (
        <div className="post-create__type-select">
          {TYPE_OPTIONS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`chip${selectableType === t.key ? ' chip--active' : ''}`}
              onClick={() => setSelectableType(t.key)}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
      )}

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

        {isAdmin && (
          <label className="post-create__notice-toggle">
            <input
              type="checkbox"
              checked={isNotice}
              onChange={(e) => setIsNotice(e.target.checked)}
            />
            <span>
              📌 공지글로 등록
              <span className="field__hint">목록 최상단에 고정되고 제목 배경이 구분됩니다.</span>
            </span>
          </label>
        )}

        {activeType === 'tip' && (
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

        {activeType === 'feedback' && (
          <>
            <div className="post-create__row">
              <div className="field">
                <span className="field__label">리플레이 코드 (선택)</span>
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
                  <option value="red">레드팀</option>
                  <option value="blue">블루팀</option>
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

        {activeType === 'poll' && (
          <>
            <div className="field">
              <span className="field__label">선택지 (2~5개){isEditing && ' — 수정 불가'}</span>
              <div className="post-create__options">
                {options.map((option, index) => (
                  <div key={index} className="post-create__option-row">
                    <input
                      className="field__input"
                      value={option}
                      onChange={(e) => updateOption(index, e.target.value)}
                      placeholder={`선택지 ${index + 1}`}
                      disabled={isEditing}
                    />
                    {!isEditing && options.length > 2 && (
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
              {!isEditing && options.length < POLL_MAX_OPTIONS && (
                <button type="button" className="btn btn--ghost btn--small" onClick={addOption}>
                  + 선택지 추가
                </button>
              )}
              {isEditing && (
                <span className="field__hint">투표가 시작된 뒤라 선택지는 수정할 수 없습니다.</span>
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
            {submitting ? '저장 중...' : isEditing ? '수정하기' : '게시하기'}
          </button>
        </div>
      </form>
    </div>
  )
}
