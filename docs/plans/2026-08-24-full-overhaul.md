# BAAC Field Route — Full Website Overhaul Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Overhaul the entire baacroute.shop website — from login page to all features — with improved UX, mobile-first design, performance, and reliability.

**Architecture:** Static PWA on Cloudflare Pages + Workers (D1 database). Single `index.html` with modular JS files. No framework — vanilla JS + Leaflet + Lucide icons.

**Tech Stack:** HTML5, CSS3 (Material 3 tokens), vanilla JS, Leaflet 1.9.4, Leaflet.markercluster, Lucide icons, Cloudflare Pages + Workers + D1.

---

## Phase 1: Login Page Overhaul (Priority: HIGH)

### Task 1.1: Redesign Login Landing Page
**Objective:** Modern, professional landing page that loads fast and looks trustworthy

**Files:**
- Modify: `public/index.html` (lines 19-119 — login screen)
- Modify: `public/css/app.css` (lines 296-492 — landing page styles)

**Changes:**
1. Add BAAC logo SVG (not just emoji 🗺️)
2. Add subtle background animation (floating particles or gradient shift)
3. Improve typography hierarchy — bigger title, clearer subtitle
4. Add trust indicators: "สำหรับพนักงาน ธ.ก.ส." badge, version number
5. Make CTA button more prominent with icon
6. Add smooth scroll-to-login animation

**Verify:** Visual inspection on mobile (390px) + desktop (1440px)

### Task 1.2: Redesign Login Form
**Objective:** Clean, fast login with clear feedback

**Files:**
- Modify: `public/index.html` (lines 89-117 — login overlay)
- Modify: `public/css/app.css` (lines 437-492 — login overlay styles)
- Modify: `public/js/app.js` (lines 310-356 — login event handlers)

**Changes:**
1. Add loading spinner during login (not just text change)
2. Add "จดจำฉัน" checkbox (localStorage remember)
3. Auto-focus PIN input when switching to PIN mode
4. Add `inputmode="numeric"` to PIN input (already done ✓)
5. Show/hide password toggle (eye icon)
6. Better error messages with icons
7. Add "ลืมรหัสผ่าน?" link (admin contact info)
8. Smooth transition from landing to login form

**Verify:** Login flow works on mobile + desktop, loading state visible

### Task 1.3: Auto-Login & Session Management
**Objective:** Returning users skip login page entirely

**Files:**
- Modify: `public/js/auth.js` (lines 15-27 — token check)
- Modify: `public/js/app.js` (lines 23-41 — init flow)

**Changes:**
1. Check token validity on page load (already done ✓)
2. Add token refresh mechanism (auto-renew before expiry)
3. Add session timeout warning (toast before auto-logout)
4. Store last login method (PIN vs username) for quick re-login

**Verify:** Login → close browser → reopen → auto-logged-in

---

## Phase 2: Main App UI Overhaul (Priority: HIGH)

### Task 2.1: Header Redesign
**Objective:** Cleaner, more functional header with better mobile layout

**Files:**
- Modify: `public/index.html` (lines 122-144 — app header)
- Modify: `public/css/app.css` (lines 708-860 — header styles)

**Changes:**
1. Consolidate header buttons into a dropdown menu on mobile
2. Show user avatar/initials instead of just name
3. Add notification badge for sync status
4. Improve version label visibility
5. Add quick-access buttons (report, help) as icons

**Verify:** Header looks clean on 390px mobile + 1440px desktop

### Task 2.2: Bottom Sheet Improvements
**Objective:** Smoother, more intuitive bottom sheet interaction

**Files:**
- Modify: `public/css/app.css` (lines 924-1053 — bottom sheet styles)
- Modify: `public/js/app.js` (lines 490-601 — bottom sheet logic)

**Changes:**
1. Add haptic feedback on sheet state changes (vibration API)
2. Improve drag sensitivity and snap points
3. Add sheet state indicator (peek/half/full icons)
4. Better tab icons and labels
5. Add swipe-to-dismiss on full sheet

**Verify:** Bottom sheet drags smoothly on mobile, tabs switch correctly

### Task 2.3: Map Controls Improvement
**Objective:** Better map interaction and visual hierarchy

**Files:**
- Modify: `public/js/customers.js` (lines 16-80 — map init)
- Modify: `public/css/app.css` (map-related styles)

**Changes:**
1. Add zoom controls to bottom-right (standard map position)
2. Add "my location" button with pulse animation when tracking
3. Improve layer toggle UI (roadmap/satellite)
4. Add compass indicator for heading
5. Better cluster marker design (rounded, shadow, count)

**Verify:** Map controls work on mobile, layer toggle switches correctly

---

## Phase 3: Feature Improvements (Priority: MEDIUM)

### Task 3.1: Customer List Enhancement
**Objective:** Faster search, better card design, swipe actions

**Files:**
- Modify: `public/index.html` (lines 207-227 — customer list)
- Modify: `public/css/app.css` (customer list styles)
- Modify: `public/js/customers.js` (renderList method)

**Changes:**
1. Add virtual scrolling for large lists (3,852+ customers)
2. Add swipe-to-add-to-route gesture
3. Improve customer card design (photo, CIF, risk badge)
4. Add sort options (name, CIF, risk level, distance)
5. Add filter chips (risk level, debt type, has GPS)

**Verify:** Customer list scrolls smoothly with 3,852 items

### Task 3.2: Route Planning Enhancement
**Objective:** Smoother route planning workflow

**Files:**
- Modify: `public/index.html` (lines 229-319 — route planning)
- Modify: `public/js/route.js` (full file)
- Modify: `public/js/app.js` (calculateRoute method)

**Changes:**
1. Add drag-and-drop reordering (already done ✓)
2. Add route preview on map before calculating
3. Show estimated time and fuel cost in real-time
4. Add "save as template" for recurring routes
5. Add route history (past routes)

**Verify:** Route planning flow works end-to-end

### Task 3.3: Visit Logging Enhancement
**Objective:** Faster visit logging with photo and GPS

**Files:**
- Modify: `public/index.html` (lines 483-524 — visit modal)
- Modify: `public/js/visit.js` (full file)

**Changes:**
1. Add quick-status buttons (visited/not home/etc.)
2. Add photo capture with GPS stamp
3. Add voice note recording (optional)
4. Improve GPS capture feedback (accuracy indicator)
5. Add visit history per customer

**Verify:** Visit logging works on mobile with GPS

### Task 3.4: Report Enhancement
**Objective:** Better reports with charts and export options

**Files:**
- Modify: `public/index.html` (lines 526-583 — report modal)
- Modify: `public/js/report.js` (full file)

**Changes:**
1. Add simple charts (bar chart for daily visits)
2. Improve HTML export (print-friendly CSS)
3. Add PDF export (via browser print)
4. Add date range picker (calendar UI)
5. Add report templates (daily/weekly/monthly)

**Verify:** Report generates correctly, exports work

---

## Phase 4: Performance & Reliability (Priority: HIGH)

### Task 4.1: Loading Performance
**Objective:** First meaningful paint < 2 seconds on 3G

**Files:**
- Modify: `public/index.html` (script loading order)
- Modify: `public/sw.js` (caching strategy)

**Changes:**
1. Defer non-critical JS (report, admin, debt-summary)
2. Add critical CSS inline (above-the-fold styles)
3. Preload key resources (leaflet CSS, app CSS)
4. Optimize image loading (lazy load customer photos)
5. Add skeleton screens for loading states

**Verify:** Lighthouse performance score > 90

### Task 4.2: Offline Support Enhancement
**Objective:** Full offline functionality for field work

**Files:**
- Modify: `public/sw.js` (full file)
- Modify: `public/js/storage.js` (sync logic)

**Changes:**
1. Cache all static assets on first load
2. Queue offline actions (add customer, log visit)
3. Sync queued actions when back online
4. Show offline indicator in header
5. Add offline-first data loading

**Verify:** App works fully offline, syncs when back online

### Task 4.3: Error Handling & Recovery
**Objective:** Graceful error handling, no silent failures

**Files:**
- Modify: `public/js/app.js` (global error handler)
- Modify: `public/js/api.js` (error handling)
- Modify: `public/js/storage.js` (sync error handling)

**Changes:**
1. Add retry mechanism for failed API calls
2. Show user-friendly error messages (not technical errors)
3. Add error reporting (optional, to admin)
4. Add data recovery (backup/restore from localStorage)
5. Add conflict resolution for sync conflicts

**Verify:** Error scenarios handled gracefully

---

## Phase 5: Admin & Data Management (Priority: MEDIUM)

### Task 5.1: Admin Dashboard Enhancement
**Objective:** Better admin tools for data management

**Files:**
- Modify: `public/index.html` (lines 726-908 — admin modal)
- Modify: `public/js/app.js` (admin methods)

**Changes:**
1. Add user activity log (who logged in, when)
2. Add bulk customer import (CSV upload)
3. Add data export (all customers as CSV)
4. Add system health check (D1 status, sync status)
5. Add branch management improvements

**Verify:** Admin functions work correctly

### Task 5.2: Debt Summary Enhancement
**Objective:** Better debt visualization and filtering

**Files:**
- Modify: `public/index.html` (lines 346-378 — debt summary)
- Modify: `public/js/debt-summary.js` (full file)
- Modify: `public/js/debt-db.js` (full file)

**Changes:**
1. Add interactive charts (pie chart for risk levels)
2. Add drill-down (click tier → see customers)
3. Add export debt report (CSV)
4. Add debt trend (compare month-over-month)
5. Add 15-month forecast visualization

**Verify:** Debt summary displays correctly, filters work

---

## Phase 6: Mobile-First Polish (Priority: HIGH)

### Task 6.1: Touch Optimization
**Objective:** Perfect touch experience on mobile

**Files:**
- Modify: `public/css/app.css` (touch-related styles)

**Changes:**
1. Ensure all touch targets ≥ 44px
2. Add touch feedback (ripple effect on buttons)
3. Improve scroll performance (momentum scrolling)
4. Add pull-to-refresh gesture
5. Optimize for one-handed use (bottom-heavy UI)

**Verify:** All interactions work smoothly on mobile

### Task 6.2: Responsive Design
**Objective:** Perfect layout on all screen sizes

**Files:**
- Modify: `public/css/app.css` (media queries)

**Changes:**
1. Test and fix all breakpoints (320px, 375px, 390px, 768px, 1024px, 1440px)
2. Fix landscape mode issues
3. Add safe area insets for notched phones
4. Optimize for tablets (split view)
5. Fix keyboard avoidance on mobile

**Verify:** Layout works on all screen sizes

### Task 6.3: PWA Enhancement
**Objective:** Installable, app-like experience

**Files:**
- Modify: `public/manifest.json`
- Modify: `public/sw.js`

**Changes:**
1. Add proper app icons (192px, 512px)
2. Add splash screen
3. Add app shortcuts (quick actions)
4. Add push notifications (for sync updates)
5. Add background sync

**Verify:** PWA installs correctly on mobile

---

## Implementation Order

1. **Phase 1** (Login) — Start here, highest user impact
2. **Phase 4** (Performance) — Critical for field use
3. **Phase 6** (Mobile Polish) — Essential for mobile-first app
4. **Phase 2** (Main UI) — Improve daily workflow
5. **Phase 3** (Features) — Add value
6. **Phase 5** (Admin) — Power user features

---

## Success Criteria

- [ ] Login page loads in < 1 second
- [ ] First meaningful paint < 2 seconds on 3G
- [ ] All interactions work smoothly on mobile (390px)
- [ ] Offline mode works fully
- [ ] No JavaScript errors in console
- [ ] Lighthouse performance score > 90
- [ ] PWA installs correctly
- [ ] All existing features still work

---

## Notes

- **No framework changes** — keep vanilla JS for simplicity and performance
- **Backward compatible** — all existing data must still work
- **Incremental deployment** — deploy after each phase
- **Test on real devices** — not just browser DevTools
- **User feedback** — ask พ่อ to test after each phase
