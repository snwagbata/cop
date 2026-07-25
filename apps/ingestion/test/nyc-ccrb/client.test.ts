import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNycCcrbAllegations } from "../../src/nyc-ccrb/client.js";

/**
 * Mocked-HTTP tests for the NYC CCRB Socrata client. Unlike
 * courtlistener/client.ts, every query pattern asserted here (`$where`
 * date filter, `$offset` pagination, `$where tax_id in(...)` batch join)
 * was live-verified against the real data.cityofnewyork.us API during
 * this pipeline's design -- see
 * docs/superpowers/specs/2026-07-24-nyc-ccrb-ingestion-pipeline-design.md.
 */

function jsonResponse(body: unknown, init?: { status?: number; statusText?: string }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    statusText: init?.statusText ?? "OK",
    headers: { "content-type": "application/json" },
  });
}

describe("fetchNycCcrbAllegations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches allegations and joins officer identity by tax_id", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
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
        {
          tax_id: "942643",
          officer_first_name: "Alfred",
          officer_last_name: "Hernandez",
          shield_no: "05046",
        },
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
      },
    ]);

    // Officer join batched the one tax_id found in the allegations page.
    const officerCall = fetchMock.mock.calls.find(([url]: [string]) => url.includes("2fir-qns4"));
    expect(officerCall).toBeDefined();
    const officerUrl = new URL(officerCall![0]);
    expect(officerUrl.searchParams.get("$where")).toBe("tax_id in('942643')");
  });

  it("follows $offset pagination until a page returns fewer than PAGE_SIZE rows", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      complaint_id: String(i),
      complaint_officer_number: "1",
      allegation_record_identity: String(100000 + i),
      fado_type: "Discourtesy",
      allegation: "Action",
    }));
    const shortPage = [
      {
        complaint_id: "1000",
        complaint_officer_number: "1",
        allegation_record_identity: "101000",
        fado_type: "Discourtesy",
        allegation: "Action",
      },
    ];

    let allegationCallCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("6xgr-kwjq")) {
        allegationCallCount++;
        return jsonResponse(allegationCallCount === 1 ? fullPage : shortPage);
      }
      return jsonResponse([]); // no tax_ids in this fixture, officer join returns nothing
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toHaveLength(1001);
    expect(allegationCallCount).toBe(2);
    const secondCallUrl = new URL(fetchMock.mock.calls.filter(([url]: [string]) => url.includes("6xgr-kwjq"))[1][0]);
    expect(secondCallUrl.searchParams.get("$offset")).toBe("1000");
  });

  it("returns an empty result and skips the officer fetch entirely when there are no allegations", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the allegations call, no officer join call
  });

  it("skips an allegation row missing complaint_id, complaint_officer_number, or allegation_record_identity rather than throwing", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("6xgr-kwjq")) {
        return jsonResponse([
          {
            complaint_officer_number: "1",
            allegation_record_identity: "240280",
            fado_type: "Force",
            allegation: "No complaint id",
          },
          { complaint_id: "5", allegation_record_identity: "240281", fado_type: "Force", allegation: "No officer number" },
          { complaint_id: "7", complaint_officer_number: "1", fado_type: "Force", allegation: "No allegation record identity" },
          {
            complaint_id: "6",
            complaint_officer_number: "1",
            allegation_record_identity: "240282",
            fado_type: "Force",
            allegation: "Has all three",
          },
        ]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toHaveLength(1);
    expect(allegations[0].complaintId).toBe("6");
  });

  it("normalizes multiple allegation rows sharing the same complaint_id and complaint_officer_number but different allegation_record_identity as distinct, non-duplicate allegations", async () => {
    // Regression test: complaint_id + complaint_officer_number alone is
    // NOT a unique key -- a single complaint+officer pair can have
    // multiple distinct allegation rows (e.g. "Force" and "Abuse of
    // Authority" against the same officer on the same complaint).
    // Live-verified against the real API: complaint_id=200000003,
    // complaint_officer_number=1 returns 3 rows with distinct
    // allegation_record_identity values (240282, 240281, 240280).
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("6xgr-kwjq")) {
        return jsonResponse([
          {
            complaint_id: "200000003",
            complaint_officer_number: "1",
            allegation_record_identity: "240282",
            fado_type: "Force",
            allegation: "Physical force",
          },
          {
            complaint_id: "200000003",
            complaint_officer_number: "1",
            allegation_record_identity: "240281",
            fado_type: "Abuse of Authority",
            allegation: "Failure to provide RTKA card",
          },
          {
            complaint_id: "200000003",
            complaint_officer_number: "1",
            allegation_record_identity: "240280",
            fado_type: "Discourtesy",
            allegation: "Word",
          },
        ]);
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const allegations = await fetchNycCcrbAllegations();

    expect(allegations).toHaveLength(3);
    const identities = allegations.map((a) => a.allegationRecordIdentity).sort();
    expect(identities).toEqual(["240280", "240281", "240282"]);
    for (const a of allegations) {
      expect(a.complaintId).toBe("200000003");
      expect(a.complaintOfficerNumber).toBe("1");
    }
  });

  it("sends the X-App-Token header when an app token is provided, and omits it when not", async () => {
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
