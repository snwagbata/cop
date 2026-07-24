import { afterEach, describe, expect, it, vi } from "vitest";

// Mocked Claude API calls -- this suite must never depend on hitting a real
// paid API (see extract.ts's own comment on why malformed responses must
// degrade gracefully rather than throw). vi.hoisted so `mockCreate` exists
// before vi.mock's factory runs (vitest hoists vi.mock calls above imports).
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => {
  // A real (non-arrow) class, not an arrow-function factory -- `new
  // Anthropic(...)` in extract.ts requires something constructable, and
  // an arrow function can never be used with `new`.
  class MockAnthropic {
    messages = { create: mockCreate };
  }
  return { default: MockAnthropic };
});

const { extractOfficerFromPartyText } = await import("../../src/courtlistener/extract.js");

function textResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("extractOfficerFromPartyText", () => {
  afterEach(() => {
    mockCreate.mockReset();
  });

  it("returns a clear match when the model identifies exactly one officer", async () => {
    mockCreate.mockResolvedValueOnce(
      textResponse(JSON.stringify({ officerName: "John Smith", confidence: "clear" })),
    );

    const result = await extractOfficerFromPartyText("test-key", "Jane Doe v. City of Springfield; Officer John Smith");

    expect(result).toEqual({ officerName: "John Smith", confidence: "clear" });
  });

  it("returns an ambiguous match with a best-guess name", async () => {
    mockCreate.mockResolvedValueOnce(
      textResponse(JSON.stringify({ officerName: "Officer Doe", confidence: "ambiguous" })),
    );

    const result = await extractOfficerFromPartyText(
      "test-key",
      "Plaintiff v. City of Springfield, Springfield Police Department, Officer Doe, and Does 1-10",
    );

    expect(result).toEqual({ officerName: "Officer Doe", confidence: "ambiguous" });
  });

  it("returns none when no individual officer defendant is identifiable", async () => {
    mockCreate.mockResolvedValueOnce(textResponse(JSON.stringify({ officerName: null, confidence: "none" })));

    const result = await extractOfficerFromPartyText("test-key", "Plaintiff v. City of Springfield");

    expect(result).toEqual({ officerName: null, confidence: "none" });
  });

  it("degrades to none on a malformed/unparseable model response, without throwing", async () => {
    mockCreate.mockResolvedValueOnce(textResponse("I'm not able to help with that request."));

    const result = await extractOfficerFromPartyText("test-key", "some party text");

    expect(result).toEqual({ officerName: null, confidence: "none" });
  });

  it("degrades to none when the response JSON has an invalid confidence value", async () => {
    mockCreate.mockResolvedValueOnce(
      textResponse(JSON.stringify({ officerName: "John Smith", confidence: "very_sure" })),
    );

    const result = await extractOfficerFromPartyText("test-key", "some party text");

    expect(result).toEqual({ officerName: null, confidence: "none" });
  });

  it("degrades to none when confidence is clear but officerName is missing/empty", async () => {
    mockCreate.mockResolvedValueOnce(textResponse(JSON.stringify({ officerName: "", confidence: "clear" })));

    const result = await extractOfficerFromPartyText("test-key", "some party text");

    expect(result).toEqual({ officerName: null, confidence: "none" });
  });

  it("tolerates JSON wrapped in prose or a code fence", async () => {
    mockCreate.mockResolvedValueOnce(
      textResponse(
        'Here is the extraction:\n```json\n{"officerName": "Maria Nguyen", "confidence": "clear"}\n```\nLet me know if you need anything else.',
      ),
    );

    const result = await extractOfficerFromPartyText("test-key", "some party text");

    expect(result).toEqual({ officerName: "Maria Nguyen", confidence: "clear" });
  });

  it("does not call the API at all for empty party text, and returns none", async () => {
    const result = await extractOfficerFromPartyText("test-key", "   ");

    expect(result).toEqual({ officerName: null, confidence: "none" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("degrades to none (not a throw) when the Anthropic API call itself fails", async () => {
    mockCreate.mockRejectedValueOnce(new Error("rate_limit_error"));

    const result = await extractOfficerFromPartyText("test-key", "some party text");

    expect(result).toEqual({ officerName: null, confidence: "none" });
  });

  it("degrades to none when the response has no text content block", async () => {
    mockCreate.mockResolvedValueOnce({ content: [{ type: "tool_use", id: "x", name: "y", input: {} }] });

    const result = await extractOfficerFromPartyText("test-key", "some party text");

    expect(result).toEqual({ officerName: null, confidence: "none" });
  });
});
