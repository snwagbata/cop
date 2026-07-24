-- DESIGN.md §7: "photo_url is never auto-approved, even from a tier1
-- source -- a reviewer must positively confirm the photo matches the
-- officer being published." Migration 0005 added officers.photo_url as a
-- plain column with no gate at all, so any photo set at officer-creation
-- time was immediately shown everywhere, public included. This migration
-- adds the missing confirmation gate.
--
-- photo_confirmed defaults false so a freshly-set photo_url is never
-- publicly visible until a reviewer acts on it (see apps/api-public's
-- officers routes, which gate their photo_url SELECTs on this column).
-- photo_confirmed_by/at record who/when for the same audit-trail reasons
-- reviewer_id/reviewed_at exist on review_queue.
--
-- There is currently no officer-edit endpoint (only POST /api/internal/
-- officers at creation) -- photo_url can only be set at creation today, and
-- the two new confirm/reject-photo routes are the only things that ever
-- flip photo_confirmed afterward. So there's no "reset photo_confirmed when
-- photo_url changes" trigger here; if an edit endpoint is ever added, it
-- must reset photo_confirmed (and the by/at columns) to false/NULL whenever
-- photo_url changes, to preserve the never-auto-approved guarantee.
ALTER TABLE officers ADD COLUMN photo_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE officers ADD COLUMN photo_confirmed_by uuid REFERENCES reviewers (id);
ALTER TABLE officers ADD COLUMN photo_confirmed_at timestamptz;
