/**
 * Where an arrow key takes the focus along one season's cells.
 *
 * Pure over the episode numbers in the order they are drawn. Left and Right
 * step, Home and End jump, and the ends do not wrap: a season is a line with
 * a start and a finish, and holding an arrow should stop there rather than
 * come round again. Any other key is not a walk and answers null.
 */
export function stepAlong(numbers: number[], from: number, key: string): number | null {
  const at = numbers.indexOf(from);
  if (at === -1 || numbers.length === 0) return null;
  switch (key) {
    case 'ArrowRight':
      return numbers[Math.min(at + 1, numbers.length - 1)] ?? null;
    case 'ArrowLeft':
      return numbers[Math.max(at - 1, 0)] ?? null;
    case 'Home':
      return numbers[0] ?? null;
    case 'End':
      return numbers[numbers.length - 1] ?? null;
    default:
      return null;
  }
}

/**
 * The cell above or below, read off the layout rather than computed: the
 * cells wrap to the width, and a year row starts a new line wherever it falls,
 * so the number of cells per row is not a fact this component knows. The
 * nearest cell on the adjacent line by horizontal position, or null at the
 * top and bottom.
 */
export function stepAcross(
  cells: HTMLElement[],
  from: HTMLElement,
  key: string,
): HTMLElement | null {
  const direction = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
  if (direction === 0) return null;
  const lines = [...new Set(cells.map((cell) => cell.offsetTop))].sort((a, b) => a - b);
  const line = lines.indexOf(from.offsetTop);
  const target = lines[line + direction];
  if (target === undefined) return null;
  const candidates = cells.filter((cell) => cell.offsetTop === target);
  return (
    candidates.reduce<HTMLElement | null>((best, cell) => {
      if (best === null) return cell;
      const gap = Math.abs(cell.offsetLeft - from.offsetLeft);
      return gap < Math.abs(best.offsetLeft - from.offsetLeft) ? cell : best;
    }, null) ?? null
  );
}
