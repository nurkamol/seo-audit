// The few numbers this app's surfaces are built from.
//
// There were eight corner radii in nine files — 6, 10, 12, 15, 16, 20, 26 and
// 28 — and the pairs give it away: nobody decides that a text field is 15 and a
// tally card is 16, or that one glass container is 26 and the one beside it is
// 28. They were each chosen alone, months apart, and the result is a window
// that looks *almost* consistent, which reads worse than one that is plainly
// not: the eye notices the two-point difference without being able to name it.
//
// Four radii, on a scale, each named for what it is rather than what it
// measures. Adding a fifth should feel like it needs an argument.

import SwiftUI

enum Radius {
    /// A level chip. Small enough that anything rounder becomes a capsule.
    static let pill: CGFloat = 6
    /// Something you type in or press: fields, command boxes, compact rows.
    static let control: CGFloat = 12
    /// A card in a list — a cause, a tally, a change.
    static let card: CGFloat = 18
    /// A whole surface that floats: the stage a run begins on, the backdrop.
    static let surface: CGFloat = 26
}

extension RoundedRectangle {
    /// `.rect(Radius.card)` reads better at the call site than a number does,
    /// and it is the call sites that drifted.
    static func of(_ radius: CGFloat) -> RoundedRectangle {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
    }
}
