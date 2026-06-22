import { generateJoinToken } from "@/lib/join-token";

export function generateHostToken() {
  return generateJoinToken();
}

export function generateParticipantToken() {
  return generateJoinToken();
}
