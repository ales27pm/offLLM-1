jest.mock("react-native", () => ({ Platform: { OS: "ios" } }), {
  virtual: true,
});
const ReadabilityService =
  require("../src/services/readabilityService").default;

describe("ReadabilityService", () => {
  const service = new ReadabilityService();

  test("extracts published time from document meta tag", () => {
    const mockDocument = {
      querySelector: (selector) => {
        if (selector === 'meta[property="article:published_time"]') {
          return {
            getAttribute: (attr) =>
              attr === "content" ? "2024-01-02T03:04:05Z" : null,
            textContent: "",
          };
        }
        return null;
      },
    };

    const result = service.extractPublishedTime({}, mockDocument);
    expect(result).toBe("2024-01-02T03:04:05.000Z");
  });

  test("extracts published time from time datetime attribute", () => {
    const mockDocument = {
      querySelector: (selector) => {
        if (selector === "time[datetime]") {
          return {
            getAttribute: (attr) =>
              attr === "datetime" ? "2023-10-05T12:34:56Z" : null,
            textContent: "",
          };
        }
        return null;
      },
    };

    const result = service.extractPublishedTime({}, mockDocument);
    expect(result).toBe("2023-10-05T12:34:56.000Z");
  });

  test("extracts published time from meta name date", () => {
    const mockDocument = {
      querySelector: (selector) => {
        if (selector === 'meta[name="date"]') {
          return {
            getAttribute: (attr) => (attr === "content" ? "2024-02-03" : null),
            textContent: "",
          };
        }
        return null;
      },
    };

    const result = service.extractPublishedTime({}, mockDocument);
    expect(result).toBe("2024-02-03T00:00:00.000Z");
  });
});
