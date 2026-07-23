import type { Source } from "@cop/shared-types";

/** Fixture Source rows matching @cop/shared-types' Source exactly. */
export const sourceFixtures: Source[] = [
  {
    id: "src-1",
    sourceType: "court_doc",
    url: "https://example-court.gov/records/case-1234",
    publicationDate: "2019-04-02",
    retrievedDate: "2023-01-10",
    reliabilityTier: "tier1_primary_legal_doc",
  },
  {
    id: "src-2",
    sourceType: "news_article",
    url: "https://example-news.example/story-5678",
    publicationDate: "2020-06-15",
    retrievedDate: "2023-01-11",
    reliabilityTier: "tier3_established_news",
  },
];
