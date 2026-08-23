// The report as a PDF, drawn from the same views on screen.
//
// The HTML report has a print stylesheet and the CLI can still produce it; this
// is for the app, and it renders what is actually in front of somebody rather
// than a second layout that has to be kept in step with it.

import SwiftUI
import AppKit

enum PDF {
    /// A4 at 72dpi, laid out once and paginated by height. ImageRenderer draws
    /// SwiftUI into a PDF context, so what is exported is the same hierarchy
    /// that was on screen — with the glass flattened, because paper has none.
    @MainActor
    static func write(report: Report, host: String, to url: URL) {
        let width: CGFloat = 595
        let renderer = ImageRenderer(content: PrintedReport(report: report, host: host).frame(width: width))
        renderer.render { size, draw in
            var box = CGRect(x: 0, y: 0, width: width, height: size.height)
            guard let consumer = CGDataConsumer(url: url as CFURL),
                  let context = CGContext(consumer: consumer, mediaBox: &box, nil)
            else { return }
            context.beginPDFPage(nil)
            draw(context)
            context.endPDFPage()
            context.closePDF()
        }
    }
}

/// The paper version: no glass, no colour behind it, and the causes first.
private struct PrintedReport: View {
    let report: Report
    let host: String

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text(URL(string: host)?.host ?? host)
                    .font(.system(size: 22, weight: .semibold))
                Text("\(report.meta.pages) pages · \(report.findings.count) findings · "
                     + "\(report.causes.count) things to change"
                     + (report.meta.date.map { " · \($0)" } ?? ""))
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }

            ForEach(report.causes) { cause in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(cause.level.label.uppercased())
                        .font(.system(size: 8, weight: .semibold))
                        .frame(width: 54, alignment: .leading)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(cause.title).font(.system(size: 12, weight: .medium))
                        Text(cause.scope).font(.system(size: 9)).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 5)
                Divider().opacity(0.3)
            }

            Text("seo-audit")
                .font(.system(size: 8))
                .foregroundStyle(.tertiary)
        }
        .padding(36)
        .background(.white)
        .environment(\.colorScheme, .light)
    }
}
