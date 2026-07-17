import { useCallback, useEffect, useState } from 'react'
import { fetchPost, fetchPosts } from '../api/posts'
import type { PostDetail as PostDetailData, PostSummary, PostType } from '../api/posts'
import BoardList from './BoardList'
import PostCreateForm from './PostCreateForm'
import PostDetail from './PostDetail'
import './Board.css'

type Filter = PostType | 'all'
type View =
  | { name: 'list' }
  | { name: 'detail'; postId: string }
  | { name: 'create' }
  | { name: 'edit'; postId: string }

// Views are mirrored into the URL hash so the browser back/forward buttons
// work and post links survive refresh/sharing:
//   #/            → list
//   #/new         → create form
//   #/post/:id    → post detail
//   #/post/:id/edit → edit form
function parseHash(hash: string): View {
  const path = hash.replace(/^#/, '')
  if (path === '/new') return { name: 'create' }
  const edit = path.match(/^\/post\/([^/]+)\/edit$/)
  if (edit) return { name: 'edit', postId: decodeURIComponent(edit[1]) }
  const detail = path.match(/^\/post\/([^/]+)$/)
  if (detail) return { name: 'detail', postId: decodeURIComponent(detail[1]) }
  return { name: 'list' }
}

function viewToHash(view: View): string {
  switch (view.name) {
    case 'create':
      return '#/new'
    case 'detail':
      return `#/post/${encodeURIComponent(view.postId)}`
    case 'edit':
      return `#/post/${encodeURIComponent(view.postId)}/edit`
    default:
      return '#/'
  }
}

/** `replace` swaps the current history entry instead of pushing a new one —
 * used after submits/deletes so "back" doesn't resurrect a stale form. */
function navigate(view: View, options: { replace?: boolean } = {}) {
  const hash = viewToHash(view)
  if (options.replace) {
    window.location.replace(`${window.location.pathname}${window.location.search}${hash}`)
  } else {
    window.location.hash = hash
  }
}

/** Loads the post being edited by id, so the edit URL survives refresh/back. */
function PostEditor({ postId }: { postId: string }) {
  const [post, setPost] = useState<PostDetailData | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setPost(null)
    setError(false)
    fetchPost(postId)
      .then((data) => {
        if (!cancelled) setPost(data)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [postId])

  if (error) {
    return (
      <div className="post-detail post-detail--status post-detail--error">
        게시글을 불러오지 못했습니다.
      </div>
    )
  }
  if (!post) {
    return <div className="post-detail post-detail--status">게시글을 불러오는 중...</div>
  }
  return (
    <PostCreateForm
      editingPost={post}
      onCreated={(updated) => navigate({ name: 'detail', postId: updated.id }, { replace: true })}
      onCancel={() => navigate({ name: 'detail', postId }, { replace: true })}
    />
  )
}

export default function Board() {
  const [view, setView] = useState<View>(() => parseHash(window.location.hash))
  const [filter, setFilter] = useState<Filter>('all')
  const [posts, setPosts] = useState<PostSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onHashChange = () => setView(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const loadPosts = useCallback((activeFilter: Filter) => {
    setLoading(true)
    setError(null)
    fetchPosts(activeFilter === 'all' ? undefined : activeFilter)
      .then(setPosts)
      .catch(() => setError('게시글을 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (view.name === 'list') loadPosts(filter)
  }, [view.name, filter, loadPosts])

  if (view.name === 'detail') {
    return (
      <PostDetail
        postId={view.postId}
        onBack={() => navigate({ name: 'list' })}
        onEdit={(post) => navigate({ name: 'edit', postId: post.id })}
        onDeleted={() => navigate({ name: 'list' }, { replace: true })}
      />
    )
  }

  if (view.name === 'create') {
    return (
      <PostCreateForm
        onCreated={(post) => navigate({ name: 'detail', postId: post.id }, { replace: true })}
        onCancel={() => navigate({ name: 'list' }, { replace: true })}
      />
    )
  }

  if (view.name === 'edit') {
    return <PostEditor postId={view.postId} />
  }

  return (
    <BoardList
      posts={posts}
      loading={loading}
      error={error}
      filter={filter}
      onFilterChange={setFilter}
      onSelect={(postId) => navigate({ name: 'detail', postId })}
      onCreate={() => navigate({ name: 'create' })}
    />
  )
}
