import { TIER_LABEL_KO } from '../api/posts'
import type { TierKey } from '../api/posts'
import { TIER_IMAGES } from '../assets/tierImages'

interface TierIconProps {
  tier: TierKey
  className?: string
}

export default function TierIcon({ tier, className }: TierIconProps) {
  return (
    <img
      src={TIER_IMAGES[tier]}
      alt={TIER_LABEL_KO[tier]}
      className={className}
      draggable={false}
    />
  )
}
