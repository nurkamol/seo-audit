// Runs the macOS app has already kept.
//
// Both front-ends read the same folder — `~/Library/Application Support/
// seo-audit` — so a crawl run in the window is here a second later without
// anything being synchronised, exported or copied. A seven-minute crawl should
// only ever happen once.
//
// Read-only on purpose. Deleting a report is the app's job, where the
// confirmation and the undo live; a launcher offering to delete somebody's
// seven minutes behind a single Return is not a good trade.

import { useEffect, useState } from "react";
import { Action, ActionPanel, Color, Icon, List, open } from "@raycast/api";

import { causePayload } from "../lib/engine";
import type { KeptReport } from "../lib/present.mjs";
import {
  appIsInstalled,
  causeRows,
  keptReports,
  readReport,
  summaryLine,
} from "../lib/present.mjs";

export default function Command() {
  const [rows, setRows] = useState<KeptReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setRows(keptReports());
    setLoading(false);
  }, []);

  return (
    <List isLoading={loading} searchBarPlaceholder="Filter by site">
      {!loading && rows.length === 0 && (
        <List.EmptyView
          icon={Icon.Tray}
          title="Nothing kept yet"
          description={
            appIsInstalled()
              ? "Runs finished in the SEO Audit app are kept here. So are runs from Audit a Site."
              : "The macOS app keeps every finished run. Install it, or use Audit a Site."
          }
        />
      )}

      {rows.map((row) => (
        <List.Item
          key={row.id}
          icon={{
            source: row.errors > 0 ? Icon.XMarkCircle : Icon.CheckCircle,
            tintColor: row.errors > 0 ? Color.Red : Color.Green,
          }}
          title={row.host}
          subtitle={`${row.pages} pages · ${row.causes} thing${row.causes === 1 ? "" : "s"} to change`}
          accessories={[{ date: row.when }]}
          actions={
            <ActionPanel>
              <Action.Push
                title="Open"
                icon={Icon.Eye}
                target={<Kept row={row} />}
              />
              {appIsInstalled() && (
                <Action
                  title="Open in Seo Audit"
                  icon={Icon.Window}
                  onAction={() => open("/Applications/SEO Audit.app")}
                />
              )}
              <Action.ShowInFinder title="Show the JSON" path={row.path} />
              <Action.CopyToClipboard title="Copy Path" content={row.path} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

/// One kept run, grouped the way every other front end groups it.
function Kept({ row }: { row: KeptReport }) {
  const stored = readReport(row.path);
  // The grouping is recomputed rather than trusted from the file: a report
  // written before `causes` travelled with it still opens, which is the point
  // of keeping the engine's exact JSON rather than this app's idea of it.
  const report = stored
    ? {
        ...stored,
        causes:
          stored.causes ??
          causePayload(stored.findings ?? [], stored.meta?.pages ?? 0),
      }
    : null;
  const causes = causeRows(report);

  return (
    <List
      navigationTitle={row.host}
      searchBarPlaceholder="Filter what to change"
    >
      {!report && (
        <List.EmptyView
          icon={Icon.XMarkCircle}
          title="Could not read that report"
          description="The file is there but is not a report this can open."
        />
      )}
      {causes.map((cause) => (
        <List.Item
          key={cause.id}
          icon={{
            source:
              cause.tone === "error"
                ? Icon.XMarkCircle
                : cause.tone === "warn"
                  ? Icon.ExclamationMark
                  : Icon.Info,
            tintColor:
              cause.tone === "error"
                ? Color.Red
                : cause.tone === "warn"
                  ? Color.Orange
                  : Color.Blue,
          }}
          title={cause.title}
          subtitle={cause.subtitle}
          accessories={[
            { text: String(cause.pages.length), icon: Icon.Document },
          ]}
          actions={
            <ActionPanel>
              {cause.pages[0] && (
                <Action.OpenInBrowser
                  title="Open First Page"
                  url={cause.pages[0]}
                />
              )}
              <Action.CopyToClipboard
                title="Copy Affected Pages"
                content={cause.pages.join("\n")}
              />
              <Action.CopyToClipboard
                title="Copy Summary"
                content={summaryLine(report)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
