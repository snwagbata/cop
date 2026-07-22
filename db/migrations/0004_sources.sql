-- DESIGN.md §4: sources
-- reliability_tier gates auto-approval eligibility in the review queue (§7):
-- only tier1/tier2 sources are ever eligible for bulk/one-click approval.
CREATE TABLE sources (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type        text NOT NULL CHECK (source_type IN (
                            'court_doc',
                            'news_article',
                            'public_records_response',
                            'official_dataset',
                            'decertification_registry'
                        )),
    url                text NOT NULL,
    publication_date   date,
    retrieved_date     date NOT NULL DEFAULT current_date,
    reliability_tier   text NOT NULL CHECK (reliability_tier IN (
                            'tier1_primary_legal_doc',
                            'tier2_official_dataset',
                            'tier3_established_news',
                            'tier4_submitted_unverified'
                        )),
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sources_reliability_tier_idx ON sources (reliability_tier);
