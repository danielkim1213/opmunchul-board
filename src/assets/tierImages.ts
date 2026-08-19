import type { TierKey } from '../api/posts'
import bronzeImg from './tier_images/Bronze.png'
import silverImg from './tier_images/Silver.png'
import goldImg from './tier_images/Gold.png'
import platinumImg from './tier_images/Platinum.png'
import emeraldImg from './tier_images/Emerald.png'
import diamondImg from './tier_images/Diamond.png'
import masterImg from './tier_images/Master.png'
import grandmasterImg from './tier_images/Grandmaster.png'
import championImg from './tier_images/Champion.png'

export const TIER_IMAGES: Record<TierKey, string> = {
  bronze: bronzeImg,
  silver: silverImg,
  gold: goldImg,
  platinum: platinumImg,
  emerald: emeraldImg,
  diamond: diamondImg,
  master: masterImg,
  grandmaster: grandmasterImg,
  champion: championImg,
}
