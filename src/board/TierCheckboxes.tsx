import { TIER_LABEL_KO, TIER_ORDER } from '../api/posts'
import type { TierKey } from '../api/posts'
import TierIcon from '../components/TierIcon'

interface TierCheckboxesProps {
  value: TierKey[]
  onChange: (tiers: TierKey[]) => void
}

/**
 * Arbitrary multi-select of the 9 rank tiers gating participation on a
 * feedback/poll post. An empty selection means "unrestricted" (anyone may
 * participate) — this is called out in the helper text below the grid.
 */
export default function TierCheckboxes({ value, onChange }: TierCheckboxesProps) {
  function toggle(tier: TierKey) {
    onChange(value.includes(tier) ? value.filter((t) => t !== tier) : [...value, tier])
  }

  return (
    <div className="tier-checkboxes">
      <div className="tier-checkboxes__grid">
        {TIER_ORDER.map((tier) => (
          <label key={tier} className="tier-checkbox">
            <input type="checkbox" checked={value.includes(tier)} onChange={() => toggle(tier)} />
            <TierIcon tier={tier} className="tier-checkbox__img" />
            <span className="tier-checkbox__label">{TIER_LABEL_KO[tier]}</span>
          </label>
        ))}
      </div>
      <p className="tier-checkboxes__hint">
        {value.length === 0
          ? '선택한 티어가 없으면 누구나 참여할 수 있습니다.'
          : `선택된 티어만 댓글/투표에 참여할 수 있습니다 (${value.length}개 선택).`}
      </p>
    </div>
  )
}
