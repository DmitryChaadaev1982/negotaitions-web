export function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDateFromIso(iso: string | null) {
  if (!iso) {
    return "Not yet";
  }

  return formatDate(new Date(iso));
}
