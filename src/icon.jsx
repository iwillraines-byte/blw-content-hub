// v5 icon system. One thin wrapper over lucide-react so the app never
// hand-draws SVG paths or falls back to emoji glyphs. Icons are imported
// explicitly (NOT `import *`) so the bundle only ships what we reference.
//
// Usage:  <Icon name="schedule" size={18} />
// Color inherits from the parent via currentColor (lucide default).
import {
  LayoutDashboard, Sparkles, BookOpen, Inbox, BarChart3, CalendarDays,
  FolderOpen, Tag, Brain, Settings, Search, Tv, Trophy, Users, User,
  ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  AtSign, ExternalLink, Check, X, Plus, Minus, Camera,
  Sun, Moon, Monitor, Circle, Star, Filter, Image as ImageIcon, Menu,
} from 'lucide-react';

// Semantic name -> component. Names are app-domain ("schedule"), not the
// lucide name, so call sites stay readable and icon choices can change in
// one place.
const MAP = {
  dashboard: LayoutDashboard,
  studio: Sparkles,
  resources: BookOpen,
  requests: Inbox,
  stats: BarChart3,
  schedule: CalendarDays,
  files: FolderOpen,
  'rapid-tag': Tag,
  'train-ai': Brain,
  settings: Settings,
  search: Search,
  broadcast: Tv,
  trophy: Trophy,
  team: Users,
  player: User,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'chevron-up': ChevronUp,
  instagram: AtSign,
  external: ExternalLink,
  check: Check,
  x: X,
  plus: Plus,
  minus: Minus,
  camera: Camera,
  sun: Sun,
  moon: Moon,
  system: Monitor,
  star: Star,
  filter: Filter,
  image: ImageIcon,
  menu: Menu,
};

export function Icon({ name, size = 18, strokeWidth = 1.75, style, ...rest }) {
  const Cmp = MAP[name] || Circle;
  return <Cmp size={size} strokeWidth={strokeWidth} style={{ flexShrink: 0, ...style }} {...rest} />;
}

export default Icon;
