import { describe, test, expect } from "bun:test";
import { sanitizePath, getProjectDir } from "./sessionDiscovery";
import { homedir } from "os";
import { join } from "path";

describe("sessionDiscovery", () => {
  describe("sanitizePath", () => {
    test("replaces slashes with dashes", () => {
      expect(sanitizePath("/Users/foo/project")).toBe("-Users-foo-project");
    });

    test("handles root path", () => {
      expect(sanitizePath("/")).toBe("-");
    });

    test("handles nested paths", () => {
      expect(sanitizePath("/home/user/deep/nested/path")).toBe(
        "-home-user-deep-nested-path",
      );
    });

    test("handles path without leading slash", () => {
      expect(sanitizePath("relative/path")).toBe("relative-path");
    });
  });

  describe("getProjectDir", () => {
    test("constructs correct project directory path", () => {
      const result = getProjectDir("/Users/foo/project");
      expect(result).toBe(
        join(homedir(), ".claude", "projects", "-Users-foo-project"),
      );
    });
  });
});
