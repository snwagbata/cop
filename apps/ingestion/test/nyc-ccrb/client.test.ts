import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNycCcrbAllegations } from "../../src/nyc-ccrb/client.js";

/**
 * Mocked-HTTP tests for the NYC CCRB Socrata client. Every query pattern
 * asserted here ($where close_date filter on Complaints, $where
 * complaint_id in(...) batch fetch of Allegations, $where tax_id in(...)
 * batch join of Officers) was live-verified against the real
 * data.cityofnewyork.us API -- see
 * docs/superpowers/specs/2026-07-24-nyc-ccrb-ingestion-pipeline-design.md
 * §8 for why this Complaints-first flow replaced the original
 * Allegations-first design (the original's as_of_date filter turned out
 * to not filter by date at all).
 */

function jsonResponse(body: unknown, init?: { status?: number; statusText?: string }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    statusText: init?.statusText ?? "OK",
    headers: { "content-type": "application/json" },
  });
}

function urlFor(mock: ReturnType<typeof vi.fn>, datasetId: string, callIndex = 0): URL {
  const calls = mock.mock.calls.filter(([url]: [string]) => url.includes(datasetId));
  return new URL(calls[callIndex][0]);
}

describe("fetchNycCcrbAllegations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches closed complaints, joins matching allegations by complaint_id, and joins officer identity by tax_id", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("2mby-ccnw")) {
        return jsonResponse([{ complaint_id: "201806447", incident_date: "2018-01-05" }]);
      }
      if (url.includes("6xgr-kwjq")) {
        return jsonResponse([
          {
            complaint_id: "201806447",
            complaint_officer_number: "1",
            allegation_record_identity: "240280",
            tax_id: "942643",
            fado_type: "Force",
            allegation: "Physical force",
            ccrb_allegation_disposition: "Substantiated (Charges)",
            nypd_allegation_disposition: "APU Guilty",
          },
        ]);
      }
      // 2fir-qns4 (officers)
      return jsonResponse([
        { tax_id: "942643", officer_first_name: "Alfred", officer_last_name: "Hernandez", shield_no: "05046" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toEqual([
      {
        complaintId: "201806447",
        complaintOfficerNumber: "1",
        allegationRecordIdentity: "240280",
        fadoType: "Force",
        allegation: "Physical force",
        ccrbDisposition: "Substantiated (Charges)",
        nypdDisposition: "APU Guilty",
        officerFirstName: "Alfred",
        officerLastName: "Hernandez",
        shieldNo: "05046",
        incidentDate: "2018-01-05",
      },
    ]);

    const complaintsUrl = urlFor(fetchMock, "2mby-ccnw");
    expect(complaintsUrl.searchParams.get("$where")).toMatch(/^close_date >= '\d{4}-\d{2}-\d{2}'$/);

    const allegationsUrl = urlFor(fetchMock, "6xgr-kwjq");
    expect(allegationsUrl.searchParams.get("$where")).toBe("complaint_id in('201806447')");

    const officersUrl = urlFor(fetchMock, "2fir-qns4");
    expect(officersUrl.searchParams.get("$where")).toBe("tax_id in('942643')");
  });

  it("follows $offset pagination on the Complaints fetch until a page returns fewer than PAGE_SIZE rows", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({ complaint_id: String(i), incident_date: "2020-01-01" }));
    const shortPage = [{ complaint_id: "1000", incident_date: "2020-01-01" }];

    let complaintsCallCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("2mby-ccnw")) {
        complaintsCallCount++;
        return jsonResponse(complaintsCallCount === 1 ? fullPage : shortPage);
      }
      return jsonResponse([]); // no allegations/officers in this fixture
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchNycCcrbAllegations();

    expect(complaintsCallCount).toBe(2);
    const secondCallUrl = urlFor(fetchMock, "2mby-ccnw", 1);
    expect(secondCallUrl.searchParams.get("$offset")).toBe("1000");
  });

  it("returns an empty result and skips both the allegations and officer fetch when there are no closed complaints in the window", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("2mby-ccnw")) {
        return jsonResponse([]);
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the Complaints call
  });

  it("returns an empty result and skips the officer fetch when there are complaints but no matching allegations", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("2mby-ccnw")) {
        return jsonResponse([{ complaint_id: "1", incident_date: "2020-01-01" }]);
      }
      if (url.includes("6xgr-kwjq")) {
        return jsonResponse([]);
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // Complaints + Allegations, no Officers call
  });

  it("skips an allegation row missing complaint_id, complaint_officer_number, or allegation_record_identity rather than throwing", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("2mby-ccnw")) {
        return jsonResponse([{ complaint_id: "6", incident_date: "2020-01-01" }]);
      }
      if (url.includes("6xgr-kwjq")) {
        return jsonResponse([
          { complaint_officer_number: "1", allegation_record_identity: "240280", fado_type: "Force", allegation: "No complaint id" },
          { complaint_id: "5", allegation_record_identity: "240281", fado_type: "Force", allegation: "No officer number" },
          { complaint_id: "7", complaint_officer_number: "1", fado_type: "Force", allegation: "No allegation record identity" },
          { complaint_id: "6", complaint_officer_number: "1", allegation_record_identity: "240282", fado_type: "Force", allegation: "Has all three" },
        ]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toHaveLength(1);
    expect(allegations[0].complaintId).toBe("6");
  });

  it("sets incidentDate to null when the matching complaint has no incident_date", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("2mby-ccnw")) {
        return jsonResponse([{ complaint_id: "6" }]); // no incident_date field at all
      }
      if (url.includes("6xgr-kwjq")) {
        return jsonResponse([
          { complaint_id: "6", complaint_officer_number: "1", allegation_record_identity: "240282", fado_type: "Force", allegation: "x" },
        ]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toHaveLength(1);
    expect(allegations[0].incidentDate).toBeNull();
  });

  it("sends the X-App-Token header on every request when an app token is provided, and omits it when not", async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await fetchNycCcrbAllegations({ appToken: "test-token" });
    const [, withTokenOptions] = fetchMock.mock.calls[0];
    expect(withTokenOptions.headers["X-App-Token"]).toBe("test-token");

    fetchMock.mockClear();
    await fetchNycCcrbAllegations();
    const [, withoutTokenOptions] = fetchMock.mock.calls[0];
    expect(withoutTokenOptions.headers["X-App-Token"]).toBeUndefined();
  });

  it("throws with a descriptive message on a network error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND data.cityofnewyork.us"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchNycCcrbAllegations()).rejects.toThrow(/network error/i);
  });

  it("throws on a non-200 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Too Many Requests", { status: 429, statusText: "Too Many Requests" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchNycCcrbAllegations()).rejects.toThrow(/429/);
  });

  it("throws on a malformed (non-JSON) response body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<html>not json</html>", { status: 200, headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchNycCcrbAllegations()).rejects.toThrow(/not valid JSON/i);
  });
});
