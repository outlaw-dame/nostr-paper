import {
  House,
  HouseFill,
  Search,
  Bell,
  BellFill,
  PersonCircle,
  PersonCircleFill,
  Bookmark,
  BookmarkFill,
  Heart,
  HeartFill,
  ChatBubble,
  Arrow2Squarepath,
  EllipsisCircle,
  Gear,
  Plus,
  PlusCircle,
  PlusCircleFill,
  Xmark,
  ChevronLeft,
  ChevronRight,
  Square2StackFill,
  Globe,
  Lock,
  LockFill,
  Star,
  StarFill,
  Flag,
  FlagFill,
  Share,
  Link,
  Pencil,
  Trash,
  ArrowCounterclockwise,
  Bolt,
  BoltFill,
  Photo,
  PlayCircle,
  PlayCircleFill,
} from 'framework7-icons/react'
import {
  MdHome,
  MdOutlineHome,
  MdSearch,
  MdNotifications,
  MdOutlineNotifications,
  MdPerson,
  MdOutlinePerson,
  MdBookmark,
  MdOutlineBookmark,
  MdFavorite,
  MdFavoriteBorder,
  MdChatBubbleOutline,
  MdRepeat,
  MdMoreHoriz,
  MdSettings,
  MdAdd,
  MdAddCircle,
  MdAddCircleOutline,
  MdClose,
  MdChevronLeft,
  MdChevronRight,
  MdDynamicFeed,
  MdPublic,
  MdLock,
  MdLockOutline,
  MdStar,
  MdStarBorder,
  MdFlag,
  MdOutlineFlag,
  MdShare,
  MdLink,
  MdEdit,
  MdDelete,
  MdRefresh,
  MdFlashOn,
  MdFlashOff,
  MdImage,
  MdPlayCircleOutline,
  MdPlayCircleFilled,
} from 'react-icons/md'

// ── Semantic Icon Registry ────────────────────────────────────
//
// All icon consumption in the app should go through this registry.
// Do not import icon libraries directly in feature code.
//
// Nav icons have iosActive/iosInactive/materialActive/materialInactive
// Action icons have ios/material (plus optional Active/Inactive variants)

export const appIcons = {
  // Navigation
  navHome: {
    iosInactive: <House className="h-7 w-7" />,
    iosActive: <HouseFill className="h-7 w-7" />,
    materialInactive: <MdOutlineHome className="h-6 w-6" />,
    materialActive: <MdHome className="h-6 w-6" />,
  },
  navSearch: {
    iosInactive: <Search className="h-7 w-7" />,
    iosActive: <Search className="h-7 w-7" />,
    materialInactive: <MdSearch className="h-6 w-6" />,
    materialActive: <MdSearch className="h-6 w-6" />,
  },
  navNotifications: {
    iosInactive: <Bell className="h-7 w-7" />,
    iosActive: <BellFill className="h-7 w-7" />,
    materialInactive: <MdOutlineNotifications className="h-6 w-6" />,
    materialActive: <MdNotifications className="h-6 w-6" />,
  },
  navProfile: {
    iosInactive: <PersonCircle className="h-7 w-7" />,
    iosActive: <PersonCircleFill className="h-7 w-7" />,
    materialInactive: <MdOutlinePerson className="h-6 w-6" />,
    materialActive: <MdPerson className="h-6 w-6" />,
  },

  // Feed actions
  reply: {
    ios: <ChatBubble className="h-[21px] w-[21px]" />,
    material: <MdChatBubbleOutline className="h-[21px] w-[21px]" />,
  },
  boost: {
    ios: <Arrow2Squarepath className="h-[22px] w-[22px]" />,
    material: <MdRepeat className="h-[22px] w-[22px]" />,
  },
  like: {
    iosInactive: <Heart className="h-[22px] w-[22px]" />,
    iosActive: <HeartFill className="h-[22px] w-[22px]" />,
    materialInactive: <MdFavoriteBorder className="h-[22px] w-[22px]" />,
    materialActive: <MdFavorite className="h-[22px] w-[22px]" />,
  },
  bookmark: {
    iosInactive: <Bookmark className="h-[22px] w-[22px]" />,
    iosActive: <BookmarkFill className="h-[22px] w-[22px]" />,
    materialInactive: <MdOutlineBookmark className="h-[22px] w-[22px]" />,
    materialActive: <MdBookmark className="h-[22px] w-[22px]" />,
  },
  zap: {
    iosInactive: <Bolt className="h-[22px] w-[22px]" />,
    iosActive: <BoltFill className="h-[22px] w-[22px]" />,
    materialInactive: <MdFlashOff className="h-[22px] w-[22px]" />,
    materialActive: <MdFlashOn className="h-[22px] w-[22px]" />,
  },

  // Overflow / system
  more: {
    ios: <EllipsisCircle className="h-[22px] w-[22px]" />,
    material: <MdMoreHoriz className="h-[22px] w-[22px]" />,
  },
  settings: {
    ios: <Gear className="h-[22px] w-[22px]" />,
    material: <MdSettings className="h-[22px] w-[22px]" />,
  },

  // Compose / editing
  compose: {
    ios: <Pencil className="h-[22px] w-[22px]" />,
    material: <MdEdit className="h-[22px] w-[22px]" />,
  },
  add: {
    ios: <Plus className="h-[22px] w-[22px]" />,
    material: <MdAdd className="h-[22px] w-[22px]" />,
  },
  addCircle: {
    iosInactive: <PlusCircle className="h-[22px] w-[22px]" />,
    iosActive: <PlusCircleFill className="h-[22px] w-[22px]" />,
    materialInactive: <MdAddCircleOutline className="h-[22px] w-[22px]" />,
    materialActive: <MdAddCircle className="h-[22px] w-[22px]" />,
  },
  close: {
    ios: <Xmark className="h-[22px] w-[22px]" />,
    material: <MdClose className="h-[22px] w-[22px]" />,
  },
  delete: {
    ios: <Trash className="h-[22px] w-[22px]" />,
    material: <MdDelete className="h-[22px] w-[22px]" />,
  },
  refresh: {
    ios: <ArrowCounterclockwise className="h-[22px] w-[22px]" />,
    material: <MdRefresh className="h-[22px] w-[22px]" />,
  },

  // Navigation controls
  chevronLeft: {
    ios: <ChevronLeft className="h-[22px] w-[22px]" />,
    material: <MdChevronLeft className="h-[22px] w-[22px]" />,
  },
  chevronRight: {
    ios: <ChevronRight className="h-[22px] w-[22px]" />,
    material: <MdChevronRight className="h-[22px] w-[22px]" />,
  },

  // Content / media
  photo: {
    ios: <Photo className="h-[22px] w-[22px]" />,
    material: <MdImage className="h-[22px] w-[22px]" />,
  },
  playCircle: {
    iosInactive: <PlayCircle className="h-[22px] w-[22px]" />,
    iosActive: <PlayCircleFill className="h-[22px] w-[22px]" />,
    materialInactive: <MdPlayCircleOutline className="h-[22px] w-[22px]" />,
    materialActive: <MdPlayCircleFilled className="h-[22px] w-[22px]" />,
  },

  // Social / visibility
  globe: {
    ios: <Globe className="h-[22px] w-[22px]" />,
    material: <MdPublic className="h-[22px] w-[22px]" />,
  },
  lock: {
    iosInactive: <Lock className="h-[22px] w-[22px]" />,
    iosActive: <LockFill className="h-[22px] w-[22px]" />,
    materialInactive: <MdLockOutline className="h-[22px] w-[22px]" />,
    materialActive: <MdLock className="h-[22px] w-[22px]" />,
  },
  star: {
    iosInactive: <Star className="h-[22px] w-[22px]" />,
    iosActive: <StarFill className="h-[22px] w-[22px]" />,
    materialInactive: <MdStarBorder className="h-[22px] w-[22px]" />,
    materialActive: <MdStar className="h-[22px] w-[22px]" />,
  },
  flag: {
    iosInactive: <Flag className="h-[22px] w-[22px]" />,
    iosActive: <FlagFill className="h-[22px] w-[22px]" />,
    materialInactive: <MdOutlineFlag className="h-[22px] w-[22px]" />,
    materialActive: <MdFlag className="h-[22px] w-[22px]" />,
  },
  share: {
    ios: <Share className="h-[22px] w-[22px]" />,
    material: <MdShare className="h-[22px] w-[22px]" />,
  },
  link: {
    ios: <Link className="h-[22px] w-[22px]" />,
    material: <MdLink className="h-[22px] w-[22px]" />,
  },
  feed: {
    ios: <Square2StackFill className="h-[22px] w-[22px]" />,
    material: <MdDynamicFeed className="h-[22px] w-[22px]" />,
  },
} as const

export type AppIconKey = keyof typeof appIcons
export type NavIconKey = 'navHome' | 'navSearch' | 'navNotifications' | 'navProfile'
export type FeedActionKey = 'reply' | 'boost' | 'like' | 'bookmark' | 'zap' | 'more'
