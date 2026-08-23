import { type ColumnProfile, type CsvProfile, Sha256 } from "@repo/contracts";
import { parse } from "csv-parse/sync";
import { Schema } from "effect";

import { ProfileFailure } from "./errors.ts";

interface ColumnAccumulator {
  readonly name: string;
  booleanCandidate: boolean;
  dateCandidate: boolean;
  emptyValues: number;
  falseValues: number;
  maximumDate: string;
  maximumNumber: number;
  minimumDate: string;
  minimumNumber: number;
  nonEmptyValues: number;
  numberCandidate: boolean;
  trueValues: number;
}

const CsvRows = Schema.Array(Schema.Array(Schema.String));
const decodeRows = Schema.decodeUnknownSync(CsvRows);
const decodeSha256 = Schema.decodeUnknownSync(Sha256);
const numberPattern = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const isDate = (value: string) => {
  if (!datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(`${value}T`);
};

const makeAccumulator = (name: string): ColumnAccumulator => ({
  name,
  booleanCandidate: true,
  dateCandidate: true,
  emptyValues: 0,
  falseValues: 0,
  maximumDate: "",
  maximumNumber: Number.NEGATIVE_INFINITY,
  minimumDate: "",
  minimumNumber: Number.POSITIVE_INFINITY,
  nonEmptyValues: 0,
  numberCandidate: true,
  trueValues: 0,
});

const observe = (column: ColumnAccumulator, rawValue: string) => {
  const value = rawValue.trim();
  if (value.length === 0) {
    column.emptyValues += 1;
    return;
  }

  column.nonEmptyValues += 1;
  const lower = value.toLowerCase();
  const booleanValue = lower === "true" || lower === "false";
  column.booleanCandidate &&= booleanValue;
  if (lower === "true") column.trueValues += 1;
  if (lower === "false") column.falseValues += 1;

  const numberValue = numberPattern.test(value) ? Number(value) : Number.NaN;
  column.numberCandidate &&= Number.isFinite(numberValue);
  if (Number.isFinite(numberValue)) {
    column.minimumNumber = Math.min(column.minimumNumber, numberValue);
    column.maximumNumber = Math.max(column.maximumNumber, numberValue);
  }

  const dateValue = isDate(value);
  column.dateCandidate &&= dateValue;
  if (dateValue) {
    if (column.minimumDate.length === 0 || value < column.minimumDate) column.minimumDate = value;
    if (column.maximumDate.length === 0 || value > column.maximumDate) column.maximumDate = value;
  }
};

const finishColumn = (column: ColumnAccumulator): ColumnProfile => {
  const common = {
    emptyValues: column.emptyValues,
    name: column.name,
    nonEmptyValues: column.nonEmptyValues,
  };
  if (column.nonEmptyValues === 0) return { ...common, kind: "empty" };
  if (column.booleanCandidate) {
    return {
      ...common,
      falseValues: column.falseValues,
      kind: "boolean",
      trueValues: column.trueValues,
    };
  }
  if (column.numberCandidate) {
    return {
      ...common,
      kind: "number",
      maximum: column.maximumNumber,
      minimum: column.minimumNumber,
    };
  }
  if (column.dateCandidate) {
    return {
      ...common,
      kind: "date",
      maximum: column.maximumDate,
      minimum: column.minimumDate,
    };
  }
  return { ...common, kind: "string" };
};

const sha256 = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice());
  const value = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return decodeSha256(value);
};

export const profileCsv = async (
  bytes: Uint8Array,
  reportProgress: (rowsProcessed: number, totalRows: number) => Promise<void>,
): Promise<CsvProfile> => {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    const parsed: unknown = parse(text, {
      bom: true,
      relaxColumnCount: true,
      skipEmptyLines: true,
    });
    const records = decodeRows(parsed);
    const header = records[0];
    if (header === undefined || header.length === 0) {
      throw new Error("The CSV does not contain a header row.");
    }

    const names = header.map((name, index) => name.trim() || `column_${index + 1}`);
    const columns = names.map(makeAccumulator);
    const rows = records.slice(1);
    const preview: Array<ReadonlyArray<string>> = [];
    let malformedRows = 0;
    const reportEvery = Math.max(1, Math.ceil(rows.length / 20));

    await reportProgress(0, rows.length);
    for (const [rowIndex, row] of rows.entries()) {
      if (row.length !== columns.length) malformedRows += 1;
      const normalized = columns.map((_, columnIndex) => row[columnIndex] ?? "");
      if (preview.length < 10) preview.push(normalized);
      columns.forEach((column, columnIndex) => observe(column, normalized[columnIndex] ?? ""));
      const rowsProcessed = rowIndex + 1;
      if (rowsProcessed % reportEvery === 0 || rowsProcessed === rows.length) {
        await reportProgress(rowsProcessed, rows.length);
      }
    }

    return {
      columns: columns.map(finishColumn),
      malformedRows,
      preview,
      rowCount: rows.length,
      sha256: await sha256(bytes),
    };
  } catch (cause) {
    throw new ProfileFailure({ cause, message: "The CSV could not be profiled." });
  }
};
