import { afterEach, describe, expect, it, vi } from "vitest";
import { searchCourtListener } from "../../src/courtlistener/client.js";

/**
 * Mocked-HTTP tests for the CourtListener client. Per client.ts's own
 * file-level warning, the exact request/response shape asserted here is
 * this pipeline's best-effort guess at CourtListener's real API, not a
 * verified contract -- these tests lock down *this file's parsing logic*
 * given that assumed shape, not CourtListener's actual behavior.
 */

function jsonResponse(body: unknown, init?: { status?: number; statusText?: string }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    statusText: init?.statusText ?? "OK",
    headers: { "content-type": "application/json" },
  });
}

describe("searchCourtListener", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a successful single-page response into normalized dockets", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            docket_id: 12345,
            caseName: "Doe v. City of Springfield",
            court: "cand",
            dateFiled: "2024-01-15",
            absolute_url: "/docket/12345/doe-v-city-of-springfield/",
            party: "Jane Doe v. City of Springfield; Officer John Smith",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const dockets = await searchCourtListener("test-key", { keyword: "excessive force", court: "cand" });

    expect(dockets).toHaveLength(1);
    expect(dockets[0]).toEqual({
      docketId: "12345",
      caseName: "Doe v. City of Springfield",
      court: "cand",
      dateFiled: "2024-01-15",
      docketUrl: "https://www.courtlistener.com/docket/12345/doe-v-city-of-springfield/",
      partyText: "Jane Doe v. City of Springfield; Officer John Smith",
    });

    // Request shape: auth header, q + type=r + court params.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("search/?");
    expect(String(url)).toContain("type=r");
    expect(String(url)).toContain("court=cand");
    expect(options.headers.Authorization).toBe("Token test-key");
  });

  it("follows pagination via `next` until it is null", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          count: 2,
          next: "https://www.courtlistener.com/api/rest/v4/search/?q=test&type=r&page=2",
          previous: null,
          results: [{ docket_id: 1, caseName: "Case One", absolute_url: "/docket/1/case-one/" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          count: 2,
          next: null,
          previous: "https://www.courtlistener.com/api/rest/v4/search/?q=test&type=r",
          results: [{ docket_id: 2, caseName: "Case Two", absolute_url: "/docket/2/case-two/" }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const dockets = await searchCourtListener("test-key", { keyword: "test" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dockets.map((d) => d.docketId)).toEqual(["1", "2"]);
    // Second call hit the `next` URL directly.
    expect(String(fetchMock.mock.calls[1][0])).toContain("page=2");
  });

  it("stops following pagination at a hard page cap, not looping forever", async () => {
    const alwaysHasNext = () =>
      jsonResponse({
        count: 1000,
        next: "https://www.courtlistener.com/api/rest/v4/search/?q=test&type=r&page=999",
        previous: null,
        results: [{ docket_id: Math.random(), caseName: "Loop", absolute_url: "/docket/x/loop/" }],
      });
    const fetchMock = vi.fn().mockImplementation(async () => alwaysHasNext());
    vi.stubGlobal("fetch", fetchMock);

    await searchCourtListener("test-key", { keyword: "test" });

    // MAX_PAGES is a small constant in client.ts -- assert it's bounded,
    // not the exact number, so this test isn't coupled to that constant.
    expect(fetchMock.mock.calls.length).toBeLessThan(20);
  });

  it("skips a malformed result missing a docket id rather than throwing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 2,
        next: null,
        previous: null,
        results: [
          { caseName: "No id here", absolute_url: "/docket/x/no-id/" },
          { docket_id: 99, caseName: "Has an id", absolute_url: "/docket/99/has-an-id/" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const dockets = await searchCourtListener("test-key", { keyword: "test" });

    expect(dockets).toHaveLength(1);
    expect(dockets[0].docketId).toBe("99");
  });

  it("defaults missing optional fields (dateFiled, party text) without throwing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [{ docket_id: 7, caseName: "Sparse Case" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const dockets = await searchCourtListener("test-key", { keyword: "test" });

    expect(dockets).toEqual([
      {
        docketId: "7",
        caseName: "Sparse Case",
        court: "unknown",
        dateFiled: null,
        docketUrl: "",
        partyText: "",
      },
    ]);
  });

  it("throws with a descriptive message on a network error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND www.courtlistener.com"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchCourtListener("test-key", { keyword: "test" })).rejects.toThrow(/network error/i);
  });

  it("throws on a non-200 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchCourtListener("bad-key", { keyword: "test" })).rejects.toThrow(/401/);
  });

  it("throws on a malformed (non-JSON) response body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<html>not json</html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchCourtListener("test-key", { keyword: "test" })).rejects.toThrow(/not valid JSON/i);
  });
});
