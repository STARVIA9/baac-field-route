# BAAC Field Route — Current UI Analysis
**Date:** 2026-08-24
**URL:** https://baacroute.shop
**CSS:** ~59KB, ~2986 lines (`css/app.css?v=20260824d`)
**HTML:** Single-page app (`index.html` ~59KB) + separate `admin.html`

---

## 1. DESIGN SYSTEM OVERVIEW

### Color Palette
| Token | Value | Usage |
|-------|-------|-------|
| `--baac-green` | `#0a8f3c` | Primary brand, CTAs, active states |
| `--baac-green-dark` | `#067029` | Hover states, headings |
| `--baac-green-deeper` | `#044d1c` | Result cards, route numbers |
| `--baac-green-light` | `#2cb357` | Accents |
| `--baac-green-muted` | `#e8f5ec` | Backgrounds, chips, badges |
| `--baac-gold` | `#c9a227` | Secondary accent, update badges |
| `--baac-gold-light` | `#f5e6a3` | Borders |
| `--baac-gold-muted` | `#fdf8e8` | Avatar backgrounds |
| `--bg` | `#f5f7f5` | Page background |
| `--surface` | `#ffffff` | Cards, sheets |
| `--text` | `#111811` | Primary text |
| `--text-secondary` | `#4a554a` | Secondary text |
| `--text-muted` | `#6b776b` | Hints, labels |
| `--border` | `#dde3dd` | Borders |
| `--risk-good` | `#16a34a` | Green risk |
| `--risk-warning` | `#d97706` | Yellow risk |
| `--risk-bad` | `#dc2626` | Red risk |

### Typography
- **Font stack:** `'Noto Sans Thai', 'Sarabun', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`
- **Base size:** 15px, line-height 1.6
- **Scale:** 48px (hero) → 28px (section) → 17-18px (headers) → 14-15px (body) → 12-13px (secondary) → 11px (labels)
- **Monospace:** `'SF Mono', 'Fira Code', monospace` for CIF codes, PIN input

### Spacing (8px grid)
`--sp-1: 4px` through `--sp-12: 48px`

### Border Radius
`--radius-sm: 8px`, `--radius-md: 12px`, `--radius-lg: 16px`, `--radius-xl: 20px`, `--radius-full: 9999px`

### Elevation (5 levels)
`--shadow-xs` through `--shadow-xl` — all using `rgba(0,0,0,...)` with subtle opacity

---

## 2. SCREEN-BY-SCREEN ANALYSIS

### A) Landing Page / Login Screen

**Structure:**
- Hero section (100vh) with badge, title, subtitle, CTA button
- Features section (6 feature cards in single column)
- CTA section at bottom
- Login overlay (slides over hero when "เข้าสู่ระบบ" clicked)

**What works:**
- Clean green-on-white hero with gradient background
- Fade-up scroll animations
- Login card has good shadow and border-radius
- PIN fallback login is well-designed

**Issues:**
- **Feature cards are single-column** — wastes horizontal space on mobile; 2-column grid would be more compact
- **Hero title is 48px** — very large, may feel oversized on 320-360px screens
- **No dark mode support** — hardcoded light colors throughout
- **Login overlay uses `rgba(255,255,255,0.97)`** — not a true modal, feels like a hack
- **Emoji as logo** (🗺️) — not professional for a government banking app
- **No BAAC official branding** — just green color, no logo mark

### B) Main App (Map View)

**Structure:**
- Full-screen Leaflet map as canvas
- Floating header (dark gradient overlay with blur)
- Bottom sheet with 5 tabs
- FAB buttons (add customer, my location)
- Debt filter bar (floating)

**What works:**
- Map-as-canvas is modern (Google Maps style)
- Header has backdrop blur — nice glass effect
- Bottom sheet with drag handle is mobile-native pattern
- FAB buttons are well-positioned

**Issues:**
- **Header is CROWDED** — up to 10+ icon buttons on desktop, still 7+ on mobile
  - Logo, user name, 🔑, 👥, 🔧, ❓, 📊, version label, 🔄, ⬇️, ⎋
  - On mobile (≤480px), buttons shrink to 28px — touch targets below 44px minimum
- **Version label on mobile is 8px font** — unreadable
- **Logo text hidden on mobile** — only emoji icon remains, loses brand identity
- **Debt filter bar overlaps header** on small screens (top: 74px on ≤480px)
- **No search in header** — search is buried in bottom sheet tabs
- **Bottom sheet has 5 tabs** — too many for thumb-reach on mobile
  - 🧭 เส้นทาง, 👥 ลูกค้า, 🗺️ วางแผน, 📋 เข้าพบ, 📊 สรุปหนี้
  - Tabs scroll horizontally on small screens — hidden tabs are discoverability problem

### C) Customer List (Bottom Sheet → 👥 ลูกค้า tab)

**Structure:**
- Header with count badge
- Search input
- Filter pills (ทั้งหมด, วันนี้, รอเยี่ยม, เยี่ยมแล้ว)
- Customer cards with avatar, name, address, CIF, action buttons

**What works:**
- Search is prominent
- Filter pills are clear
- Customer cards have good hierarchy (name > address > CIF)
- Avatar uses initials with gold background

**Issues:**
- **Customer cards are dense** — name, address, CIF, debt info, action buttons all in one row
- **No grouping/sorting options** visible
- **Action buttons are small** (36px) — borderline for touch
- **No swipe actions** — all interactions require tapping small buttons
- **Debt info display** uses inline badges that can overflow on narrow screens

### D) Route Planning (Bottom Sheet → 🗺️ วางแผน tab)

**Structure:**
- Search box for adding customers
- Selected customers as chips
- Route options (start point, end point, vehicle, road classification)
- Calculate / Optimize buttons
- Result card with stats

**What works:**
- Step-by-step flow is clear
- Chips for selected customers
- Result card has nice dark green background with white text
- TSP optimization is a strong feature

**Issues:**
- **Too many form fields visible at once** — start, end, vehicle, road classification all shown
- **No progressive disclosure** — everything is visible even before selecting customers
- **"เลือกแล้ว (0/10)" counter** — the /10 limit feels arbitrary and restrictive
- **Result card stats** (distance, duration, stops) are in 3-column grid — small on mobile

### E) Visit Log (Bottom Sheet → 📋 เข้าพบ tab)

**Structure:**
- Stats row (รอเยี่ยม, เยี่ยมแล้ว, ข้าม/ไม่อยู่)
- Visit list with customer cards

**What works:**
- Stats are clear with color coding
- Simple, focused interface

**Issues:**
- **Stats use 3-column grid** — numbers may be small on narrow screens
- **No quick-actions** for common visit outcomes

### F) Debt Summary (Bottom Sheet → 📊 สรุปหนี้ tab)

**Structure:**
- Overview cards (3-column grid)
- Debt blocks (by color, tier, month, geo status, 15-month)

**What works:**
- Comprehensive data display
- Color-coded risk levels
- Bar charts for visual representation

**Issues:**
- **Very data-heavy** — overwhelming for mobile
- **No charts/graphs** — just text and colored bars
- **3-column overview cards** are cramped on mobile

### G) Admin Panel (⚙️ จัดการระบบ)

**Structure:**
- Add user form
- Import customers from database
- Add branch
- Change PIN / Password
- Update debt status (CSV upload)

**What works:**
- All admin functions in one place
- CSV upload for bulk updates

**Issues:**
- **No role-based UI** — admin buttons visible but hidden via `display:none` + JS
- **No confirmation dialogs** for destructive actions (except delete customer)
- **No audit log** visible
- **Admin panel is in the same page** — no separate route

---

## 3. RESPONSIVE DESIGN ANALYSIS

### Breakpoints
- `≤330px`: Hide version label, shrink user name
- `≤480px`: Mobile optimizations (smaller buttons, hidden logo text)
- `768px+`: Desktop layout (bottom sheet becomes floating card, modals centered)

### Mobile Issues (≤480px)
1. **Header touch targets too small** — 28px buttons (Apple recommends 44px minimum)
2. **Bottom sheet tabs** — 5 tabs need horizontal scroll on ≤360px screens
3. **Debt filter bar** — positioned at top:74px, can overlap with map controls
4. **FAB position** — `bottom: 180px` is hardcoded, doesn't adapt to sheet position
5. **Modal forms** — slide up from bottom, good pattern, but max-height 92dvh leaves little room
6. **No safe-area handling** for notch devices (only `env(safe-area-inset-top)` on header)

### Landscape Issues
- Bottom sheet height reduced to 62dvh (≤520px) or 55dvh (≤400px)
- No specific landscape layout optimizations

---

## 4. WHAT LOOKS DATED / UNPROFESSIONAL

### Critical Issues
1. **Emoji overload** — 🗺️🛣️📍📊🚗🔄 used as feature icons, button labels, tab labels
   - Looks childish for a government banking app
   - Renders differently across devices
   - Not accessible (screen readers struggle)

2. **No proper icon system** — should use SVG icons or a library like Lucide/Heroicons

3. **Header is a button farm** — 10+ icons with no grouping or overflow menu
   - Professional apps use hamburger menus or action sheets for secondary actions

4. **Bottom sheet tabs are text-heavy** — "🧭 เส้นทาง" takes space; icons alone would suffice

5. **No consistent visual hierarchy** — everything is roughly the same size/weight

6. **Form labels are plain** — no floating labels, no visual feedback beyond border color change

7. **No loading states** — just text "กำลังโหลด..." with no skeleton screens or spinners

8. **No empty states with illustrations** — just text messages

9. **Color palette is too muted** — the green (#0a8f3c) is institutional but the surrounding grays make it feel flat

10. **No micro-interactions** — only basic hover/active states, no meaningful transitions

### Minor Issues
- Mixed use of CSS variables and hardcoded values (e.g., `#f0f0f0`, `#999`, `#666`)
- Some Thai text uses informal tone (e.g., "จิ้มแผนที่" — "poke the map")
- Version label shows "…" while loading — should have a skeleton
- `customers-db.json` is 1.8MB — loaded on every page visit
- No PWA install prompt visible despite having manifest.json

---

## 5. COMPARISON TO MODERN MOBILE APPS

### What Modern Apps (Grab, LINE, Banking Apps) Have That This Doesn't:
1. **Bottom navigation bar** — not sheet tabs, but a proper nav bar with 3-5 items
2. **Pull-to-refresh** on lists
3. **Skeleton loading** screens
4. **Haptic feedback** on actions
5. **Swipe gestures** on list items
6. **Dark mode** support
7. **Proper typography scale** with clear hierarchy
8. **Consistent spacing** using a design token system
9. **Illustrated empty states**
10. **Toast notifications** instead of alert() or inline text

---

## 6. RECOMMENDATIONS FOR REDESIGN

### Quick Wins (1-2 days)
1. Replace emoji with SVG icons (Lucide or Heroicons)
2. Consolidate header into logo + 3 buttons + hamburger menu
3. Reduce bottom sheet tabs to 3 (Route, Customers, More)
4. Increase touch targets to 44px minimum
5. Add skeleton loading states
6. Fix hardcoded colors to use CSS variables consistently

### Medium Effort (1 week)
1. Implement proper bottom navigation bar
2. Add illustrated empty states
3. Improve form UX with floating labels
4. Add pull-to-refresh on lists
5. Implement toast notification system
6. Add dark mode support

### Major Redesign (2-4 weeks)
1. Complete visual overhaul with professional design system
2. Replace Leaflet with Mapbox GL for better performance
3. Implement proper state management
4. Add offline-first architecture with service worker
5. Create component library for consistency
6. Add accessibility (ARIA labels, focus management, screen reader support)

---

## 7. TECHNICAL DEBT

- **Single HTML file** (59KB) — should be componentized
- **No build system** — raw HTML/CSS/JS served directly
- **No CSS preprocessor** — 3000 lines of vanilla CSS
- **No JavaScript framework** — vanilla JS with global functions
- **Large JSON files** served directly (customers-db.json: 1.8MB, debt-data.json: 3.7MB)
- **No code splitting** — everything loaded upfront
- **Leaflet 1.9.4** — current but could use Mapbox GL for better mobile performance
- **No TypeScript** — no type safety
- **No tests** — no unit or integration tests visible

---

*Analysis based on CSS source (2986 lines), HTML structure, and live site inspection.*
