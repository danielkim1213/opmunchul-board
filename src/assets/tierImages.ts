import type { TierKey } from '../api/posts'
import bronzeImg from './tier_images/9 Bronze.png'
import silverImg from './tier_images/8 Silver.png'
import goldImg from './tier_images/7 Gold.png'
import platinumImg from './tier_images/6 Platinum.png'
import diamondImg from './tier_images/5 Diamond.png'
import masterImg from './tier_images/4 Masters.png'
import grandmasterImg from './tier_images/3 Grandmaster.png'
import ultimateImg from './tier_images/2 Champion.png'

export const TIER_IMAGES: Record<TierKey, string> = {
  bronze: bronzeImg,
  silver: silverImg,
  gold: goldImg,
  platinum: platinumImg,
  diamond: diamondImg,
  master: masterImg,
  grandmaster: grandmasterImg,
  ultimate: ultimateImg,
}
