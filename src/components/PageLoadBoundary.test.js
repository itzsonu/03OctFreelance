import React from "react";
import { render, screen } from "@testing-library/react";
import PageLoadBoundary from "./PageLoadBoundary";

test("an interrupted route file shows recovery instead of a blank workspace", () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  const fail = () => { const e = new Error("Loading chunk 358 failed"); e.name = "ChunkLoadError"; throw e; };
  function BrokenPage() { return fail(); }
  try {
    render(<PageLoadBoundary><BrokenPage /></PageLoadBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("This page could not finish loading");
    expect(screen.getByRole("button", { name: "Reload page" })).toBeEnabled();
    expect(screen.queryByText(/358/)).not.toBeInTheDocument();
  } finally { log.mockRestore(); }
});
