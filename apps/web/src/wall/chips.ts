/**
 * Squared, mono and uppercase, the way the design draws them — a chip is a
 * label on a machine, not a pill. 10px rather than the mockup's 8.5px, which
 * is below what this reads at on a real screen.
 */
export const CHIP =
  'border border-line px-2.5 py-1.5 font-mono text-[10px] tracking-[.09em] text-dim uppercase hover:border-dim';
export const ACTIVE_CHIP = 'border-tx text-tx';
/**
 * The same chip, with the gap between them closed. Kind is one control with
 * three positions rather than three chips, and collapsing the borders is what
 * says so before the labels are read.
 *
 * Sharing an edge means whichever segment paints last owns it, so the lit one
 * has to be lifted or its neighbour draws a dim border straight over the side
 * they share and the current position reads as a broken box.
 *
 * That lift is only ever about the segment beside it, so the group isolates:
 * the top bar is sticky at the same layer, and a chip competing with it there
 * wins on document order and paints over the chrome it scrolled under.
 */
export const SEG = `${CHIP} relative hover:z-10`;
export const ACTIVE_SEG = `${ACTIVE_CHIP} z-10`;
/**
 * A chip's count. 700 where the mockup's stylesheet says 600: it loaded
 * Martian Mono at 400, 500 and 700 only, so it drew the count at 700, and
 * that is the weight the design was approved at.
 */
export const COUNT = 'font-bold';
