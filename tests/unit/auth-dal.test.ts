import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, findUniqueMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: findUniqueMock } } }));
vi.mock("next/navigation", () => ({ redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));

import { getCurrentUser, requireUser } from "@/lib/auth-dal";

describe("auth DAL", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only safe user fields for a current session version", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", sessionVersion: 3 } });
    findUniqueMock.mockResolvedValue({ id: "user-1", email: "person@example.com", emailVerifiedAt: new Date(), sessionVersion: 3, passwordHash: "must-not-leak" });
    await expect(getCurrentUser()).resolves.toEqual({ id: "user-1", email: "person@example.com" });
  });

  it("rejects a session issued before a version increment", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", sessionVersion: 2 } });
    findUniqueMock.mockResolvedValue({ id: "user-1", email: "person@example.com", emailVerifiedAt: new Date(), sessionVersion: 3 });
    await expect(getCurrentUser()).resolves.toBeNull();
    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });

  it("rejects a pending account even with a current session version", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1", sessionVersion: 3 } });
    findUniqueMock.mockResolvedValue({
      id: "user-1",
      email: "person@example.com",
      emailVerifiedAt: null,
      sessionVersion: 3,
    });
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("fails closed when the session has no user", async () => {
    authMock.mockResolvedValue(null);
    await expect(getCurrentUser()).resolves.toBeNull();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});
