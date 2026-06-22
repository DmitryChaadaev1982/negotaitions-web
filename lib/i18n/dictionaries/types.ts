import { en } from "./en";

type DeepStringRecord<T> = {
  [K in keyof T]: T[K] extends object ? DeepStringRecord<T[K]> : string;
};

export type Dictionary = DeepStringRecord<typeof en>;
