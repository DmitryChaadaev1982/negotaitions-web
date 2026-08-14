type DateTimeTuple = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
};

function dateToLocalTuple(date: Date): DateTimeTuple {
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    year: String(date.getFullYear()),
    month: pad(date.getMonth() + 1),
    day: pad(date.getDate()),
    hour: pad(date.getHours()),
    minute: pad(date.getMinutes()),
  };
}

export function formatDateTimeLocalInputValue(date: Date): string {
  const local = dateToLocalTuple(date);
  return `${local.year}-${local.month}-${local.day}T${local.hour}:${local.minute}`;
}
