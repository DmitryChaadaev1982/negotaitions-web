export type ManagedAdminAction =
  | "approve"
  | "reject"
  | "block"
  | "unblock"
  | "makeAdmin"
  | "removeAdmin";

export function shouldConfirmAdminAction(action: ManagedAdminAction): boolean {
  return action === "reject" || action === "block" || action === "makeAdmin" || action === "removeAdmin";
}

export function wantsAdminActionComment(action: ManagedAdminAction): boolean {
  return action === "approve" || action === "reject" || action === "block" || action === "unblock";
}

export function buildAdminActionFormData(userId: string, comment: string): FormData {
  const formData = new FormData();
  formData.set("userId", userId);
  formData.set("comment", comment.trim());
  return formData;
}
