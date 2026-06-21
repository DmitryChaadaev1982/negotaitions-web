import { nanoid } from "nanoid";

export function generateJoinToken() {
  return nanoid(21);
}
