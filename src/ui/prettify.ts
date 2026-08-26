/**
 * A list's name, tidied for the title above it.
 *
 * The name of a list *is* its filename, which is the point — renaming the title
 * renames the file, and every link in the vault follows. But a filename is also
 * a thing people write around: `favourite-animals`, `weekly_review`, names typed
 * with separators because a space felt wrong in a filename rather than because a
 * hyphen was meant.
 *
 * This is display only, and that distinction is load-bearing rather than a
 * detail. The title is an editable field; if the tidied text were what got
 * committed, opening a list called `weekly_review` and touching its title would
 * silently rename the file to `weekly review`. So the field shows this at rest
 * and the *true* filename the moment it is focused, and what you edit is always
 * what will be written.
 */

/**
 * Separators become spaces — but only in a name that has no spaces already.
 *
 * That condition is the whole design. `favourite-animals` is plainly a name
 * written without spaces and reads better with them. `Movies & TV - new` is a
 * name where the hyphen is the user's own punctuation, sitting between spaces
 * they chose to type, and rewriting it would be editing their prose rather than
 * tidying a filename. Having spaces already is the clearest available signal
 * that the typography is deliberate.
 *
 * Nothing is capitalised. Case is guesswork — `iphone` is not `Iphone` and
 * `NASA trip` is not `Nasa trip` — and a title that quietly disagrees with the
 * file it names is what this whole exercise is about avoiding.
 */
export function prettifyName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) return name;

	// Already spaced: their typography, left alone.
	if (/\s/.test(trimmed)) return trimmed;

	const tidied = trimmed.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
	// A name made entirely of separators would tidy away to nothing, and a title
	// that is blank is worse than one that is ugly.
	return tidied || trimmed;
}
