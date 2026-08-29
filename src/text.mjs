// Counting things in a sentence.
//
// "1 image(s) without width/height" was the most repeated finding title in a
// real report — 150 pages of it — and it reads like a form somebody did not
// finish. A report is worth reading because its sentences are true; a sentence
// that cannot decide whether it is singular is a smaller version of the same
// problem.
//
// Every plural this project needs is regular, so this stays five lines rather
// than growing into a library. `many` is there for the first one that is not.

/** `1 image`, `3 images`. Pass `many` where adding an s would be wrong. */
export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Just the noun, for a count that is formatted separately — a thousands
 *  separator, say. `${n.toLocaleString()} ${noun(n, 'link')} in`. */
export function noun(n, one, many = `${one}s`) {
  return n === 1 ? one : many;
}
