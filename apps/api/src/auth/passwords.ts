import argon2, { type HashOptions } from "argon2";

// OWASP argon2id baseline: 19 MiB memory, 2 iterations, single lane.
const hashingOptions: HashOptions = {
  memoryCost: 19_456,
  parallelism: 1,
  timeCost: 2,
  type: argon2.argon2id,
};

// Verified when the user lookup misses so login timing stays uniform.
const timingEqualizationHash =
  "$argon2id$v=19$m=19456,p=1,t=2$/+wqKN6HMeDOf1f/9ijyFA" +
  "$0FBV2Xpdw1gtXbizrQzoJZUrdlft8BZ6T+I3cBNlCgg";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, hashingOptions);
}

export async function verifyPassword(
  passwordHash: string | null,
  password: string
): Promise<boolean> {
  const matches = await argon2
    .verify(passwordHash ?? timingEqualizationHash, password)
    .catch(() => false);
  return passwordHash !== null && matches;
}
