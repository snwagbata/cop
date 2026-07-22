-- DESIGN.md §2, §3, §4: department_stats
-- A derived materialized view, not a source-of-truth table: there is no
-- write path to a scorecard number that isn't already backed by
-- individually-cited rows underneath it, which is what keeps department
-- scorecards out of the "self-published rating" risk category (§3) that
-- applies to individual officers. Refresh nightly (§8) via
-- REFRESH MATERIALIZED VIEW CONCURRENTLY department_stats;
--
-- wandering_officer_hire_count is a simplified first-pass definition: the
-- count of officers currently or previously in this department who have
-- history rows in more than one department overall. Revisit if a more
-- precise "hired away from department X specifically" breakdown is needed.
--
-- Each metric is pre-aggregated in its own subquery before joining to
-- departments. Joining incidents->outcomes and departments->officer_
-- department_history directly in one query fans out multi-row-per-department
-- relationships against each other and silently multiplies SUM()s (verified
-- against seed data: a single $150k settlement was double-counted to $300k
-- because Springfield has two officer_department_history rows) — COUNT(DISTINCT ..)
-- masks the same bug for the incident counts, but SUM() has no such guard.
CREATE MATERIALIZED VIEW department_stats AS
SELECT
    d.id AS department_id,
    COALESCE(settlement_agg.total_settlement_amount_cents, 0) AS total_settlement_amount_cents,
    COALESCE(incident_agg.sustained_complaint_count, 0) AS sustained_complaint_count,
    COALESCE(incident_agg.total_incident_count, 0) AS total_incident_count,
    COALESCE(wandering_agg.wandering_officer_hire_count, 0) AS wandering_officer_hire_count,
    now() AS last_computed_at
FROM departments d
LEFT JOIN (
    SELECT i.department_id,
           SUM(o.amount_cents) FILTER (WHERE o.outcome_type = 'lawsuit_settlement') AS total_settlement_amount_cents
    FROM incidents i
    JOIN outcomes o ON o.incident_id = i.id
    GROUP BY i.department_id
) settlement_agg ON settlement_agg.department_id = d.id
LEFT JOIN (
    SELECT department_id,
           COUNT(*) FILTER (WHERE status = 'sustained') AS sustained_complaint_count,
           COUNT(*) AS total_incident_count
    FROM incidents
    GROUP BY department_id
) incident_agg ON incident_agg.department_id = d.id
LEFT JOIN (
    SELECT department_id, COUNT(DISTINCT officer_id) AS wandering_officer_hire_count
    FROM officer_department_history
    WHERE officer_id IN (
        SELECT officer_id
        FROM officer_department_history
        GROUP BY officer_id
        HAVING COUNT(DISTINCT department_id) > 1
    )
    GROUP BY department_id
) wandering_agg ON wandering_agg.department_id = d.id;

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX department_stats_department_idx ON department_stats (department_id);
