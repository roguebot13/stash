import "server-only";

import bcrypt from "bcrypt";

export const BCRYPT_COST = 12;
export const DUMMY_PASSWORD_HASH =
  "$2b$12$DSsxoxr4vIf..yx2KHIcSumIXapEKAT.n/oone7g01BsiLg2AOL.u";

export function passwordByteLength(password: string) {
  return Buffer.byteLength(password, "utf8");
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function performDummyPasswordCheck(password: string) {
  await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
}
