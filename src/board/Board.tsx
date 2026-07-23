import { useCallback, useEffect, useState } from 'react'
import { fetchPost, fetchPosts } from '../api/posts'
import type { PostDetail as PostDetailData, PostSummary, PostType } from '../api/posts'
import BoardList from './BoardList'
import PostCreateForm from './PostCreateForm'
import PostDetail from './PostDetail'
import './Board.css'

interface BoardProps {
  isAdmin: boolean
}

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
function PostEditor({ postId, isAdmin }: { postId: string; isAdmin: boolean }) {
  const [post, setPost] = useState<PostDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setPost(null)
    setError(null)
    fetchPost(postId)
      .then((data) => {
        if (cancelled) return
        // Editing stays author-only — admins may delete others' posts but not edit them.
        if (!data.isMine) {
          setError('본인 글만 수정할 수 있습니다.')
          return
        }
        setPost(data)
      })
      .catch(() => {
        if (!cancelled) setError('게시글을 불러오지 못했습니다.')
      })
    return () => {
      cancelled = true
    }
  }, [postId])

  if (error) {
    return (
      <div className="post-detail post-detail--status post-detail--error">
        {error}
      </div>
    )
  }
  if (!post) {
    return <div className="post-detail post-detail--status">게시글을 불러오는 중...</div>
  }
  return (
    <PostCreateForm
      editingPost={post}
      isAdmin={isAdmin}
      onCreated={(updated) => navigate({ name: 'detail', postId: updated.id }, { replace: true })}
      onCancel={() => navigate({ name: 'detail', postId }, { replace: true })}
    />
  )
}

export default function Board({ isAdmin }: BoardProps) {
  const [view, setView] = useState<View>(() => parseHash(window.location.hash))
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(1)
  const [posts, setPosts] = useState<PostSummary[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onHashChange = () => setView(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const loadPosts = useCallback((activeFilter: Filter, activePage: number) => {
    setLoading(true)
    setError(null)
    fetchPosts({
      type: activeFilter === 'all' ? undefined : activeFilter,
      page: activePage,
    })
      .then((result) => {
        setPosts(result.posts)
        setTotal(result.total)
        setTotalPages(result.totalPages)
        // Server may clamp page when past the last page (e.g. after deletes).
        if (result.page !== activePage) setPage(result.page)
      })
      .catch(() => setError('게시글을 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (view.name === 'list') loadPosts(filter, page)
  }, [view.name, filter, page, loadPosts])

  function handleFilterChange(next: Filter) {
    setFilter(next)
    setPage(1)
  }

  function handlePageChange(next: number) {
    setPage(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

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
        isAdmin={isAdmin}
        onCreated={(post) => navigate({ name: 'detail', postId: post.id }, { replace: true })}
        onCancel={() => navigate({ name: 'list' }, { replace: true })}
      />
    )
  }

  if (view.name === 'edit') {
    return <PostEditor postId={view.postId} isAdmin={isAdmin} />
  }

  return (
    <BoardList
      posts={posts}
      loading={loading}
      error={error}
      filter={filter}
      page={page}
      totalPages={totalPages}
      total={total}
      onFilterChange={handleFilterChange}
      onPageChange={handlePageChange}
      onSelect={(postId) => navigate({ name: 'detail', postId })}
      onCreate={() => navigate({ name: 'create' })}
    />
  )
}
