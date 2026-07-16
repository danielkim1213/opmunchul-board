import type { VodInfo } from '../api/vod'
import RankBadge from '../components/RankBadge'

const TEAM_SIDE_LABEL: Record<VodInfo['teamSide'], string> = {
  attack: '공격',
  defense: '방어',
}

export default function VodMeta({ vod }: { vod: VodInfo }) {
  return (
    <div className="vod-meta">
      <div className="vod-meta__grid">
        <div className="vod-meta__field">
          <span className="vod-meta__label">리플레이 코드</span>
          <code className="vod-meta__code">{vod.replayCode}</code>
        </div>
        <div className="vod-meta__field">
          <span className="vod-meta__label">역할 / 영웅</span>
          <span className="vod-meta__value">
            {vod.hero} <span className="vod-meta__side">({TEAM_SIDE_LABEL[vod.teamSide]} 팀)</span>
          </span>
        </div>
        <div className="vod-meta__field vod-meta__field--submitter">
          <span className="vod-meta__label">제출자</span>
          <span className="vod-meta__value vod-meta__submitter">
            {vod.submitter.battletag}
            <RankBadge
              rankLabel={vod.submitter.rankLabel}
              rankIcon={vod.submitter.rankIcon}
              roleLabel={vod.submitter.roleLabel}
              mostHeroes={vod.submitter.mostHeroes}
            />
          </span>
        </div>
      </div>
      <div className="vod-meta__note">
        <span className="vod-meta__label">제출자 노트</span>
        <p>{vod.note}</p>
      </div>
    </div>
  )
}
