import type { Element, ResultNumber, StudyDocument } from "../model";
export function known<T>(
  field: { status: string; value?: T } | undefined,
): T | undefined {
  return field?.status === "known" ? field.value : undefined;
}
export const resultValue = (field?: ResultNumber) =>
  field?.status === "available" ? field.value : null;
export const format = (field?: ResultNumber, digits = 3) =>
  field?.status === "available"
    ? field.value.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "—";
export const nameOf = (element?: Element) =>
  element ? known(element.label) || element.id : "—";
export const elementName = (doc: StudyDocument, id: string) =>
  nameOf(doc.elements.find((e) => e.id === id));
export function download(
  name: string,
  data: BlobPart,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
export function getAt(object: unknown, path: string): unknown {
  return path
    .split("/")
    .filter(Boolean)
    .reduce<unknown>(
      (v, p) =>
        (v as Record<string, unknown>)?.[
          p.replace(/~1/g, "/").replace(/~0/g, "~")
        ],
      object,
    );
}
export const escapePointer = (text: string) =>
  text.replace(/~/g, "~0").replace(/\//g, "~1");
export function inputFields(
  value: unknown,
  path = "",
): {
  path: string;
  field: {
    status: string;
    value?: unknown;
    provenance?: { source: string };
    reason?: string;
  };
}[] {
  if (!value || typeof value !== "object") return [];
  const obj = value as Record<string, unknown>;
  if (obj.status === "known" || obj.status === "missing") {
    if (obj.value && typeof obj.value === "object" && !Array.isArray(obj.value))
      return [
        {
          path,
          field: obj as {
            status: string;
            value?: unknown;
            provenance?: { source: string };
            reason?: string;
          },
        },
        ...inputFields(obj.value, `${path}/value`),
      ];
    return [
      {
        path,
        field: obj as {
          status: string;
          value?: unknown;
          provenance?: { source: string };
          reason?: string;
        },
      },
    ];
  }
  return Object.entries(obj).flatMap(([key, v]) =>
    inputFields(v, `${path}/${escapePointer(key)}`),
  );
}
