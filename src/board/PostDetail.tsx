import { useEffect, useState } from 'react'
import { ApiError } from '../api/auth'
import { fetchPost } from '../api/posts'
import type { PostDetail as PostDetailData } from '../api/posts'
import FeedbackPostDetail from './FeedbackPostDetail'
import PollPostDetail from './PollPostDetail'
import TipPostDetail from './TipPostDetail'

interface PostDetailProps {
  postId: string
  onBack: () => void
  onEdit: (post: PostDetailData) => void
  onDeleted: () => void
}

export default function PostDetail({ postId, onBack, onEdit, onDeleted }: PostDetailProps) {
  const [post, setPost] = useState<PostDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchPost(postId)
      .then((data) => {
        if (!cancelled) setPost(data)
      })
      .catch((err) => {
        if (cancelled) return
        setError(
          err instanceof ApiError && err.httpStatus === 404
            ? '삭제되었거나 존재하지 않는 게시글입니다.'
            : '게시글을 불러오지 못했습니다.',
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [postId])

  if (loading) {
    return <div className="post-detail post-detail--status">게시글을 불러오는 중...</div>
  }
  if (error || !post) {
    return (
      <div className="post-detail post-detail--status post-detail--error">
        {error ?? '게시글을 찾을 수 없습니다.'}
      </div>
    )
  }

  if (post.type === 'tip') {
    return <TipPostDetail post={post} onBack={onBack} onEdit={() => onEdit(post)} onDeleted={onDeleted} />
  }
  if (post.type === 'feedback') {
    return (
      <FeedbackPostDetail post={post} onBack={onBack} onEdit={() => onEdit(post)} onDeleted={onDeleted} />
    )
  }
  return <PollPostDetail post={post} onBack={onBack} onEdit={() => onEdit(post)} onDeleted={onDeleted} />
}
