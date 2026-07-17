import { useCallback, useEffect, useState } from 'react'
import { fetchPosts } from '../api/posts'
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
  | { name: 'edit'; post: PostDetailData }

export default function Board() {
  const [view, setView] = useState<View>({ name: 'list' })
  const [filter, setFilter] = useState<Filter>('all')
  const [posts, setPosts] = useState<PostSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
        onBack={() => setView({ name: 'list' })}
        onEdit={(post) => setView({ name: 'edit', post })}
        onDeleted={() => setView({ name: 'list' })}
      />
    )
  }

  if (view.name === 'create') {
    return (
      <PostCreateForm
        onCreated={(post) => setView({ name: 'detail', postId: post.id })}
        onCancel={() => setView({ name: 'list' })}
      />
    )
  }

  if (view.name === 'edit') {
    return (
      <PostCreateForm
        editingPost={view.post}
        onCreated={(post) => setView({ name: 'detail', postId: post.id })}
        onCancel={() => setView({ name: 'detail', postId: view.post.id })}
      />
    )
  }

  return (
    <BoardList
      posts={posts}
      loading={loading}
      error={error}
      filter={filter}
      onFilterChange={setFilter}
      onSelect={(postId) => setView({ name: 'detail', postId })}
      onCreate={() => setView({ name: 'create' })}
    />
  )
}
