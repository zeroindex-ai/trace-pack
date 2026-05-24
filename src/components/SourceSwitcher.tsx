import Link from 'next/link';

// Reuses the `.filter-strip` pill styling (see globals.css). Server component —
// just renders links, no client JS. `allHref` (when given) adds a leading pill
// for the cross-source overview; `current === null` highlights it.
export function SourceSwitcher({
  sources,
  current,
  hrefFor,
  allHref,
  allLabel = 'All apps',
}: {
  sources: string[];
  current: string | null;
  hrefFor: (source: string) => string;
  allHref?: string;
  allLabel?: string;
}) {
  if (sources.length <= 1 && !allHref) return null;
  return (
    <div className="filter-strip" aria-label="Source">
      {allHref !== undefined &&
        (current === null ? (
          <span className="current">{allLabel}</span>
        ) : (
          <Link href={allHref}>{allLabel}</Link>
        ))}
      {sources.map((s) =>
        s === current ? (
          <span key={s} className="current">
            {s}
          </span>
        ) : (
          <Link key={s} href={hrefFor(s)}>
            {s}
          </Link>
        )
      )}
    </div>
  );
}
