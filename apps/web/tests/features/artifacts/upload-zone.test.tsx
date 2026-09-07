import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { UploadZone } from "@/features/artifacts/upload-zone";

test("choosing a CSV hands the file to the uploader", async () => {
  const user = userEvent.setup();
  const onUpload = vi.fn<(file: File) => void>();
  const file = new File(["date,amount\n2026-08-01,42\n"], "transactions.csv", {
    type: "text/csv",
  });
  render(<UploadZone isUploading={false} onUpload={onUpload} />);

  await user.upload(screen.getByLabelText("CSV file"), file);

  expect(onUpload).toHaveBeenCalledWith(file);
});

test("an active upload disables further file selection", () => {
  render(<UploadZone isUploading onUpload={vi.fn<(file: File) => void>()} />);

  expect(screen.getByLabelText("CSV file")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Uploading" })).toBeDisabled();
});

test("an active upload ignores dropped files", () => {
  const uploads: File[] = [];
  render(<UploadZone isUploading onUpload={(file) => uploads.push(file)} />);
  const file = new File(["value\n1"], "sample.csv");
  fireEvent.drop(screen.getByText("Drop a CSV here"), {
    dataTransfer: { files: { item: () => file } },
  });
  expect(uploads).toEqual([]);
});
